'use client';

import { HistoryItem } from '@/lib/types';
import {
  EMOTION_LABELS,
  EMOTION_COLORS,
  EMOTION_ICON_SYMBOL,
  EMOTION_TEXT,
  EMOTION_BORDER,
} from '@/lib/emotion-map';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HistoryListProps {
  items: HistoryItem[];
  onReplay: (item: HistoryItem) => void;
  isLoading: boolean;
}

export default function HistoryList({ items, onReplay, isLoading }: HistoryListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--zunda-surface)] border border-[var(--zunda-panel-border)] flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <p className="text-muted-foreground text-sm">まだ発話履歴がありません</p>
        <p className="text-muted-foreground/50 text-xs">喋らせると履歴が表示されます</p>
      </div>
    );
  }

  const sorted = [...items].reverse();

  return (
    <ScrollArea className="h-full pr-1">
      <div className="flex flex-col gap-2 pb-2">
        {sorted.map((item, index) => {
          const isLatest = index === 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => !isLoading && onReplay(item)}
              disabled={isLoading}
              className={cn(
                'group relative text-left rounded-xl border transition-all duration-200',
                'p-3 w-full',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isLatest
                  ? [
                      'bg-[var(--zunda-surface)] border-[var(--zunda-green)]/50',
                      'hover:border-[var(--zunda-green)] hover:shadow-md hover:shadow-[var(--zunda-green-glow)]',
                    ]
                  : [
                      'bg-[var(--zunda-surface)] border-[var(--zunda-panel-border)]',
                      'hover:bg-[var(--zunda-surface-hover)] hover:border-[var(--zunda-panel-border)]/80',
                    ]
              )}
            >
              {/* 最新アイテムの左ボーダーグロー */}
              {isLatest && (
                <div className="absolute left-0 top-3 bottom-3 w-0.5 bg-[var(--zunda-green)] rounded-full shadow-[0_0_6px_var(--zunda-green)]" />
              )}

              {/* ヘッダー行 */}
              <div className="flex items-center gap-2 mb-1.5 pl-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white border',
                    EMOTION_COLORS[item.emotion],
                    EMOTION_BORDER[item.emotion],
                    'border-opacity-60'
                  )}
                >
                  <span className="font-black">{EMOTION_ICON_SYMBOL[item.emotion]}</span>
                  {EMOTION_LABELS[item.emotion]}
                </span>

                {isLatest && (
                  <span className="text-[9px] font-black tracking-widest uppercase text-[var(--zunda-green)] opacity-80">
                    NEW
                  </span>
                )}

                <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums">
                  {item.timestamp.toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              {/* 発話テキスト */}
              <p className="text-foreground text-sm leading-relaxed line-clamp-2 pl-2">
                {item.spokenText}
              </p>

              {/* 元テキスト（変換後と異なる場合） */}
              {item.text !== item.spokenText && (
                <p className="text-muted-foreground/50 text-xs mt-1 line-clamp-1 pl-2">
                  元テキスト: {item.text}
                </p>
              )}

              {/* ホバー時の再生ヒント */}
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                <span className={cn(
                  'text-xs font-bold flex items-center gap-1.5',
                  'bg-white px-3 py-1.5 rounded-full shadow-sm',
                  'border border-[var(--zunda-green)]/50',
                  EMOTION_TEXT[item.emotion]
                )}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <polygon points="2,1 9,5 2,9" />
                  </svg>
                  もう一度再生
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
