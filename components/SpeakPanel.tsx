'use client';

import { useState, useRef } from 'react';
import { Emotion } from '@/lib/types';
import { EMOTION_LABELS, EMOTION_COLORS } from '@/lib/emotion-map';

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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-gray-900 rounded-xl border border-gray-700">
      {/* 感情ボタン */}
      <div className="flex flex-wrap gap-2">
        {EMOTIONS.map((em) => (
          <button
            key={em}
            onClick={() => setEmotion(em)}
            className={`px-3 py-1 rounded-full text-sm font-medium text-white transition-all
              ${EMOTION_COLORS[em]}
              ${emotion === em ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900 scale-105' : 'opacity-70'}
            `}
          >
            {EMOTION_LABELS[em]}
          </button>
        ))}
      </div>

      {/* テキスト入力 */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="ずんだもんに喋らせるテキストを入力..."
        rows={3}
        className="w-full bg-gray-800 text-white rounded-lg p-3 resize-none border border-gray-600
                   focus:outline-none focus:border-green-400 placeholder-gray-500 text-sm"
      />

      {/* エラー表示 */}
      {error && (
        <p className="text-red-400 text-sm bg-red-900/30 rounded-lg px-3 py-2 border border-red-800">
          {error}
        </p>
      )}

      {/* 送信ボタン */}
      <button
        onClick={handleSubmit}
        disabled={!text.trim() || isLoading}
        className="w-full py-2.5 rounded-lg font-bold text-white transition-all
                   bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed
                   flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
            処理中...
          </>
        ) : (
          <>
            ▶ 喋らせる
            <span className="text-xs opacity-60 font-normal">Ctrl+Enter</span>
          </>
        )}
      </button>
    </div>
  );
}
