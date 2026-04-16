'use client';

import { HistoryItem } from '@/lib/types';
import { EMOTION_LABELS, EMOTION_COLORS } from '@/lib/emotion-map';

interface HistoryListProps {
  items: HistoryItem[];
  onReplay: (item: HistoryItem) => void;
  isLoading: boolean;
}

export default function HistoryList({ items, onReplay, isLoading }: HistoryListProps) {
  if (items.length === 0) {
    return (
      <div className="text-gray-500 text-sm text-center py-8">
        発話履歴がありません
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-full pr-1">
      {[...items].reverse().map((item) => (
        <button
          key={item.id}
          onClick={() => !isLoading && onReplay(item)}
          disabled={isLoading}
          className="text-left p-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700
                     hover:border-gray-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${EMOTION_COLORS[item.emotion]}`}
            >
              {EMOTION_LABELS[item.emotion]}
            </span>
            <span className="text-gray-500 text-xs">
              {item.timestamp.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
          <p className="text-gray-300 text-sm line-clamp-2">{item.spokenText}</p>
          {item.text !== item.spokenText && (
            <p className="text-gray-600 text-xs mt-1 line-clamp-1">元: {item.text}</p>
          )}
        </button>
      ))}
    </div>
  );
}
