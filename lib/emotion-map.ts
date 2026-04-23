import { Character, Emotion } from './types';

interface EmotionConfig {
  blendShapes: Record<string, number>;
  voicevoxStyleCandidates: string[];
}

interface CharacterConfig {
  speakerName: string;       // VOICEVOX スピーカー名
  modelPath: string;         // VRM ファイルパス
  label: string;             // 表示名
  color: string;             // テーマカラー (Tailwind)
  emotions: Record<Emotion, EmotionConfig>;
}

export const CHARACTER_CONFIG: Record<Character, CharacterConfig> = {
  zundamon: {
    speakerName: 'ずんだもん',
    modelPath: '/models/zundamon.vrm',
    label: 'ずんだもん',
    color: 'green',
    emotions: {
      neutral:   { blendShapes: { neutral: 1.0 },               voicevoxStyleCandidates: ['ノーマル'] },
      happy:     { blendShapes: { happy: 0.9 },                 voicevoxStyleCandidates: ['あまあま'] },
      angry:     { blendShapes: { angry: 1.0 },                 voicevoxStyleCandidates: ['ツンツン'] },
      sad:       { blendShapes: { sad: 0.9 },                   voicevoxStyleCandidates: ['ノーマル', 'ささやき'] },
      surprised: { blendShapes: { surprised: 1.0, happy: 0.3 }, voicevoxStyleCandidates: ['あまあま', 'ノーマル'] },
      shy:       { blendShapes: { happy: 0.4, relaxed: 0.3 },   voicevoxStyleCandidates: ['ささやき', 'ヒソヒソ'] },
    },
  },
  metan: {
    speakerName: '四国めたん',
    modelPath: '/models/metan.vrm',
    label: '四国めたん',
    color: 'purple',
    emotions: {
      neutral:   { blendShapes: { neutral: 1.0 },               voicevoxStyleCandidates: ['ノーマル'] },
      happy:     { blendShapes: { happy: 0.9 },                 voicevoxStyleCandidates: ['あまあま'] },
      angry:     { blendShapes: { angry: 1.0 },                 voicevoxStyleCandidates: ['ツンツン'] },
      sad:       { blendShapes: { sad: 0.9 },                   voicevoxStyleCandidates: ['ノーマル', 'ささやき'] },
      surprised: { blendShapes: { surprised: 1.0, happy: 0.3 }, voicevoxStyleCandidates: ['ノーマル'] },
      shy:       { blendShapes: { happy: 0.4, relaxed: 0.3 },   voicevoxStyleCandidates: ['ささやき', 'ヒソヒソ'] },
    },
  },
};

export const EMOTION_LABELS: Record<Emotion, string> = {
  neutral:   'ノーマル',
  happy:     'うれしい',
  angry:     'おこ',
  sad:       'かなしい',
  surprised: 'びっくり',
  shy:       'はずかしい',
};

export const EMOTION_COLORS: Record<Emotion, string> = {
  neutral:   'bg-slate-400',
  happy:     'bg-amber-400',
  angry:     'bg-red-500',
  sad:       'bg-blue-400',
  surprised: 'bg-violet-500',
  shy:       'bg-pink-400',
};

export const EMOTION_ICON_SYMBOL: Record<Emotion, string> = {
  neutral:   'ー',
  happy:     '☆',
  angry:     '×',
  sad:       '…',
  surprised: '!?',
  shy:       '〇',
};

export const EMOTION_GLOW: Record<Emotion, string> = {
  neutral:   'shadow-slate-400/40',
  happy:     'shadow-amber-400/40',
  angry:     'shadow-red-500/40',
  sad:       'shadow-blue-400/40',
  surprised: 'shadow-violet-500/40',
  shy:       'shadow-pink-400/40',
};

export const EMOTION_BORDER: Record<Emotion, string> = {
  neutral:   'border-slate-400',
  happy:     'border-amber-400',
  angry:     'border-red-500',
  sad:       'border-blue-400',
  surprised: 'border-violet-500',
  shy:       'border-pink-400',
};

export const EMOTION_TEXT: Record<Emotion, string> = {
  neutral:   'text-slate-500',
  happy:     'text-amber-500',
  angry:     'text-red-500',
  sad:       'text-blue-500',
  surprised: 'text-violet-500',
  shy:       'text-pink-500',
};

// 後方互換: 感情のエフェクト設定 (page.tsx の背景エフェクト用)
export const EMOTION_EFFECTS: Record<Emotion, {
  bg: string; dotColor: string; vignette: string;
  overlayBg?: string; aura: string; ring1: string; ring2: string;
}> = {
  neutral:   { bg: 'from-slate-50 to-green-50',   dotColor: '#86efac', vignette: 'rgba(134,239,172,0.15)', aura: 'rgba(134,239,172,0.08)', ring1: 'border-green-200/30 w-[480px] h-[480px] -bottom-24 -left-24',  ring2: 'border-green-300/20 w-[320px] h-[320px] -bottom-10 -left-10'  },
  happy:     { bg: 'from-yellow-50 to-amber-50',  dotColor: '#fcd34d', vignette: 'rgba(252,211,77,0.2)',   aura: 'rgba(252,211,77,0.12)',  ring1: 'border-yellow-300/40 w-[520px] h-[520px] -bottom-28 -left-28', ring2: 'border-amber-300/30 w-[340px] h-[340px] -bottom-12 -left-12'  },
  angry:     { bg: 'from-red-50 to-orange-50',    dotColor: '#fca5a5', vignette: 'rgba(252,165,165,0.25)', overlayBg: 'rgba(239,68,68,0.04)', aura: 'rgba(239,68,68,0.1)', ring1: 'border-red-300/40 w-[500px] h-[500px] -bottom-24 -left-24', ring2: 'border-orange-300/30 w-[320px] h-[320px] -bottom-8 -left-8' },
  sad:       { bg: 'from-blue-50 to-slate-100',   dotColor: '#93c5fd', vignette: 'rgba(147,197,253,0.2)',  aura: 'rgba(147,197,253,0.08)', ring1: 'border-blue-200/30 w-[480px] h-[480px] -bottom-24 -left-24',  ring2: 'border-slate-300/20 w-[300px] h-[300px] -bottom-8 -left-8'   },
  surprised: { bg: 'from-violet-50 to-purple-50', dotColor: '#c4b5fd', vignette: 'rgba(196,181,253,0.2)',  aura: 'rgba(167,139,250,0.12)', ring1: 'border-violet-300/40 w-[540px] h-[540px] -bottom-28 -left-28', ring2: 'border-purple-300/30 w-[360px] h-[360px] -bottom-14 -left-14' },
  shy:       { bg: 'from-pink-50 to-rose-50',     dotColor: '#fda4af', vignette: 'rgba(253,164,175,0.2)',  aura: 'rgba(251,113,133,0.1)',  ring1: 'border-pink-200/40 w-[480px] h-[480px] -bottom-24 -left-24',  ring2: 'border-rose-300/20 w-[300px] h-[300px] -bottom-8 -left-8'    },
};
