'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Character, Emotion, HistoryItem, SpeakResponse } from '@/lib/types';
import { synthesize, checkVoicevox } from '@/lib/voicevox';
import { useLipSyncVolume } from '@/lib/lipsync';
import DialoguePanel, { DialogueLine } from '@/components/DialoguePanel';
import SpeakPanel from '@/components/SpeakPanel';
import HistoryList from '@/components/HistoryList';
import { VRMViewerHandle } from '@/components/VRMViewer';
import { CHARACTER_CONFIG, EMOTION_EFFECTS } from '@/lib/emotion-map';
import { cn } from '@/lib/utils';

const VRMViewer = dynamic(() => import('@/components/VRMViewer'), { ssr: false });

const MAX_HISTORY = 40;

// 向き合う角度: ずんだ(左)は少し右向き、めたん(右)は少し左向き
const ZUNDAMON_ROT = Math.PI + 0.32;
const METAN_ROT    = Math.PI - 0.32;

type Mode = 'duo' | 'solo';

function buildViewerCSS(emotion: Emotion): string {
  const fx = EMOTION_EFFECTS[emotion];

  const rainCSS = emotion === 'sad'
    ? Array.from({ length: 12 }, (_, i) => `
        .rain-streak:nth-child(${i + 1}) {
          left: ${8 + i * 7.5}%;
          height: ${30 + (i % 3) * 15}%;
          animation-duration: ${1.4 + (i % 4) * 0.3}s;
          animation-delay: ${i * 0.18}s;
        }`).join('')
    : '';

  const sparkleCSS = emotion === 'happy'
    ? Array.from({ length: 10 }, (_, i) => `
        .sparkle-dot:nth-child(${i + 1}) {
          width: ${4 + (i % 3) * 3}px;
          height: ${4 + (i % 3) * 3}px;
          left: ${10 + i * 8}%;
          animation-duration: ${1.8 + (i % 4) * 0.4}s;
          animation-delay: ${i * 0.22}s;
        }`).join('')
    : '';

  const burstCSS = emotion === 'surprised'
    ? [0, 1, 2].map((i) => `
        .burst-ring:nth-child(${i + 1}) {
          width: ${180 + i * 80}px;
          height: ${180 + i * 80}px;
          animation-delay: ${i * 0.4}s;
        }`).join('')
    : '';

  return `
    .viewer-container {
      --fx-bg: ${fx.bg};
      --fx-dot-color: ${fx.dotColor};
      --fx-vignette: ${fx.vignette};
      --fx-overlay-bg: ${fx.overlayBg || 'none'};
      --fx-aura: ${fx.aura};
    }
    ${rainCSS}${sparkleCSS}${burstCSS}
  `;
}

