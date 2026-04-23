import type { Character, Emotion } from './types';

export interface DialogueLine {
  character: Character;
  text: string;
  emotion: Emotion;
}

export const EMOTION_BY_NUMBER: Record<string, Emotion> = {
  '1': 'neutral',
  '2': 'happy',
  '3': 'angry',
  '4': 'sad',
  '5': 'surprised',
  '6': 'shy',
};

const ZUNDAMON_PREFIXES = ['ずんだ', 'ずんだもん', 'Z', 'z'];
const METAN_PREFIXES    = ['めたん', 'メタン', '四国めたん', 'M', 'm'];

function toHalfWidth(c: string): string {
  return c.charCodeAt(0) > 127 ? String.fromCharCode(c.charCodeAt(0) - 0xFEE0) : c;
}

function extractEmotion(text: string, defaultEmotion: Emotion): [string, Emotion] {
  const m = text.match(/[（(]([1-6１-６])[）)]\s*$/);
  if (m) {
    const emotion = EMOTION_BY_NUMBER[toHalfWidth(m[1])] ?? defaultEmotion;
    return [text.replace(/[（(]([1-6１-６])[）)]\s*$/, '').trim(), emotion];
  }
  return [text, defaultEmotion];
}

/**
 * 会話スクリプトを DialogueLine[] にパースする。
 *
 * 対応書式:
 *   - `ずんだ: テキスト(2)`   … 話者プレフィックス + 末尾感情番号
 *   - `めたん: テキスト`      … 感情省略時は defaultEmotion
 *   - `テキスト_z2`           … サフィックス形式 (z=ずんだ, m=めたん)
 *   - `テキスト_m3`
 *
 * 感情番号: 1=neutral / 2=happy / 3=angry / 4=sad / 5=surprised / 6=shy
 */
export function parseDialogueScript(script: string, defaultEmotion: Emotion = 'neutral'): DialogueLine[] {
  const allPrefixes = [...ZUNDAMON_PREFIXES, ...METAN_PREFIXES].join('|');
  const prefixRe = new RegExp(`^(${allPrefixes})\\s*[:：]\\s*(.+)$`);
  const suffixRe = /^(.+?)_([zZmM])([1-6])\s*$/;

  return script
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line): DialogueLine[] => {
      const pm = line.match(prefixRe);
      if (pm) {
        const character: Character = ZUNDAMON_PREFIXES.includes(pm[1]) ? 'zundamon' : 'metan';
        const [text, emotion] = extractEmotion(pm[2].trim(), defaultEmotion);
        return [{ character, text, emotion }];
      }
      const sm = line.match(suffixRe);
      if (sm) {
        const character: Character = sm[2].toLowerCase() === 'z' ? 'zundamon' : 'metan';
        const emotion = EMOTION_BY_NUMBER[sm[3]] ?? defaultEmotion;
        return [{ character, text: sm[1].trim(), emotion }];
      }
      return [];
    });
}
