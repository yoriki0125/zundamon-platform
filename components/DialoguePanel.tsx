'use client';

import { useState, useRef } from 'react';
import { Character, Emotion } from '@/lib/types';
import {
  EMOTION_LABELS,
  EMOTION_COLORS,
  EMOTION_ICON_SYMBOL,
  EMOTION_GLOW,
  EMOTION_BORDER,
  EMOTION_TEXT,
  CHARACTER_CONFIG,
} from '@/lib/emotion-map';
import { cn } from '@/lib/utils';

export interface DialogueLine {
  character: Character;
  text: string;
  emotion: Emotion;
}

interface DialoguePanelProps {
  onPlay: (lines: DialogueLine[]) => void;
  isLoading: boolean;
  error: string | null;
}

const EMOTIONS: Emotion[] = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'shy'];

const EMOTION_BY_NUMBER: Record<string, Emotion> = {
  '1': 'neutral',
  '2': 'happy',
  '3': 'angry',
  '4': 'sad',
  '5': 'surprised',
  '6': 'shy',
};

const ZUNDAMON_PREFIXES = ['ずんだ', 'ずんだもん', 'Z', 'z'];
const METAN_PREFIXES = ['めたん', 'メタン', '四国めたん', '四国めた', 'M', 'm'];

function toHalfWidth(c: string): string {
  return c.charCodeAt(0) > 127 ? String.fromCharCode(c.charCodeAt(0) - 0xFEE0) : c;
}

function extractEmotion(text: string, defaultEmotion: Emotion): [string, Emotion] {
  const m = text.match(/[（(]([1-6１-６])[）)]\s*$/);
  if (m) {
    const emotion = EMOTION_BY_NUMBER[toHalfWidth(m[1])] ?? defaultEmotion;
    return [text.replace(/[（(]([1-6１-６])[）)]\s*$/, '').trim(), emotion];
  }
  return [text, defaultEmotion];
}

function parseScript(script: string, defaultEmotion: Emotion): DialogueLine[] {
  const allPrefixes = [...ZUNDAMON_PREFIXES, ...METAN_PREFIXES].join('|');
  const prefixRe = new RegExp(`^(${allPrefixes})\\s*[:：]\\s*(.+)$`);
  // テキスト_z2 / テキスト_m1 形式 (半角数字のみ)
  const suffixRe = /^(.+?)_([zZmM])([1-6])\s*$/;

  return script
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line): DialogueLine[] => {
      // 形式1: ずんだ: テキスト(2)
      const pm = line.match(prefixRe);
      if (pm) {
        const character: Character = ZUNDAMON_PREFIXES.includes(pm[1]) ? 'zundamon' : 'metan';
        let [text, emotion] = extractEmotion(pm[2].trim(), defaultEmotion);
        // _z1 / _m2 形式のサフィックスも処理（プレフィックスと混在する場合）
        const sfx = text.match(suffixRe);
        if (sfx) {
          emotion = EMOTION_BY_NUMBER[sfx[3]] ?? emotion;
          text = sfx[1].trim();
        }
        return [{ character, text, emotion }];
      }
      // 形式2: テキスト_z2 / テキスト_m3
      const sm = line.match(suffixRe);
      if (sm) {
        const character: Character = sm[2].toLowerCase() === 'z' ? 'zundamon' : 'metan';
        const emotion = EMOTION_BY_NUMBER[sm[3]] ?? defaultEmotion;
        return [{ character, text: sm[1].trim(), emotion }];
      }
      return [];
    });
}

const PLACEHOLDER = `ずんだ: こんにちはなのだ！(2)
めたん: あら、ずんだもんさん。(1)
今日もいい天気なのだよ〜_z2
そうですわね〜_m1`;