export default function Home() {
  const zundamonRef = useRef<VRMViewerHandle>(null);
  const metanRef = useRef<VRMViewerHandle>(null);
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const playingRef = useRef(false);
  const speakingCharRef = useRef<Character>('zundamon');
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const [mode, setMode] = useState<Mode>('duo');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voicevoxOk, setVoicevoxOk] = useState<boolean | null>(null);

  const volume = useLipSyncVolume(audioEl);

  useEffect(() => {
    const ref = speakingCharRef.current === 'zundamon' ? zundamonRef : metanRef;
    ref.current?.setMouthOpen(volume);
  }, [volume]);

  useEffect(() => {
    checkVoicevox().then(setVoicevoxOk);
  }, []);

  const getRef = useCallback((char: Character) => {
    return char === 'zundamon' ? zundamonRef : metanRef;
  }, []);

  const playItem = useCallback(async (item: HistoryItem) => {
    try {
      speakingCharRef.current = item.character;
      setEmotion(item.emotion);
      const ref = getRef(item.character);
      ref.current?.setBlendShapes(item.blendShapes);
      const { audioBlob } = await synthesize(item.spokenText, item.voicevoxStyleId);
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      setAudioEl(audio);
      await new Promise<void>((resolve) => {
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(resolve);
      });
      ref.current?.setBlendShapes({ neutral: 1.0 });
      setAudioEl(null);
    } catch (err) {
      console.error('[playItem]', err);
      setError('VOICEVOXエンジンを起動してください (localhost:50021)');
    }
  }, [getRef]);

  const runQueue = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length > 0) {
      const task = queueRef.current.shift();
      if (task) await task();
    }
    playingRef.current = false;
    setIsLoading(false);
  }, []);

  const enqueueItems = useCallback((items: HistoryItem[]) => {
    setHistory((prev) => [...prev.slice(-(MAX_HISTORY - items.length)), ...items]);
    for (const item of items) {
      queueRef.current.push(() => playItem(item));
    }
    runQueue();
  }, [playItem, runQueue]);

  /** 掛け合いモード: スクリプト全行を一括処理 */
  const handleDialogue = useCallback(async (lines: DialogueLine[]) => {
    setError(null);
    setIsLoading(true);
    const items: HistoryItem[] = [];
    try {
      for (const line of lines) {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: line.text, emotion: line.emotion, character: line.character }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'APIエラー');
        const data: SpeakResponse = await res.json();
        items.push({
          id: crypto.randomUUID(),
          text: line.text,
          spokenText: data.spokenText,
          emotion: line.emotion,
          character: line.character,
          blendShapes: data.blendShapes,
          voicevoxStyleId: data.voicevoxStyleId,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      console.error('[handleDialogue]', err);
      setError(err instanceof Error ? err.message : '不明なエラー');
      setIsLoading(false);
      return;
    }
    enqueueItems(items);
  }, [enqueueItems]);

  /** 一人モード: ずんだもんのみ */
  const handleSolo = useCallback(async (text: string, em: Emotion) => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, emotion: em, character: 'zundamon' }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'APIエラー');
      const data: SpeakResponse = await res.json();
      enqueueItems([{
        id: crypto.randomUUID(),
        text,
        spokenText: data.spokenText,
        emotion: em,
        character: 'zundamon',
        blendShapes: data.blendShapes,
        voicevoxStyleId: data.voicevoxStyleId,
        timestamp: new Date(),
      }]);
    } catch (err) {
      console.error('[handleSolo]', err);
      setError(err instanceof Error ? err.message : '不明なエラー');
      setIsLoading(false);
    }
  }, [enqueueItems]);

  const handleReplay = useCallback((item: HistoryItem) => {
    setIsLoading(true);
    setError(null);
    queueRef.current.push(() => playItem(item));
    runQueue();
  }, [playItem, runQueue]);

  const fx = EMOTION_EFFECTS[emotion];

  return (
    <main className="flex h-screen w-full overflow-hidden bg-background">
      <style>{buildViewerCSS(emotion)}</style>

      {/* ── LEFT: VRM ビューア ───────────────────────────────────────── */}
      <div className="viewer-container relative flex-1 min-w-0 overflow-hidden viewer-bg flex">

        {/* 背景層 */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 viewer-dot-grid" />
          <div className="absolute inset-0 viewer-vignette" />
          {fx.overlayBg && <div className="absolute inset-0 viewer-overlay" />}
          <div className={cn('viewer-ring-outer absolute rounded-full border transition-colors duration-700 animate-[spin_22s_linear_infinite]', fx.ring1)} />
          <div className={cn('viewer-ring-inner absolute rounded-full border transition-colors duration-700 animate-[spin_15s_linear_infinite_reverse]', fx.ring2)} />
          <div className="viewer-aura absolute rounded-full blur-3xl" />
        </div>

        {mode === 'solo' ? (
          /* ── ずんだもん一人モード ── */
          <div className="relative flex-1 z-10">
            <VRMViewer
              ref={zundamonRef}
              className="w-full h-full"
              modelPath="/models/zundamon_solo.vrm"
              initialRotationY={Math.PI}
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
              <span className="px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm border bg-green-500/20 border-green-400/50 text-green-700 whitespace-nowrap">
                {CHARACTER_CONFIG.zundamon.label}
              </span>
            </div>
          </div>
        ) : (
          /* ── 掛け合いモード ── */
          <>
            {/* ずんだもん (左・少し右向き) */}
            <div className="relative flex-1 z-10">
              <VRMViewer
                ref={zundamonRef}
                className="w-full h-full"
                modelPath={CHARACTER_CONFIG.zundamon.modelPath}
                initialRotationY={ZUNDAMON_ROT}
              />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <span className="px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm border bg-green-500/20 border-green-400/50 text-green-700 whitespace-nowrap">
                  {CHARACTER_CONFIG.zundamon.label}
                </span>
              </div>
            </div>

            {/* 中央分割線 */}
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20 z-20 pointer-events-none" />

            {/* 四国めたん (右・少し左向き) */}
            <div className="relative flex-1 z-10">
              <VRMViewer
                ref={metanRef}
                className="w-full h-full"
                modelPath={CHARACTER_CONFIG.metan.modelPath}
                initialRotationY={METAN_ROT}
              />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <span className="px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm border bg-purple-500/20 border-purple-400/50 text-purple-700 whitespace-nowrap">
                  {CHARACTER_CONFIG.metan.label}
                </span>
              </div>
            </div>
          </>
        )}

        {/* パーティクルエフェクト層 */}
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
          {emotion === 'sad' && Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="rain-streak absolute top-0 w-px rounded-full opacity-40" />
          ))}
          {emotion === 'happy' && Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="sparkle-dot absolute rounded-full bottom-[10%]" />
          ))}
          {emotion === 'surprised' && (
            <div className="absolute inset-0 flex items-center justify-center">
              {[0, 1, 2].map((i) => (
                <div key={i} className="burst-ring absolute rounded-full border border-violet-400/40" />
              ))}
            </div>
          )}
          {emotion === 'angry' && <div className="heat-flicker absolute inset-0" />}
        </div>

        {voicevoxOk === false && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30
                          bg-red-50/90 border border-red-200 text-red-600 text-sm
                          px-4 py-2 rounded-full backdrop-blur-sm whitespace-nowrap shadow-sm">
            VOICEVOXエンジンを起動してください (localhost:50021)
          </div>
        )}
      </div>

      {/* ── RIGHT: コントロールパネル ─────────────────────────────── */}
      <aside className={cn(
        'flex flex-col w-96 shrink-0 h-full',
        'bg-white border-l border-[var(--zunda-panel-border)]',
        'relative shadow-[-4px_0_24px_rgba(0,0,0,0.05)]'
      )}>
        <div className="h-0.5 w-full bg-gradient-to-r from-[var(--zunda-green)] via-[var(--zunda-cyan)] to-transparent" />

        {/* パネルヘッダー + モード切替 */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--zunda-panel-border)]">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500/70" />
              <span className="w-2 h-2 rounded-full bg-amber-500/70" />
              <span className="w-2 h-2 rounded-full bg-[var(--zunda-green)]/70" />
            </div>
            <span className="text-xs font-bold text-muted-foreground tracking-widest uppercase ml-1">
              掛け合いプラットフォーム
            </span>
          </div>

          {/* モードタブ */}
          <div className="flex rounded-xl overflow-hidden border border-[var(--zunda-panel-border)]">
            <button
              onClick={() => setMode('duo')}
              className={cn(
                'flex-1 py-2 text-xs font-bold transition-all duration-200',
                mode === 'duo'
                  ? 'bg-[var(--zunda-green)] text-white'
                  : 'bg-white text-muted-foreground hover:bg-[var(--zunda-surface)]'
              )}
            >
              🎭 掛け合い
            </button>
            <button
              onClick={() => setMode('solo')}
              className={cn(
                'flex-1 py-2 text-xs font-bold transition-all duration-200 border-l border-[var(--zunda-panel-border)]',
                mode === 'solo'
                  ? 'bg-green-500 text-white'
                  : 'bg-white text-muted-foreground hover:bg-[var(--zunda-surface)]'
              )}
            >
              🌿 ずんだ一人
            </button>
          </div>
        </div>

        {/* 入力エリア */}
        <div className="px-5 py-5 border-b border-[var(--zunda-panel-border)] overflow-y-auto flex-shrink-0">
          {mode === 'duo' ? (
            <DialoguePanel onPlay={handleDialogue} isLoading={isLoading} error={error} />
          ) : (
            <SpeakPanel onSpeak={handleSolo} isLoading={isLoading} error={error} />
          )}
        </div>

        {/* 発話履歴 */}
        <div className="flex flex-col flex-1 min-h-0 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-[var(--zunda-cyan)] rounded-full shadow-[0_0_8px_var(--zunda-cyan)]" />
            <span className="text-xs font-bold tracking-widest text-[var(--zunda-cyan)] uppercase">
              発話履歴
            </span>
            {history.length > 0 && (
              <span className="ml-auto text-[10px] font-bold text-muted-foreground">
                {history.length} 件
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <HistoryList items={history} onReplay={handleReplay} isLoading={isLoading} />
          </div>
        </div>

        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[var(--zunda-panel-border)] to-transparent" />
      </aside>
    </main>
  );
}
