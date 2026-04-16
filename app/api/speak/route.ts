import { NextRequest, NextResponse } from 'next/server';
import { Emotion, SpeakResponse } from '@/lib/types';
import { EMOTION_MAP } from '@/lib/emotion-map';
import { transformToZundamon } from '@/lib/zundamon-transform';
import { resolveStyleId } from '@/lib/voicevox';

export async function POST(req: NextRequest) {
  try {
    const { text, emotion } = (await req.json()) as { text: string; emotion: Emotion };

    if (!text || !emotion) {
      return NextResponse.json({ error: 'text と emotion は必須です' }, { status: 400 });
    }

    const emotionConfig = EMOTION_MAP[emotion];
    if (!emotionConfig) {
      return NextResponse.json({ error: '不明な emotion です' }, { status: 400 });
    }

    const spokenText = transformToZundamon(text, emotion);

    // VOICEVOXからずんだもんの実際のスタイルIDを動的に解決
    let voicevoxStyleId = emotionConfig.voicevoxStyleId;
    try {
      voicevoxStyleId = await resolveStyleId(emotionConfig.voicevoxStyleCandidates);
    } catch {
      // VOICEVOXが起動していない場合はフォールバック値を使用
      console.warn(`[/api/speak] スタイルID解決失敗、フォールバック: ${voicevoxStyleId}`);
    }

    const response: SpeakResponse = {
      spokenText,
      blendShapes: emotionConfig.blendShapes,
      voicevoxStyleId,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[/api/speak]', err);
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
