import { Emotion } from './types';

export const EMOTION_MAP: Record<Emotion, {
  blendShapes: Record<string, number>;
  voicevoxStyleId: number;
  /** VOICEVOXスタイル名の候補 (先頭から順に試す) */
  voicevoxStyleCandidates: string[];
}> = {
  neutral:   {
    blendShapes: { neutral: 1.0 },
    voicevoxStyleId: 3,
    voicevoxStyleCandidates: ['ノーマル', 'normal'],
  },
  happy:     {
    blendShapes: { happy: 0.9 },
    voicevoxStyleId: 1,
    voicevoxStyleCandidates: ['あまあま', 'あまあま（英語）', 'ノーマル'],
  },
  angry:     {
    blendShapes: { angry: 1.0 },
    voicevoxStyleId: 7,
    voicevoxStyleCandidates: ['ツンツン', 'ツンツン（英語）', 'ノーマル'],
  },
  sad:       {
    blendShapes: { sad: 0.9 },
    voicevoxStyleId: 3,
    voicevoxStyleCandidates: ['ノーマル', 'ささやき'],
  },
  surprised: {
    blendShapes: { surprised: 1.0, happy: 0.3 },
    voicevoxStyleId: 1,
    voicevoxStyleCandidates: ['あまあま', 'ノーマル'],
  },
  shy:       {
    blendShapes: { happy: 0.4, relaxed: 0.3 },
    voicevoxStyleId: 5,
    voicevoxStyleCandidates: ['ささやき', 'ヒソヒソ', 'あまあま'],
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
  neutral:   'bg-slate-500',
  happy:     'bg-amber-500',
  angry:     'bg-red-500',
  sad:       'bg-blue-500',
  surprised: 'bg-violet-500',
  shy:       'bg-pink-500',
};

export const EMOTION_ICON_SYMBOL: Record<Emotion, string> = {
  neutral:   '—',
  happy:     '+',
  angry:     '!',
  sad:       '~',
  surprised: '?',
  shy:       '*',
};

export const EMOTION_GLOW: Record<Emotion, string> = {
  neutral:   'shadow-slate-500/40',
  happy:     'shadow-amber-500/40',
  angry:     'shadow-red-500/40',
  sad:       'shadow-blue-500/40',
  surprised: 'shadow-violet-500/40',
  shy:       'shadow-pink-500/40',
};

export const EMOTION_BORDER: Record<Emotion, string> = {
  neutral:   'border-slate-500',
  happy:     'border-amber-500',
  angry:     'border-red-500',
  sad:       'border-blue-500',
  surprised: 'border-violet-500',
  shy:       'border-pink-500',
};

export const EMOTION_TEXT: Record<Emotion, string> = {
  neutral:   'text-slate-600',
  happy:     'text-amber-600',
  angry:     'text-red-600',
  sad:       'text-blue-600',
  surprised: 'text-violet-600',
  shy:       'text-pink-600',
};

/** Per-emotion visual effect config for the VRM viewer area */
export interface EmotionEffect {
  bg: string;
  vignette: string;
  dotColor: string;
  ring1: string;
  ring2: string;
  aura: string;
  overlayBg: string;
}

export const EMOTION_EFFECTS: Record<Emotion, EmotionEffect> = {
  neutral: {
    bg:       '#f0faf4',
    vignette: '#e8f5ee',
    dotColor: '#16a34a18',
    ring1:    'border-green-500/15',
    ring2:    'border-emerald-400/15',
    aura:     'rgba(22,163,74,0.10)',
    overlayBg: '',
  },
  happy: {
    bg:       '#fffbeb',
    vignette: '#fef3c7',
    dotColor: '#f59e0b18',
    ring1:    'border-amber-400/20',
    ring2:    'border-yellow-300/20',
    aura:     'rgba(245,158,11,0.15)',
    overlayBg: 'radial-gradient(ellipse at 50% 80%, rgba(251,191,36,0.18) 0%, transparent 70%)',
  },
  angry: {
    bg:       '#fff5f5',
    vignette: '#fee2e2',
    dotColor: '#ef444418',
    ring1:    'border-red-500/25',
    ring2:    'border-orange-400/20',
    aura:     'rgba(239,68,68,0.18)',
    overlayBg: 'repeating-linear-gradient(135deg, transparent, transparent 18px, rgba(239,68,68,0.04) 18px, rgba(239,68,68,0.04) 20px)',
  },
  sad: {
    bg:       '#eff6ff',
    vignette: '#dbeafe',
    dotColor: '#3b82f618',
    ring1:    'border-blue-400/20',
    ring2:    'border-sky-300/20',
    aura:     'rgba(59,130,246,0.14)',
    overlayBg: 'linear-gradient(180deg, transparent 40%, rgba(59,130,246,0.10) 100%)',
  },
  surprised: {
    bg:       '#f5f3ff',
    vignette: '#ede9fe',
    dotColor: '#8b5cf618',
    ring1:    'border-violet-500/20',
    ring2:    'border-purple-300/20',
    aura:     'rgba(139,92,246,0.16)',
    overlayBg: 'radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.15) 0%, transparent 65%)',
  },
  shy: {
    bg:       '#fdf2f8',
    vignette: '#fce7f3',
    dotColor: '#ec489918',
    ring1:    'border-pink-400/20',
    ring2:    'border-rose-300/20',
    aura:     'rgba(236,72,153,0.14)',
    overlayBg: 'radial-gradient(circle at 70% 30%, rgba(251,113,133,0.18) 0%, transparent 55%), radial-gradient(circle at 30% 70%, rgba(236,72,153,0.12) 0%, transparent 50%)',
  },
};
