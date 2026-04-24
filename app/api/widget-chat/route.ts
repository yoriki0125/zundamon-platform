import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns';
import type { Character, Emotion } from '@/lib/types';

// Node 20+ は既定で IPv6 優先で DNS を解決するが、Windows 環境 + Dify の組み合わせで
// IPv6 経路が ECONNRESET を返すことがあるため IPv4 を優先させる。
dns.setDefaultResultOrder('ipv4first');

// 開発環境で企業ネットワークの SSL インスペクション (自己署名ルート CA) に遭遇した際の
// 回避策。NODE_ENV !== 'production' かつ ALLOW_INSECURE_TLS=1 のときのみ TLS 検証を無効化。
// 本番では絶対に使わない。
if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

type SpeakerLine = { speaker: Character; emotion: Emotion; text: string };

const ZUNDAMON_PREFIXES = ['ずんだ', 'ずんだもん', 'Z', 'z'];
const METAN_PREFIXES = ['めたん', 'メタン', '四国めたん', '四国めた', 'M', 'm'];

const EMOTION_BY_NUMBER: Record<string, Emotion> = {
  '1': 'neutral', '2': 'happy', '3': 'angry',
  '4': 'sad', '5': 'surprised', '6': 'shy',
};

function parseDialogue(text: string, defaultEmotion: Emotion): SpeakerLine[] {
  const allPrefixes = [...ZUNDAMON_PREFIXES, ...METAN_PREFIXES].join('|');
  const prefixRe = new RegExp(`^(${allPrefixes})\\s*[:：]\\s*(.+)$`);
  const suffixRe = /^(.+?)_([zZmM])([1-6])\s*$/;
  const emotionRe = /[（(]([1-6１-６])[）)]\s*$/;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: SpeakerLine[] = [];

  for (const line of lines) {
    const pm = line.match(prefixRe);
    if (pm) {
      const speaker: Character = ZUNDAMON_PREFIXES.includes(pm[1]) ? 'zundamon' : 'metan';
      let body = pm[2].trim();
      let emotion = defaultEmotion;
      // (1)〜(6) 形式の感情番号を処理
      const em = body.match(emotionRe);
      if (em) {
        const num = em[1].charCodeAt(0) > 127 ? String.fromCharCode(em[1].charCodeAt(0) - 0xFEE0) : em[1];
        emotion = EMOTION_BY_NUMBER[num] ?? defaultEmotion;
        body = body.replace(emotionRe, '').trim();
      }
      // _z1 / _m2 形式のサフィックスも処理（プレフィックスと混在する場合）
      const sfx = body.match(suffixRe);
      if (sfx) {
        emotion = EMOTION_BY_NUMBER[sfx[3]] ?? emotion;
        body = sfx[1].trim();
      }
      result.push({ speaker, emotion, text: body });
      continue;
    }

    const sm = line.match(suffixRe);
    if (sm) {
      const speaker: Character = sm[2].toLowerCase() === 'z' ? 'zundamon' : 'metan';
      const emotion: Emotion = EMOTION_BY_NUMBER[sm[3]] ?? defaultEmotion;
      result.push({ speaker, emotion, text: sm[1].trim() });
    }
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      input?: string;
      defaultEmotion?: Emotion;
      conversationId?: string;
    };

    const input = body.input?.trim();
    if (!input) {
      return NextResponse.json({ error: 'input は必須です' }, { status: 400 });
    }

    const apiKey = process.env.DIFY_API_KEY;
    const apiUrl = process.env.DIFY_API_URL ?? 'https://api.dify.ai/v1/chat-messages';
    if (!apiKey) {
      return NextResponse.json({ error: 'DIFY_API_KEY が設定されていません' }, { status: 500 });
    }

    const difyRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {},
        query: input,
        response_mode: 'streaming',
        conversation_id: body.conversationId ?? '',
        user: 'zundamon-widget',
      }),
    });

    if (!difyRes.ok) {
      const err = await difyRes.text();
      return NextResponse.json({ error: `Dify APIエラー: ${err}` }, { status: difyRes.status });
    }

    const reader = difyRes.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: 'レスポンスの読み取りに失敗しました' }, { status: 500 });
    }

    let fullText = '';
    let newConversationId = body.conversationId ?? '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n').filter((l) => l.startsWith('data: '))) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.conversation_id) newConversationId = json.conversation_id;
          if (json.event === 'message' && json.answer) fullText += json.answer;
        } catch { /* ignore */ }
      }
    }

    const defaultEmotion: Emotion = body.defaultEmotion ?? 'neutral';
    const lines = parseDialogue(fullText.trim(), defaultEmotion);

    if (lines.length > 0) {
      return NextResponse.json({ lines, conversationId: newConversationId });
    }

    // 対話形式でない場合はずんだもんの一言として返す
    return NextResponse.json({
      lines: [{ speaker: 'zundamon', emotion: defaultEmotion, text: fullText.trim() }],
      conversationId: newConversationId,
    });
  } catch (err) {
    console.error('[/api/widget-chat]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '不明なエラー' },
      { status: 500 },
    );
  }
}
