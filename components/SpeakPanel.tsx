'use client';

import { useState, useRef } from 'react';
import { Emotion } from '@/lib/types';
import {
  EMOTION_LABELS,
  EMOTION_COLORS,
  EMOTION_ICON_SYMBOL,
  EMOTION_GLOW,
  EMOTION_BORDER,
  EMOTION_TEXT,
} from '@/lib/emotion-map';
import { cn } from '@/lib/utils';

const EMOTIONS: Emotion[] = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'shy'];

interface SpeakPanelProps {
  onSpeak: (text: string, emotion: Emotion) => void;
  isLoading: boolean;
  error: string | null;
}

export default function SpeakPanel({ onSpeak, isLoading, error }: SpeakPanelProps) {
  const [text, setText] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!text.trim() || isLoading) return;
    onSpeak(text.trim(), emotion);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Section label */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-[var(--zunda-green)] rounded-full shadow-[0_0_8px_var(--zunda-green)]" />
        <span className="text-xs font-bold tracking-widest text-[var(--zunda-green)] uppercase">
          感情を選ぶ
        </span>
      </div>

      {/* 感情ボタングリッド */}
      <div className="grid grid-cols-3 gap-2">
        {EMOTIONS.map((em) => {
          const isSelected = emotion === em;
          return (
            <button
              key={em}
              type="button"
              onClick={() => setEmotion(em)}
              className={cn(
                'relative flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border transition-all duration-200',
                'text-xs font-bold',
                isSelected
                  ? [
                      EMOTION_COLORS[em],
                      EMOTION_BORDER[em],
                      `shadow-lg ${EMOTION_GLOW[em]}`,
                      'text-white scale-[1.04]',
                    ]
                  : [
                      'bg-[var(--zunda-surface)] border-[var(--zunda-panel-border)]',
                      EMOTION_TEXT[em],
                      'hover:bg-[var(--zunda-surface-hover)] hover:scale-[1.02]',
                    ]
              )}
            >
              {isSelected && (
                <span className="absolute inset-0 rounded-xl opacity-20 bg-white pointer-events-none" />
              )}
              <span className="text-base leading-none font-black">{EMOTION_ICON_SYMBOL[em]}</span>
              <span className="leading-none tracking-wide">{EMOTION_LABELS[em]}</span>
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-px bg-[var(--zunda-panel-border)]" />

      {/* テキスト入力ラベル */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-[var(--zunda-cyan)] rounded-full shadow-[0_0_8px_var(--zunda-cyan)]" />
        <span className="text-xs font-bold tracking-widest text-[var(--zunda-cyan)] uppercase">
          セリフを入力
        </span>
      </div>

      {/* テキストエリア */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="キャラクターに喋らせるテキストを入力..."
          rows={3}
          className={cn(
            'w-full rounded-xl p-3 resize-none text-sm leading-relaxed',
            'bg-[var(--zunda-surface)] text-foreground placeholder:text-muted-foreground',
            'border border-[var(--zunda-panel-border)]',
            'focus:outline-none focus:border-[var(--zunda-green)]',
            'focus:shadow-[0_0_0_2px_var(--zunda-green-glow)]',
            'transition-all duration-200'
          )}
        />
        <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground select-none">
          {text.length} 文字
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-500 text-sm mt-0.5 font-bold select-none">!</span>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* 送信ボタン */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!text.trim() || isLoading}
        className={cn(
          'relative w-full py-3 rounded-xl font-black text-sm tracking-widest uppercase',
          'flex items-center justify-center gap-2 transition-all duration-200',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          !isLoading && text.trim()
            ? [
                'bg-[var(--zunda-green)] text-[var(--primary-foreground)]',
                'hover:brightness-110 hover:shadow-lg hover:shadow-[var(--zunda-green-glow)]',
                'active:scale-[0.98]',
              ]
            : 'bg-[var(--zunda-surface)] text-muted-foreground border border-[var(--zunda-panel-border)]'
        )}
      >
        {isLoading ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>処理中...</span>
          </>
        ) : (
          <>
            <span>▶ 喋らせる</span>
            <span className="text-[10px] opacity-60 font-normal normal-case tracking-normal border border-current/30 rounded px-1 py-0.5">
              Ctrl+Enter
            </span>
          </>
        )}
      </button>
    </div>
  );
}
