'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Emotion, HistoryItem, SpeakResponse } from '@/lib/types';
import { synthesize, checkVoicevox } from '@/lib/voicevox';
import { useLipSyncVolume } from '@/lib/lipsync';
import SpeakPanel from '@/components/SpeakPanel';
import HistoryList from '@/components/HistoryList';
import { VRMViewerHandle } from '@/components/VRMViewer';

// VRMViewer は SSR 無効で読み込む (Three.js は browser-only)
const VRMViewer = dynamic(() => import('@/components/VRMViewer'), { ssr: false });

const MAX_HISTORY = 20;

export default function Home() {
  const vrmRef = useRef<VRMViewerHandle>(null);
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const playingRef = useRef(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voicevoxOk, setVoicevoxOk] = useState<boolean | null>(null);

  const volume = useLipSyncVolume(audioEl);

  // 口パクをVRMに反映
  useEffect(() => {
    vrmRef.current?.setMouthOpen(volume);
  }, [volume]);

  // VOICEVOX 接続確認
  useEffect(() => {
    checkVoicevox().then(setVoicevoxOk);
  }, []);

  const playItem = useCallback(
    async (item: HistoryItem) => {
      try {
        // VRM表情適用
        vrmRef.current?.setBlendShapes(item.blendShapes);

        // 音声合成
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
    },
    []
  );

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

  const handleSpeak = useCallback(
    async (text: string, emotion: Emotion) => {
      setError(null);
      setIsLoading(true);

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
          body: JSON.stringify({ text, emotion }),
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
          emotion,
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
    },
    [playItem, runQueue]
  );

  const handleReplay = useCallback(
    (item: HistoryItem) => {
      setIsLoading(true);
      setError(null);
      queueRef.current.push(() => playItem(item));
      runQueue();
    },
    [playItem, runQueue]
  );

  return (
    <main className="flex h-screen bg-[#0f0f1a] text-white overflow-hidden">
      {/* 3D ビューア */}
      <div className="flex-1 relative">
        <VRMViewer ref={vrmRef} className="w-full h-full" />
        {voicevoxOk === false && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-900/80 border border-red-700
                          text-red-200 text-sm px-4 py-2 rounded-full backdrop-blur-sm whitespace-nowrap">
            VOICEVOXエンジンを起動してください (localhost:50021)
          </div>
        )}
      </div>

      {/* 右サイドパネル */}
      <aside className="w-80 flex flex-col gap-4 p-4 bg-gray-950 border-l border-gray-800 overflow-hidden">
        <h1 className="text-lg font-bold text-green-400 tracking-wide">
          ずんだもん喋らせ台
        </h1>
        <SpeakPanel onSpeak={handleSpeak} isLoading={isLoading} error={error} />
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <h2 className="text-sm font-semibold text-gray-400 flex-shrink-0">
            発話履歴 ({history.length}/{MAX_HISTORY})
          </h2>
          <div className="flex-1 min-h-0">
            <HistoryList items={history} onReplay={handleReplay} isLoading={isLoading} />
          </div>
        </div>
      </aside>
    </main>
  );
}
