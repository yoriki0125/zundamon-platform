// サーバー側: VOICEVOX_URL 環境変数、なければ localhost
// クライアント側: NEXT_PUBLIC_VOICEVOX_URL 環境変数、なければ localhost
const VOICEVOX_BASE =
  (typeof window === 'undefined'
    ? process.env.VOICEVOX_URL
    : process.env.NEXT_PUBLIC_VOICEVOX_URL) ?? 'http://localhost:50021';

// ずんだもんスタイル名 → VOICEVOXスタイルIDのキャッシュ
let zundamonStyleCache: Record<string, number> | null = null;

interface VoicevoxStyle {
  name: string;
  id: number;
}
interface VoicevoxSpeaker {
  name: string;
  styles: VoicevoxStyle[];
}

/** VOICEVOXからずんだもんのスタイル一覧を取得してキャッシュ */
export async function getZundamonStyles(): Promise<Record<string, number>> {
  if (zundamonStyleCache) return zundamonStyleCache;

  const res = await fetch(`${VOICEVOX_BASE}/speakers`);
  if (!res.ok) throw new Error('VOICEVOX speakers 取得失敗');

  const speakers: VoicevoxSpeaker[] = await res.json();
  const zundamon = speakers.find((s) => s.name.includes('ずんだもん'));
  if (!zundamon) throw new Error('ずんだもんが見つかりません');

  const map: Record<string, number> = {};
  for (const style of zundamon.styles) {
    map[style.name] = style.id;
  }

  console.log('[VOICEVOX] ずんだもんスタイル:', map);
  zundamonStyleCache = map;
  return map;
}

/**
 * スタイル名からIDを解決する。
 * 候補を順番に試し、見つからなければ最初のスタイルIDを返す。
 */
export async function resolveStyleId(candidates: string[]): Promise<number> {
  const styles = await getZundamonStyles();
  for (const name of candidates) {
    if (styles[name] !== undefined) return styles[name];
  }
  // フォールバック: 最初のスタイル
  const first = Object.values(styles)[0];
  return first ?? 3;
}

export interface AudioQueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accentPhrases: any[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  kana: string;
}

export async function synthesize(
  text: string,
  styleId: number
): Promise<{ audioBlob: Blob; accentPhrases: AudioQueryResult['accentPhrases'] }> {
  // audio_query で韻律情報を取得
  const queryRes = await fetch(
    `${VOICEVOX_BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`,
    { method: 'POST' }
  );

  if (!queryRes.ok) {
    throw new Error(`VOICEVOX audio_query failed: ${queryRes.status}`);
  }

  const query: AudioQueryResult = await queryRes.json();

  // synthesis で wav を取得
  const synthRes = await fetch(
    `${VOICEVOX_BASE}/synthesis?speaker=${styleId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }
  );

  if (!synthRes.ok) {
    throw new Error(`VOICEVOX synthesis failed: ${synthRes.status}`);
  }

  const audioBlob = await synthRes.blob();

  return { audioBlob, accentPhrases: query.accentPhrases };
}

export async function checkVoicevox(): Promise<boolean> {
  try {
    const res = await fetch(`${VOICEVOX_BASE}/version`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
