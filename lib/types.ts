export type Emotion = 'neutral' | 'happy' | 'angry' | 'sad' | 'surprised' | 'shy';
export type Character = 'zundamon' | 'metan';

export interface SpeakRequest {
  text: string;
  emotion: Emotion;
  character: Character;
}

export interface SpeakResponse {
  spokenText: string;
  blendShapes: Record<string, number>;
  voicevoxStyleId: number;
  character: Character;
}

export interface HistoryItem {
  id: string;
  text: string;
  spokenText: string;
  emotion: Emotion;
  character: Character;
  blendShapes: Record<string, number>;
  voicevoxStyleId: number;
  timestamp: Date;
}
