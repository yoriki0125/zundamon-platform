import { Emotion } from './types';

// ずんだもん口調への簡易変換 (Claude API不要)
export function transformToZundamon(text: string, emotion: Emotion): string {
  let result = text.trim();

  // 文末の句読点を除去して後で付け直す
  const punct = result.match(/[。！？!?]+$/)?.[0] ?? '';
  result = result.replace(/[。！？!?]+$/, '');

  // 感情別の語尾
  const suffixes: Record<Emotion, string[]> = {
    neutral:   ['なのだ', 'のだ', 'なのだ'],
    happy:     ['なのだ〜', 'のだ！', 'なのだよ〜'],
    angry:     ['なのだ！', 'のだ！！', 'なのだぞ！'],
    sad:       ['なのだ…', 'のだ…', 'なのだよ…'],
    surprised: ['なのだ！？', 'のだ！？', 'なのだ！'],
    shy:       ['なのだ…', 'のだ…', 'なのだよ…'],
  };

  const options = suffixes[emotion];
  const suffix = options[Math.floor(Math.random() * options.length)];

  // 既に「のだ」系で終わっていれば変換しない
  if (/[のな]だ[〜！？…!?]*$/.test(result)) {
    return result + punct;
  }

  // 「です」「ます」系を置換
  result = result
    .replace(/です$/, '')
    .replace(/ます$/, '')
    .replace(/でした$/, '')
    .replace(/ました$/, '')
    .replace(/ください$/, 'してほしいのだ')
    .replace(/してください$/, 'してほしいのだ');

  // 「だ」「だよ」「だね」等を置換
  result = result
    .replace(/だよ$/, '')
    .replace(/だね$/, '')
    .replace(/だよね$/, '')
    .replace(/だ$/, '');

  return result + suffix + (punct === '。' ? '' : punct);
}
