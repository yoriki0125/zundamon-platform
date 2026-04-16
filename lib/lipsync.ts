import { useEffect, useRef, useState } from 'react';

export function useLipSyncVolume(audioElement: HTMLAudioElement | null): number {
  const [volume, setVolume] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!audioElement) return;

    // AudioContext を作成（既存があれば再利用）
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const audioCtx = audioCtxRef.current;

    // AnalyserNode を作成
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    // MediaElementSourceNode を作成（同じ要素には1つだけ）
    if (!sourceRef.current) {
      const source = audioCtx.createMediaElementSource(audioElement);
      sourceRef.current = source;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateVolume = () => {
      analyser.getByteTimeDomainData(dataArray);

      // RMS計算
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      // 0..1 に正規化（RMSは通常0~0.5程度）
      const normalized = Math.min(rms * 3, 1);
      setVolume(normalized);

      rafRef.current = requestAnimationFrame(updateVolume);
    };

    rafRef.current = requestAnimationFrame(updateVolume);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setVolume(0);
    };
  }, [audioElement]);

  return volume;
}