export default function DialoguePanel({ onPlay, isLoading, error }: DialoguePanelProps) {
  const [script, setScript] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [aiTopic, setAiTopic] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const conversationIdRef = useRef<string>('');

  const parsed = parseScript(script, emotion);
  const canPlay = parsed.length > 0 && !isLoading;

  const handleSubmit = () => {
    if (!canPlay) return;
    onPlay(parsed);
    setScript('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
  };

  const handleAiGenerate = async () => {
    if (!aiTopic.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/dify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: aiTopic, conversationId: conversationIdRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'AIエラー');
      conversationIdRef.current = data.conversationId ?? '';
      setAiTopic('');
      const lines = parseScript(data.script, emotion);
      if (lines.length > 0) {
        onPlay(lines);
      } else {
        setScript(data.script);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleAiGenerate();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* AI生成セクション */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-violet-400 rounded-full shadow-[0_0_8px_#a78bfa]" />
        <span className="text-xs font-bold tracking-widest text-violet-500 uppercase">AI に質問</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">Dify AI</span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={aiTopic}
          onChange={(e) => setAiTopic(e.target.value)}
          onKeyDown={handleAiKeyDown}
          placeholder="質問を入力 (例: テストの作り方は?)"
          className={cn(
            'flex-1 rounded-xl px-3 py-2 text-sm',
            'bg-[var(--zunda-surface)] text-foreground placeholder:text-muted-foreground/40',
            'border border-[var(--zunda-panel-border)]',
            'focus:outline-none focus:border-violet-400',
            'transition-all duration-200',
          )}
        />
        <button
          type="button"
          onClick={handleAiGenerate}
          disabled={!aiTopic.trim() || aiLoading}
          className={cn(
            'px-3 py-2 rounded-xl text-sm font-bold transition-all duration-200',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            aiTopic.trim() && !aiLoading
              ? 'bg-violet-500 text-white hover:brightness-110 hover:shadow-lg hover:shadow-violet-300'
              : 'bg-[var(--zunda-surface)] text-muted-foreground border border-[var(--zunda-panel-border)]',
          )}
        >
          {aiLoading ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin block" />
          ) : '✨ 生成'}
        </button>
      </div>
      {aiError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-500 text-sm font-bold">!</span>
          <p className="text-red-600 text-xs">{aiError}</p>
        </div>
      )}

      <div className="h-px bg-[var(--zunda-panel-border)]" />

      {/* 感情 (デフォルト) */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-[var(--zunda-green)] rounded-full shadow-[0_0_8px_var(--zunda-green)]" />
        <span className="text-xs font-bold tracking-widest text-[var(--zunda-green)] uppercase">感情を選ぶ</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">行末に(1)〜(6)で個別指定も可</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {EMOTIONS.map((em, i) => {
          const isSelected = emotion === em;
          return (
            <button
              key={em}
              type="button"
              onClick={() => setEmotion(em)}
              className={cn(
                'relative flex flex-col items-center gap-0.5 py-2 px-2 rounded-xl border transition-all duration-200 text-xs font-bold',
                isSelected
                  ? [EMOTION_COLORS[em], EMOTION_BORDER[em], `shadow-lg ${EMOTION_GLOW[em]}`, 'text-white scale-[1.04]']
                  : ['bg-[var(--zunda-surface)] border-[var(--zunda-panel-border)]', EMOTION_TEXT[em], 'hover:bg-[var(--zunda-surface-hover)] hover:scale-[1.02]']
              )}
            >
              {isSelected && <span className="absolute inset-0 rounded-xl opacity-20 bg-white pointer-events-none" />}
              <span className="text-base leading-none font-black">{EMOTION_ICON_SYMBOL[em]}</span>
              <span className="leading-none tracking-wide">{EMOTION_LABELS[em]}</span>
              <span className={cn(
                'text-[9px] font-black rounded px-1',
                isSelected ? 'bg-white/30 text-white' : 'bg-current/10 opacity-60'
              )}>{i + 1}</span>
            </button>
          );
        })}
      </div>

      <div className="h-px bg-[var(--zunda-panel-border)]" />

      {/* スクリプト入力 */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-[var(--zunda-cyan)] rounded-full shadow-[0_0_8px_var(--zunda-cyan)]" />
        <span className="text-xs font-bold tracking-widest text-[var(--zunda-cyan)] uppercase">会話を入力</span>
      </div>

      <div className="flex gap-2 -mt-2">
        <span className="inline-block bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-bold">ずんだ:</span>
        <span className="inline-block bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 text-[10px] font-bold">めたん:</span>
        <span className="text-[10px] text-muted-foreground/60 self-center">で話者を指定</span>
      </div>

      <div className="relative">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER}
          rows={7}
          className={cn(
            'w-full rounded-xl p-3 resize-none text-sm leading-relaxed font-mono',
            'bg-[var(--zunda-surface)] text-foreground placeholder:text-muted-foreground/40',
            'border border-[var(--zunda-panel-border)]',
            'focus:outline-none focus:border-[var(--zunda-green)]',
            'focus:shadow-[0_0_0_2px_var(--zunda-green-glow)]',
            'transition-all duration-200'
          )}
        />
      </div>

      {/* パース結果プレビュー */}
      {parsed.length > 0 && (
        <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
          {parsed.map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={cn(
                'shrink-0 px-1.5 py-0.5 rounded font-bold',
                line.character === 'zundamon' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
              )}>
                {CHARACTER_CONFIG[line.character].label}
              </span>
              <span className={cn('shrink-0 text-[10px]', EMOTION_TEXT[line.emotion])}>
                {EMOTION_ICON_SYMBOL[line.emotion]}
              </span>
              <span className="text-foreground/80 leading-relaxed line-clamp-1">{line.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* エラー */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-500 text-sm mt-0.5 font-bold select-none">!</span>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* 再生ボタン */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canPlay}
        className={cn(
          'relative w-full py-3 rounded-xl font-black text-sm tracking-widest uppercase',
          'flex items-center justify-center gap-2 transition-all duration-200',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          canPlay
            ? ['bg-[var(--zunda-green)] text-[var(--primary-foreground)]',
               'hover:brightness-110 hover:shadow-lg hover:shadow-[var(--zunda-green-glow)]',
               'active:scale-[0.98]']
            : 'bg-[var(--zunda-surface)] text-muted-foreground border border-[var(--zunda-panel-border)]'
        )}
      >
        {isLoading ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>再生中...</span>
          </>
        ) : (
          <>
            <span>▶ 掛け合い再生</span>
            {parsed.length > 0 && (
              <span className="text-[10px] opacity-70 font-normal normal-case tracking-normal border border-current/30 rounded px-1 py-0.5">
                {parsed.length}行
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}
