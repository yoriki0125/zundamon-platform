'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Emotion, HistoryItem, SpeakResponse } from '@/lib/types';
import { synthesize, checkVoicevox } from '@/lib/voicevox';
import { useLipSyncVolume } from '@/lib/lipsync';
import SpeakPanel from '@/components/SpeakPanel';
import HistoryList from '@/components/HistoryList';
import { VRMViewerHandle } from '@/components/VRMViewer';
import { EMOTION_EFFECTS } from '@/lib/emotion-map';
import { cn } from '@/lib/utils';

// VRMViewer は SSR 無効で読み込む (Three.js は browser-only)
const VRMViewer = dynamic(() => import('@/components/VRMViewer'), { ssr: false });

const MAX_HISTORY = 20;

/** 動的な感情カラーと パーティクルアニメーションを <style> タグで生成 */
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
  const vrmRef = useRef<VRMViewerHandle>(null);
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const playingRef = useRef(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voicevoxOk, setVoicevoxOk] = useState<boolean | null>(null);

  const volume = useLipSyncVolume(audioEl);

  useEffect(() => {
    vrmRef.current?.setMouthOpen(volume);
  }, [volume]);

  useEffect(() => {
    checkVoicevox().then(setVoicevoxOk);
  }, []);

  const playItem = useCallback(async (item: HistoryItem) => {
    try {
      vrmRef.current?.setBlendShapes(item.blendShapes);
      const { audioBlob } = await synthesize(item.spokenText, item.voicevoxStyleId);
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      setAudioEl(audio);
      await new Promise<void>((resolve) => {
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(resolve);
      });
      vrmRef.current?.setBlendShapes({ neutral: 1.0 });
      setAudioEl(null);
    } catch (err) {
      console.error('[playItem]', err);
      setError('VOICEVOXエンジンを起動してください (localhost:50021)');
    }
  }, []);

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

  const handleSpeak = useCallback(async (text: string, em: Emotion) => {
    setError(null);
    setIsLoading(true);
    setEmotion(em);
    try {
      const ok = await checkVoicevox();
      setVoicevoxOk(ok);
      if (!ok) {
        setError('VOICEVOXエンジンを起動してください (localhost:50021)');
        setIsLoading(false);
        return;
      }
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, emotion: em }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'APIエラー');
      }
      const data: SpeakResponse = await res.json();
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        text,
        spokenText: data.spokenText,
        emotion: em,
        blendShapes: data.blendShapes,
        voicevoxStyleId: data.voicevoxStyleId,
        timestamp: new Date(),
      };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY + 1), item]);
      queueRef.current.push(() => playItem(item));
      runQueue();
    } catch (err) {
      console.error('[handleSpeak]', err);
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
      setIsLoading(false);
    }
  }, [playItem, runQueue]);

  const handleReplay = useCallback((item: HistoryItem) => {
    setEmotion(item.emotion);
    setIsLoading(true);
    setError(null);
    queueRef.current.push(() => playItem(item));
    runQueue();
  }, [playItem, runQueue]);

  const fx = EMOTION_EFFECTS[emotion];

  return (
    <main className="flex h-screen w-full overflow-hidden bg-background">
      {/* 感情別動的スタイル — style タグで一括生成 */}
      <style>{buildViewerCSS(emotion)}</style>

      {/* ── LEFT: 3D ビューア ─────────────────────────────────────── */}
      <div className="viewer-container relative flex-1 min-w-0 overflow-hidden viewer-bg">

        {/* ── 背景層 z=0: ドットグリッド・ビネット・リング・オーラ ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 viewer-dot-grid" />
          <div className="absolute inset-0 viewer-vignette" />
          {fx.overlayBg && (
            <div className="absolute inset-0 viewer-overlay" />
          )}
          <div className={cn('viewer-ring-outer absolute rounded-full border transition-colors duration-700 animate-[spin_22s_linear_infinite]', fx.ring1)} />
          <div className={cn('viewer-ring-inner absolute rounded-full border transition-colors duration-700 animate-[spin_15s_linear_infinite_reverse]', fx.ring2)} />
          <div className="viewer-aura absolute rounded-full blur-3xl" />
        </div>

        {/* ── キャラクター層 z=10: 透明キャンバス（背景は透過） ── */}
        <div className="absolute inset-0 z-10">
          <VRMViewer ref={vrmRef} className="w-full h-full" />
        </div>

        {/* ── 前景エフェクト層 z=20: パーティクル ── */}
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
          {emotion === 'angry' && (
            <div className="heat-flicker absolute inset-0" />
          )}
        </div>

        {/* ── UI 層 z=30: バナー ── */}
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
        'flex flex-col w-80 shrink-0 h-full',
        'bg-white border-l border-[var(--zunda-panel-border)]',
        'relative shadow-[-4px_0_24px_rgba(0,0,0,0.05)]'
      )}>
        {/* トップアクセントライン */}
        <div className="h-0.5 w-full bg-gradient-to-r from-[var(--zunda-green)] via-[var(--zunda-cyan)] to-transparent" />

        {/* パネルヘッダー */}
        <div className="px-5 pt-5 pb-4 border-b border-[var(--zunda-panel-border)]">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500/70" />
              <span className="w-2 h-2 rounded-full bg-amber-500/70" />
              <span className="w-2 h-2 rounded-full bg-[var(--zunda-green)]/70" />
            </div>
            <span className="text-xs font-bold text-muted-foreground tracking-widest uppercase ml-1">
              Control Panel
            </span>
          </div>
        </div>

        {/* 発話入力エリア */}
        <div className="px-5 py-5 border-b border-[var(--zunda-panel-border)]">
          <SpeakPanel onSpeak={handleSpeak} isLoading={isLoading} error={error} />
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

        {/* ボトムデコレーション */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[var(--zunda-panel-border)] to-transparent" />
      </aside>
    </main>
  );
}
