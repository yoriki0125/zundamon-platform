export type Emotion = 'neutral' | 'happy' | 'angry' | 'sad' | 'surprised' | 'shy';

export interface SpeakRequest {
  text: string;
  emotion: Emotion;
}

export interface SpeakResponse {
  spokenText: string;
  blendShapes: Record<string, number>;
  voicevoxStyleId: number;
}

export interface HistoryItem {
  id: string;
  text: string;
  spokenText: string;
  emotion: Emotion;
  blendShapes: Record<string, number>;
  voicevoxStyleId: number;
  timestamp: Date;
}
