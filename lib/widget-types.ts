import type { Character, Emotion } from '@/lib/types';

export type WidgetMode = 'embedded' | 'floating' | 'fullscreen';

export interface WidgetTheme {
  primaryColor?: string;
  accentColor?: string;
  surfaceColor?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: number;
}

export interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  emotion?: Emotion;
  character?: Character;
  spokenText?: string;
  timestamp: string;
}

export interface WidgetConversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: WidgetMessage[];
}

export interface WidgetInitConfig {
  mode?: WidgetMode;
  humanId?: string;
  tenantId?: string;
  userId?: string;
  token?: string;
  parentOrigin?: string;
  title?: string;
  subtitle?: string;
  characterName?: string;
  defaultEmotion?: Emotion;
  aiEndpoint?: string;
  locale?: string;
  context?: Record<string, unknown>;
  suggestedPrompts?: string[];
  theme?: WidgetTheme;
  /**
   * true にするとコントロールパネル（感情ボタン／デバッグ情報など）を表示。
   * 通常は隠しコマンド (Ctrl+Shift+D) でオン／オフ切り替え。
   */
  showDebugPanel?: boolean;
}

export interface WidgetCommandPayload {
  text?: string;
  emotion?: Emotion;
  token?: string;
  context?: Record<string, unknown>;
}
