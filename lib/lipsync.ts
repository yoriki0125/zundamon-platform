import { useEffect, useRef, useState } from 'react';

export function useLipSyncVolume(audioElement: HTMLAudioElement | null): number {
  const [volume, setVolume] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioElement) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const audioCtx = audioCtxRef.current;

    if (audioCtx.state === 'suspended') audioCtx.resume();

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;

    // 毎回新しい AudioElement に対して新しい SourceNode を作成する
    const source = audioCtx.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      // 目への干渉を避けるため最大口開度を強めに抑制する。
      // 頬の持ち上がり等で目元が変形して見えるのを防ぐため、
      // 上限を低めにして小さい動きでも見えるようゲインは高めに保つ。
      const MAX_MOUTH = 0.7;
      const scaled = Math.min(Math.pow(rms * 8, 0.55), MAX_MOUTH);
      setVolume(scaled);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      source.disconnect();
      analyser.disconnect();
      setVolume(0);
    };
  }, [audioElement]);

  return volume;
}
