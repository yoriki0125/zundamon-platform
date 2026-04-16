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
  neutral:   'bg-gray-500 hover:bg-gray-400',
  happy:     'bg-yellow-500 hover:bg-yellow-400',
  angry:     'bg-red-500 hover:bg-red-400',
  sad:       'bg-blue-500 hover:bg-blue-400',
  surprised: 'bg-purple-500 hover:bg-purple-400',
  shy:       'bg-pink-500 hover:bg-pink-400',
};
