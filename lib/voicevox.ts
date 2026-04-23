const VOICEVOX_BASE =
  (typeof window === 'undefined'
    ? process.env.VOICEVOX_URL
    : process.env.NEXT_PUBLIC_VOICEVOX_URL) ?? 'http://localhost:50021';

interface VoicevoxStyle { name: string; id: number; }
interface VoicevoxSpeaker { name: string; styles: VoicevoxStyle[]; }

// キャラクター別スタイルキャッシュ
const styleCache: Record<string, Record<string, number>> = {};

export async function getSpeakerStyles(speakerName: string): Promise<Record<string, number>> {
  if (styleCache[speakerName]) return styleCache[speakerName];

  const res = await fetch(`${VOICEVOX_BASE}/speakers`);
  if (!res.ok) throw new Error('VOICEVOX speakers 取得失敗');

  const speakers: VoicevoxSpeaker[] = await res.json();
  const speaker = speakers.find((s) => s.name === speakerName || s.name.includes(speakerName));
  if (!speaker) throw new Error(`${speakerName} が見つかりません`);

  const map: Record<string, number> = {};
  for (const style of speaker.styles) map[style.name] = style.id;

  styleCache[speakerName] = map;
  return map;
}

export async function resolveStyleId(speakerName: string, candidates: string[]): Promise<number> {
  const styles = await getSpeakerStyles(speakerName);
  for (const name of candidates) {
    if (styles[name] !== undefined) return styles[name];
  }
  return Object.values(styles)[0] ?? 3;
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
  const queryRes = await fetch(
    `${VOICEVOX_BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`,
    { method: 'POST' }
  );
  if (!queryRes.ok) throw new Error(`VOICEVOX audio_query failed: ${queryRes.status}`);
  const query: AudioQueryResult = await queryRes.json();

  const synthRes = await fetch(`${VOICEVOX_BASE}/synthesis?speaker=${styleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!synthRes.ok) throw new Error(`VOICEVOX synthesis failed: ${synthRes.status}`);

  return { audioBlob: await synthRes.blob(), accentPhrases: query.accentPhrases };
}

export async function checkVoicevox(): Promise<boolean> {
  try {
    const res = await fetch(`${VOICEVOX_BASE}/version`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
