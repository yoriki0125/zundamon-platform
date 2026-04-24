import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns';

// Node 20+ の IPv6 優先 DNS で Dify 接続が ECONNRESET になる環境向けの回避策。
dns.setDefaultResultOrder('ipv4first');

// 開発環境専用: 企業ネットワーク SSL インスペクション回避 (ALLOW_INSECURE_TLS=1 のとき)。
if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export async function POST(req: NextRequest) {
  try {
    const { topic, conversationId } = (await req.json()) as {
      topic: string;
      conversationId?: string;
    };

    if (!topic) {
      return NextResponse.json({ error: 'topic は必須です' }, { status: 400 });
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
        query: topic,
        response_mode: 'streaming',
        conversation_id: conversationId ?? '',
        user: 'zundamon-platform',
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
    let newConversationId = conversationId ?? '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.conversation_id) {
            newConversationId = json.conversation_id;
          }
          if (json.event === 'message' && json.answer) {
            fullText += json.answer;
          }
        } catch {
          // ignore parse errors for incomplete chunks
        }
      }
    }

    const script = fullText.trim();

    // ずんだ:/めたん: 形式でなければずんだもんの台詞として扱う
    const hasDialogueFormat = /^(ずんだ|めたん|ずんだもん|四国めたん|Z|M)[:：]/m.test(script);
    const finalScript = hasDialogueFormat ? script : `ずんだ: ${script}(1)`;

    return NextResponse.json({ script: finalScript, conversationId: newConversationId });
  } catch (err) {
    console.error('[/api/dify]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '不明なエラー' },
      { status: 500 },
    );
  }
}
