import { Character, Emotion } from './types';

const ZUNDAMON_SUFFIXES: Record<Emotion, string[]> = {
  neutral:   ['なのだ', 'のだ', 'なのだ'],
  happy:     ['なのだ〜', 'のだ！', 'なのだよ〜'],
  angry:     ['なのだ！', 'のだ！！', 'なのだぞ！'],
  sad:       ['なのだ…', 'のだ…', 'なのだよ…'],
  surprised: ['なのだ！？', 'のだ！？', 'なのだ！'],
  shy:       ['なのだ…', 'のだ…', 'なのだよ…'],
};

const METAN_SUFFIXES: Record<Emotion, string[]> = {
  neutral:   ['ですわ', 'わね', 'かしら'],
  happy:     ['ですわ〜！', 'うれしいですわ！', 'わよ！'],
  angry:     ['いやですわ！', 'もうっ！', 'ですわ！！'],
  sad:       ['ですわ…', 'かしら…', 'わね…'],
  surprised: ['まあ！', 'うそ！？', 'ですわ！？'],
  shy:       ['ですわ…', 'かしら…', 'はずかしいですわ…'],
};

function stripSuffix(text: string): [string, string] {
  const punct = text.match(/[。！？!?]+$/)?.[0] ?? '';
  return [text.replace(/[。！？!?]+$/, ''), punct];
}

function removePoliteSuffix(text: string): string {
  return text
    .replace(/です$/, '').replace(/ます$/, '')
    .replace(/でした$/, '').replace(/ました$/, '')
    .replace(/だよ$/, '').replace(/だね$/, '')
    .replace(/だよね$/, '').replace(/だ$/, '');
}

export function transformText(text: string, emotion: Emotion, character: Character): string {
  const suffixes = character === 'zundamon' ? ZUNDAMON_SUFFIXES : METAN_SUFFIXES;
  const alreadyDone = character === 'zundamon'
    ? /[のな]だ[〜！？…!?]*$/.test(text.trim())
    : /ですわ|かしら|ですの|ですわよ/.test(text.trim());

  let [result, punct] = stripSuffix(text.trim());
  if (alreadyDone) return result + punct;

  result = removePoliteSuffix(result);
  const options = suffixes[emotion];
  const suffix = options[Math.floor(Math.random() * options.length)];
  return result + suffix + (punct === '。' ? '' : punct);
}

// 後方互換
export function transformToZundamon(text: string, emotion: Emotion): string {
  return transformText(text, emotion, 'zundamon');
}
