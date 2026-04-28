import { NextRequest } from 'next/server';
import dns from 'node:dns';
import type { Character, Emotion } from '@/lib/types';
import { resolveWidgetUserId } from '@/lib/widget-user-id';

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

/** 1行分のテキストをパース。対話形式でなければ null を返す。 */
function parseOneLine(rawLine: string, defaultEmotion: Emotion): SpeakerLine | null {
  const line = rawLine.trim();
  if (!line) return null;

  const allPrefixes = [...ZUNDAMON_PREFIXES, ...METAN_PREFIXES].join('|');
  const prefixRe = new RegExp(`^(${allPrefixes})\\s*[:：]\\s*(.+)$`);
  const suffixRe = /^(.+?)_([zZmM])([1-6])\s*$/;
  const emotionRe = /[（(]([1-6１-６])[）)]\s*$/;

  const pm = line.match(prefixRe);
  if (pm) {
    const speaker: Character = ZUNDAMON_PREFIXES.includes(pm[1]) ? 'zundamon' : 'metan';
    let body = pm[2].trim();
    let emotion = defaultEmotion;
    const em = body.match(emotionRe);
    if (em) {
      const num = em[1].charCodeAt(0) > 127 ? String.fromCharCode(em[1].charCodeAt(0) - 0xFEE0) : em[1];
      emotion = EMOTION_BY_NUMBER[num] ?? defaultEmotion;
      body = body.replace(emotionRe, '').trim();
    }
    const sfx = body.match(suffixRe);
    if (sfx) {
      emotion = EMOTION_BY_NUMBER[sfx[3]] ?? emotion;
      body = sfx[1].trim();
    }
    return body.length > 0 ? { speaker, emotion, text: body } : null;
  }

  const sm = line.match(suffixRe);
  if (sm) {
    const speaker: Character = sm[2].toLowerCase() === 'z' ? 'zundamon' : 'metan';
    const emotion: Emotion = EMOTION_BY_NUMBER[sm[3]] ?? defaultEmotion;
    const text = sm[1].trim();
    return text.length > 0 ? { speaker, emotion, text } : null;
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    input?: string;
    defaultEmotion?: Emotion;
    conversationId?: string;
    humanId?: string;
    userId?: string;
  };

  const input = body.input?.trim();
  if (!input) {
    return new Response(JSON.stringify({ error: 'input は必須です' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL ?? 'https://api.dify.ai/v1/chat-messages';
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'DIFY_API_KEY が設定されていません' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const defaultEmotion: Emotion = body.defaultEmotion ?? 'neutral';
  const difyUserId = resolveWidgetUserId(body.humanId, body.userId) ?? 'zundamon-widget';

  // Dify SSE ストリームを読みながら、完成した行を逐次 SSE で client へ転送する。
  // 目的: Dify の全文待機 (~40秒) を排除し、1 行目から即 VOICEVOX 合成を開始できるようにする。
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
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
            user: difyUserId,
          }),
        });

        if (!difyRes.ok) {
          const err = await difyRes.text();
          send({ type: 'error', message: `Dify APIエラー: ${err}` });
          controller.close();
          return;
        }

        const reader = difyRes.body?.getReader();
        if (!reader) {
          send({ type: 'error', message: 'レスポンスの読み取りに失敗しました' });
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let sseBuffer = '';       // Dify 側 SSE の未処理バッファ
        let answerBuffer = '';    // Dify answer 連結の未改行バッファ
        let conversationId = body.conversationId ?? '';
        let hasDialogue = false;
        let fallbackFullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          // Dify の SSE は \n 区切りの `data: ...` 行の連続
          const sseLines = sseBuffer.split('\n');
          sseBuffer = sseLines.pop() ?? '';

          for (const sseLine of sseLines) {
            if (!sseLine.startsWith('data: ')) continue;
            try {
              const json = JSON.parse(sseLine.slice(6));
              if (json.conversation_id) {
                conversationId = json.conversation_id;
              }
              if (json.event === 'message' && typeof json.answer === 'string' && json.answer.length > 0) {
                answerBuffer += json.answer;
                fallbackFullText += json.answer;

                // answerBuffer を \n で分割して完成行を逐次パース
                const parts = answerBuffer.split('\n');
                answerBuffer = parts.pop() ?? '';
                for (const part of parts) {
                  const parsed = parseOneLine(part, defaultEmotion);
                  if (parsed) {
                    hasDialogue = true;
                    send({ type: 'line', line: parsed });
                  }
                }
              }
            } catch {
              // 不完全な JSON チャンクは無視
            }
          }
        }

        // 残バッファをフラッシュ
        if (answerBuffer.trim()) {
          const parsed = parseOneLine(answerBuffer, defaultEmotion);
          if (parsed) {
            hasDialogue = true;
            send({ type: 'line', line: parsed });
          }
        }

        // 対話形式で 1 行も取れなかった場合はずんだもんの一言として送る
        if (!hasDialogue && fallbackFullText.trim()) {
          send({
            type: 'line',
            line: { speaker: 'zundamon' as Character, emotion: defaultEmotion, text: fallbackFullText.trim() },
          });
        }

        send({ type: 'done', conversationId });
        controller.close();
      } catch (err) {
        console.error('[/api/widget-chat stream]', err);
        send({ type: 'error', message: err instanceof Error ? err.message : '不明なエラー' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
