import { NextRequest, NextResponse } from 'next/server';
import { Character, Emotion, SpeakResponse } from '@/lib/types';
import { CHARACTER_CONFIG } from '@/lib/emotion-map';
import { transformText } from '@/lib/zundamon-transform';
import { resolveStyleId } from '@/lib/voicevox';

export async function POST(req: NextRequest) {
  try {
    const { text, emotion, character = 'zundamon' } =
      (await req.json()) as { text: string; emotion: Emotion; character?: Character };

    if (!text || !emotion) {
      return NextResponse.json({ error: 'text と emotion は必須です' }, { status: 400 });
    }

    const charConfig = CHARACTER_CONFIG[character];
    if (!charConfig) {
      return NextResponse.json({ error: '不明な character です' }, { status: 400 });
    }

    const emotionConfig = charConfig.emotions[emotion];
    // URLは読み上げに適さないので除去する
    const cleanText = text.replace(/https?:\/\/\S+/g, '').trim();
    const spokenText = transformText(cleanText || text, emotion, character);

    let voicevoxStyleId = emotionConfig.voicevoxStyleCandidates.length > 0 ? 3 : 2;
    try {
      voicevoxStyleId = await resolveStyleId(
        charConfig.speakerName,
        emotionConfig.voicevoxStyleCandidates,
      );
    } catch {
      console.warn(`[/api/speak] スタイルID解決失敗`);
    }

    const response: SpeakResponse = {
      spokenText,
      blendShapes: emotionConfig.blendShapes,
      voicevoxStyleId,
      character,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[/api/speak]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '不明なエラー' },
      { status: 500 },
    );
  }
}
