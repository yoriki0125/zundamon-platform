'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Character, Emotion, SpeakResponse } from '@/lib/types';
import { CHARACTER_CONFIG, EMOTION_LABELS, EMOTION_EFFECTS } from '@/lib/emotion-map';
import { cn } from '@/lib/utils';
import { synthesize, checkVoicevox } from '@/lib/voicevox';
import { useLipSyncVolume } from '@/lib/lipsync';
import type { VRMViewerHandle } from '@/components/VRMViewer';
import type {
  WidgetConversation,
  WidgetInitConfig,
  WidgetMessage,
} from '@/lib/widget-types';
import { parseDialogueScript } from '@/lib/dialogue-parser';
import { resolveWidgetUserId } from '@/lib/widget-user-id';

const VRMViewer = dynamic(() => import('@/components/VRMViewer'), { ssr: false });

const EMOTIONS: Emotion[] = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'shy'];
const DEFAULT_SUGGESTIONS = [
  '受講生がログインできない場合',
  '有給休暇の確認方法は？',
];

const ZUNDAMON_ROT = Math.PI + 0.32;
const METAN_ROT = Math.PI - 0.32;

type SpeakerLine = { speaker: Character; emotion: Emotion; text: string };

/** 感情別のビューア背景/オーラ CSS 変数を生成 (メインページと同じロジック) */
function buildViewerCSS(emotion: Emotion): string {
  const fx = EMOTION_EFFECTS[emotion];
  const rainCSS = emotion === 'sad'
    ? Array.from({ length: 12 }, (_, i) => `.rain-streak:nth-child(${i + 1}){left:${8 + i * 7.5}%;height:${30 + (i % 3) * 15}%;animation-duration:${1.4 + (i % 4) * 0.3}s;animation-delay:${i * 0.18}s;}`).join('')
    : '';
  const sparkleCSS = emotion === 'happy'
    ? Array.from({ length: 10 }, (_, i) => `.sparkle-dot:nth-child(${i + 1}){width:${4 + (i % 3) * 3}px;height:${4 + (i % 3) * 3}px;left:${10 + i * 8}%;animation-duration:${1.8 + (i % 4) * 0.4}s;animation-delay:${i * 0.22}s;}`).join('')
    : '';
  const burstCSS = emotion === 'surprised'
    ? [0, 1, 2].map((i) => `.burst-ring:nth-child(${i + 1}){width:${180 + i * 80}px;height:${180 + i * 80}px;animation-delay:${i * 0.4}s;}`).join('')
    : '';
  return `.viewer-container{--fx-bg:${fx.bg};--fx-dot-color:${fx.dotColor};--fx-vignette:${fx.vignette};--fx-overlay-bg:${fx.overlayBg || 'none'};--fx-aura:${fx.aura};}${rainCSS}${sparkleCSS}${burstCSS}`;
}

/** テーマ分類（aiEndpoint 未設定時のフォールバック応答用） */
const SAMPLE_RESPONSES: Record<string, SpeakerLine[]> = {
  login: [
    { speaker: 'zundamon', emotion: 'surprised', text: 'ログインできないのだ！？それは大変なのだ！まずパスワードリセットを試してほしいのだ！' },
    { speaker: 'metan',    emotion: 'neutral',   text: '落ち着きなさいよ。管理画面で受講生を検索して、「パスワード変更」から仮パスワードを発行するの。' },
  ],
  kyuuka: [
    { speaker: 'metan',    emotion: 'neutral',   text: '有給休暇の確認ね。kintoneの休暇申請メニューから残日数が見られるわよ。' },
    { speaker: 'zundamon', emotion: 'happy',     text: 'ぼくも有給でずんだ餅食べたいのだ！申請はそのままそこから出せるのだ！' },
  ],
  default: [
    { speaker: 'zundamon', emotion: 'happy',     text: 'なんでも聞いてほしいのだ！ぼくたちに任せるのだ！' },
    { speaker: 'metan',    emotion: 'shy',       text: 'もう少し具体的に教えてもらえると、もっと的確に答えられるわよ。' },
  ],
};

function classifyTheme(text: string): keyof typeof SAMPLE_RESPONSES {
  const t = text.toLowerCase();
  if (t.includes('ログイン') || t.includes('パスワード') || t.includes('assist')) return 'login';
  if (t.includes('有給') || t.includes('休暇') || t.includes('休み')) return 'kyuuka';
  return 'default';
}

function makeId() {
  return `zw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveParentOrigin(searchParams: URLSearchParams): string {
  const explicit = searchParams.get('parentOrigin');
  if (explicit) return explicit;
  if (typeof document !== 'undefined' && document.referrer) {
    try { return new URL(document.referrer).origin; } catch { return '*'; }
  }
  return '*';
}

function isEmotion(v: unknown): v is Emotion {
  return typeof v === 'string' && EMOTIONS.includes(v as Emotion);
}
function isCharacter(v: unknown): v is Character {
  return v === 'zundamon' || v === 'metan';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ZundamonWidget() {
  const searchParams = useSearchParams();

  // ── VRM / 音声再生関連 ──────────────────────────────────────────
  const zundaRef = useRef<VRMViewerHandle | null>(null);
  const metanRef = useRef<VRMViewerHandle | null>(null);
  const speakingCharRef = useRef<Character>('zundamon');
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const playingRef = useRef(false);
  const audioUrlRef = useRef<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const mouthOpen = useLipSyncVolume(audioEl);

  // ── Widget config / postMessage bridge ─────────────────────────
  const parentOriginRef = useRef<string>('*');
  const configRef = useRef<WidgetInitConfig>({});
  const messagesRef = useRef<WidgetMessage[]>([]);
  const contextRef = useRef<Record<string, unknown>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [config, setConfig] = useState<WidgetInitConfig>(() => ({
    humanId: resolveWidgetUserId(searchParams.get('humanid'), undefined),
    userId: resolveWidgetUserId(searchParams.get('humanid'), searchParams.get('userId')),
    mode: (searchParams.get('mode') as WidgetInitConfig['mode']) ?? 'embedded',
    title: searchParams.get('title') ?? 'AIコンシェルジュ',
    subtitle: searchParams.get('subtitle') ?? 'ずんだもん × 四国めたん',
    characterName: searchParams.get('characterName') ?? 'ずんだもん',
    defaultEmotion: isEmotion(searchParams.get('emotion')) ? (searchParams.get('emotion') as Emotion) : 'neutral',
    showDebugPanel: searchParams.get('debug') === '1',
    aiEndpoint: searchParams.get('aiEndpoint') ?? '/api/widget-chat',
  }));

  // ── 会話履歴（複数セッション） ──────────────────────────────────
  const [conversations, setConversations] = useState<WidgetConversation[]>(() => [
    { id: makeId(), title: '本日の相談', updatedAt: new Date().toISOString(), messages: [] },
  ]);
  const [activeConvId, setActiveConvId] = useState<string>(() => '');
  // 初期化
  useEffect(() => {
    setActiveConvId((prev) => prev || conversations[0]?.id || '');
  }, [conversations]);

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const messages = activeConv?.messages ?? [];

  // ── UI 状態 ──────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voicevoxOk, setVoicevoxOk] = useState<boolean | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [showControlPanel, setShowControlPanel] = useState<boolean>(!!config.showDebugPanel);
  const [bubble, setBubble] = useState<{ speaker: Character; text: string } | null>(null);
  const [viewerEmotion, setViewerEmotion] = useState<Emotion>('neutral');
  const [debugScript, setDebugScript] = useState<string>(
    'ずんだ: こんにちは、今日はずんだ日和なのだ！(2)\nめたん: あらあら、また張り切っているのね。(6)\nぼくは空を飛べるのだ！_z5\nそんなわけないでしょ_m3'
  );

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const primaryColor = config.theme?.primaryColor ?? '#14b8a6';

  // ── postMessage helpers ─────────────────────────────────────────
  const emit = useCallback((type: string, payload?: unknown) => {
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage(
      { namespace: 'zundamonWidget', type, payload },
      parentOriginRef.current || '*'
    );
  }, []);

  // ウィジェット最外 div への ref — html/body の h-full による誤測定を避けるため
  // document.body ではなくウィジェット自身の offsetHeight を基準にする
  const widgetRootRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);
  const resizeRafRef = useRef<number>(0);
  const postResize = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (resizeRafRef.current) return;
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = 0;
      const height = widgetRootRef.current?.offsetHeight ?? 0;
      if (height < 1) return;
      if (Math.abs(height - lastHeightRef.current) < 2) return;
      lastHeightRef.current = height;
      emit('zundamon:resize', { height });
    });
  }, [emit]);

  // ── Effects ─────────────────────────────────────────────────────
  useEffect(() => { parentOriginRef.current = resolveParentOrigin(searchParams); }, [searchParams]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { contextRef.current = config.context ?? {}; }, [config.context]);

  useEffect(() => {
    // 口パクは現在話しているキャラのみ
    const ref = speakingCharRef.current === 'zundamon' ? zundaRef : metanRef;
    ref.current?.setMouthOpen(mouthOpen);
  }, [mouthOpen]);

  useEffect(() => {
    let mounted = true;
    checkVoicevox().then((ok) => { if (mounted) setVoicevoxOk(ok); }).catch(() => { if (mounted) setVoicevoxOk(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = widgetRootRef.current;
    if (!target) return;
    const observer = new ResizeObserver(() => postResize());
    observer.observe(target);
    resizeObserverRef.current = observer;
    postResize();
    return () => { observer.disconnect(); resizeObserverRef.current = null; };
  }, [postResize]);

  // panelOpen 切替時に即座にサイズ通知 (ResizeObserver の遅延を補完)
  useEffect(() => {
    // rAF を 2 フレーム待つことで DOM 反映後に測定できる
    const id = requestAnimationFrame(() => requestAnimationFrame(() => postResize()));
    return () => cancelAnimationFrame(id);
  }, [panelOpen, postResize]);

  useEffect(() => {
    emit('zundamon:ready', { version: '0.2.0', mode: config.mode ?? 'embedded' });
  }, [config.mode, emit]);

  // チャット自動スクロール
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages.length]);

  // 隠しコマンド: Ctrl+Shift+D でコントロールパネルトグル
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setShowControlPanel((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 会話履歴のヘルパ ─────────────────────────────────────────
  const appendMessageToActive = useCallback((msg: WidgetMessage) => {
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeConvId) return c;
      const updated: WidgetConversation = {
        ...c,
        messages: [...c.messages, msg],
        updatedAt: msg.timestamp,
        // 最初のユーザーメッセージをタイトルにする
        title: c.messages.length === 0 && msg.role === 'user'
          ? msg.text.slice(0, 14) + (msg.text.length > 14 ? '…' : '')
          : c.title,
      };
      return updated;
    }));
  }, [activeConvId]);

  const startNewConversation = useCallback(() => {
    const id = makeId();
    setConversations((prev) => [
      { id, title: '新しい会話', updatedAt: new Date().toISOString(), messages: [] },
      ...prev,
    ]);
    setActiveConvId(id);
    setBubble(null);
  }, []);

  // ── Speak (VRM + VOICEVOX) ──────────────────────────────────────
  const getRef = useCallback((ch: Character) => (ch === 'zundamon' ? zundaRef : metanRef), []);

  const playLine = useCallback(async (line: SpeakerLine) => {
    // 相手キャラは頷き状態
    const otherRef = line.speaker === 'zundamon' ? metanRef : zundaRef;
    otherRef.current?.setListening(true);
    try {
      speakingCharRef.current = line.speaker;
      // /api/speak でブレンドシェイプ・VOICEVOXスタイル・話すテキストを取得
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: line.text, emotion: line.emotion, character: line.speaker }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'APIエラー');
      const payload: SpeakResponse = await res.json();

      const ref = getRef(line.speaker);
      ref.current?.setBlendShapes(payload.blendShapes);

      setBubble({ speaker: line.speaker, text: line.text });

      try {
        const { audioBlob } = await synthesize(payload.spokenText, payload.voicevoxStyleId);
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        const url = URL.createObjectURL(audioBlob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        setAudioEl(audio);
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(resolve);
        });
        setAudioEl(null);
      } catch {
        // VOICEVOX なしでも UI は継続
      }

      ref.current?.setBlendShapes({ neutral: 1.0 });

      // チャット履歴にも流す
      const msg: WidgetMessage = {
        id: makeId(),
        role: 'assistant',
        text: line.text,
        emotion: line.emotion,
        character: line.speaker,
        spokenText: payload.spokenText,
        timestamp: new Date().toISOString(),
      };
      appendMessageToActive(msg);
      emit('zundamon:answerShown', msg);
    } finally {
      otherRef.current?.setListening(false);
    }
  }, [appendMessageToActive, emit, getRef]);

  const runQueue = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length > 0) {
      const task = queueRef.current.shift();
      if (task) {
        try { await task(); } catch (e) { console.error('[widget] playLine', e); }
      }
    }
    playingRef.current = false;
    setIsLoading(false);
  }, []);

  /**
   * 複数行を最速で連続再生する。
   *   1. /api/speak と VOICEVOX synthesize を全行ぶん **並列プリフェッチ**
   *   2. チャット履歴への追加は **1 回の setState にまとめる** (再レンダ/リサイズ観測の連鎖を排除)
   *   3. 再生フェーズでは事前ロード済みの Blob を順番に鳴らすだけ
   * これで 1 行あたりの直列ネットワーク待ちが消え、総所要時間 ≒ max(prefetch) + Σ(audio 長)
   */
  const playLinesBatch = useCallback(async (lines: SpeakerLine[]) => {
    if (playingRef.current || lines.length === 0) return;
    playingRef.current = true;
    setIsLoading(true);
    setError(null);

    type Prepared = {
      line: SpeakerLine;
      blendShapes: Record<string, number> | null;
      spokenText: string;
      audioBlob: Blob | null;
    };

    // 1. 並列プリフェッチ
    const prepared: Prepared[] = await Promise.all(
      lines.map(async (line): Promise<Prepared> => {
        try {
          const res = await fetch('/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: line.text, emotion: line.emotion, character: line.speaker }),
          });
          if (!res.ok) throw new Error('speak API error');
          const payload: SpeakResponse = await res.json();
          let audioBlob: Blob | null = null;
          try {
            const r = await synthesize(payload.spokenText, payload.voicevoxStyleId);
            audioBlob = r.audioBlob;
          } catch (e) {
            console.warn('[widget] VOICEVOX synthesis failed:', e);
          }
          return { line, blendShapes: payload.blendShapes, spokenText: payload.spokenText, audioBlob };
        } catch (e) {
          console.error('[widget] prefetch failed', e);
          return { line, blendShapes: null, spokenText: line.text, audioBlob: null };
        }
      })
    );

    // 2. チャット履歴を 1 回のセットで全部追加 (N回の再レンダ→ResizeObserver連鎖 を避ける)
    const baseTs = Date.now();
    const msgs: WidgetMessage[] = prepared.map((p, i) => ({
      id: `zw-${baseTs}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      text: p.line.text,
      emotion: p.line.emotion,
      character: p.line.speaker,
      spokenText: p.spokenText,
      timestamp: new Date(baseTs + i).toISOString(),
    }));
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeConvId) return c;
      const firstText = msgs[0]?.text ?? '';
      return {
        ...c,
        messages: [...c.messages, ...msgs],
        updatedAt: msgs[msgs.length - 1].timestamp,
        title: c.messages.length === 0 && firstText
          ? firstText.slice(0, 14) + (firstText.length > 14 ? '…' : '')
          : c.title,
      };
    }));
    for (const m of msgs) emit('zundamon:answerShown', m);

    // 3. 事前生成 URL を使って順次再生（1行ずつ吹き出し＋音声）
    const urls: string[] = [];
    try {
      for (const p of prepared) {
        const speaker = p.line.speaker;
        const other = speaker === 'zundamon' ? metanRef : zundaRef;
        const ref = speaker === 'zundamon' ? zundaRef : metanRef;
        other.current?.setListening(true);
        speakingCharRef.current = speaker;
        setViewerEmotion(p.line.emotion);
        setBubble({ speaker, text: p.line.text });
        if (p.blendShapes) ref.current?.setBlendShapes(p.blendShapes);
        if (p.audioBlob) {
          const url = URL.createObjectURL(p.audioBlob);
          urls.push(url);
          const audio = new Audio(url);
          audio.preload = 'auto';
          setAudioEl(audio);
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.play().catch(() => resolve());
          });
          setAudioEl(null);
        } else {
          // 音声なし時も吹き出しを見せるため最低2秒待機
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }
        ref.current?.setBlendShapes({ neutral: 1.0 });
        other.current?.setListening(false);
      }
    } finally {
      // URL は全部終わってから破棄 (再生中の revoke を回避)
      for (const u of urls) URL.revokeObjectURL(u);
      playingRef.current = false;
      setIsLoading(false);
    }
  }, [activeConvId, emit]);

  /**
   * 1 行ぶんの prefetch + 再生タスクを返す。
   * prefetch (= /api/speak + VOICEVOX) は即開始し、再生は呼び出し側で順番に await する。
   */
  const prepareAndRunLine = useCallback((line: SpeakerLine, urlsToRevoke: string[]) => {
    const prefetchP = (async () => {
      try {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: line.text, emotion: line.emotion, character: line.speaker }),
        });
        if (!res.ok) throw new Error('speak API error');
        const payload: SpeakResponse = await res.json();
        let audioBlob: Blob | null = null;
        try {
          const r = await synthesize(payload.spokenText, payload.voicevoxStyleId);
          audioBlob = r.audioBlob;
        } catch (e) {
          console.warn('[widget] VOICEVOX synthesis failed:', e);
        }
        return { blendShapes: payload.blendShapes, spokenText: payload.spokenText, audioBlob };
      } catch (e) {
        console.error('[widget] prefetch failed', e);
        return { blendShapes: null as Record<string, number> | null, spokenText: line.text, audioBlob: null as Blob | null };
      }
    })();

    const playP = async () => {
      const p = await prefetchP;
      const speaker = line.speaker;
      const other = speaker === 'zundamon' ? metanRef : zundaRef;
      const ref = speaker === 'zundamon' ? zundaRef : metanRef;
      other.current?.setListening(true);
      speakingCharRef.current = speaker;
      setViewerEmotion(line.emotion);
      setBubble({ speaker, text: line.text });
      if (p.blendShapes) ref.current?.setBlendShapes(p.blendShapes);
      if (p.audioBlob) {
        const url = URL.createObjectURL(p.audioBlob);
        urlsToRevoke.push(url);
        const audio = new Audio(url);
        audio.preload = 'auto';
        setAudioEl(audio);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        setAudioEl(null);
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      }
      ref.current?.setBlendShapes({ neutral: 1.0 });
      other.current?.setListening(false);
    };

    return playP;
  }, []);

  /** 到着したラインをチャット履歴へ即時追加する (再生完了を待たない)。 */
  const appendAssistantLine = useCallback((line: SpeakerLine) => {
    const msg: WidgetMessage = {
      id: makeId(),
      role: 'assistant',
      text: line.text,
      emotion: line.emotion,
      character: line.speaker,
      spokenText: line.text,
      timestamp: new Date().toISOString(),
    };
    appendMessageToActive(msg);
    emit('zundamon:answerShown', msg);
  }, [appendMessageToActive, emit]);

  /**
   * メインの会話実行。
   * - aiEndpoint 未設定 → SAMPLE_RESPONSES でフォールバック (従来の playLinesBatch)
   * - aiEndpoint 応答が text/event-stream → 逐次ストリーミング再生
   *   ・1 行到着ごとに即 prefetch 開始 (行どうしは並列)
   *   ・再生は promise chain で順序保持 (前行の再生完了 + 現行の prefetch 完了を待つ)
   * - それ以外 (JSON 応答) → 配列受領後 playLinesBatch で従来フロー
   */
  const runConversation = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isLoading || playingRef.current) return;
    setError(null);

    const userMessage: WidgetMessage = {
      id: makeId(),
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    };
    appendMessageToActive(userMessage);
    emit('zundamon:messageSent', userMessage);

    const cfg = configRef.current;

    // ── フォールバック: aiEndpoint 未設定時 ────────────────────────
    if (!cfg.aiEndpoint) {
      try {
        const lines = SAMPLE_RESPONSES[classifyTheme(text)];
        await playLinesBatch(lines);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '不明なエラー';
        setError(msg);
        emit('zundamon:error', { message: msg });
        setIsLoading(false);
      }
      return;
    }

    playingRef.current = true;
    setIsLoading(true);
    const urlsToRevoke: string[] = [];
    let playChain: Promise<void> = Promise.resolve();
    let anyLineReceived = false;

    const schedule = (line: SpeakerLine) => {
      anyLineReceived = true;
      appendAssistantLine(line);
      const runLine = prepareAndRunLine(line, urlsToRevoke);
      playChain = playChain.then(runLine).catch((e) => {
        console.error('[widget] play chain error', e);
      });
    };

    try {
      const res = await fetch(cfg.aiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        },
        body: JSON.stringify({
          input: text,
          history: messagesRef.current,
          context: contextRef.current,
          tenantId: cfg.tenantId,
          userId: cfg.userId,
          defaultEmotion: cfg.defaultEmotion ?? 'neutral',
          character: cfg.characterName ?? 'ずんだもん',
        }),
      });
      if (!res.ok) throw new Error(`AI endpoint ${res.status}`);

      const contentType = res.headers.get('content-type') ?? '';
      const isStream = contentType.includes('text/event-stream');

      if (isStream && res.body) {
        // ── ストリーミング読み取り ─────────────────────────────────
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamError: string | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';
          for (const ev of events) {
            const dataLine = ev.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const data = JSON.parse(dataLine.slice(6));
              if (data.type === 'line' && data.line) {
                const l = data.line;
                if (isCharacter(l.speaker) && isEmotion(l.emotion) && typeof l.text === 'string' && l.text.length > 0) {
                  schedule({ speaker: l.speaker, emotion: l.emotion, text: l.text });
                }
              } else if (data.type === 'error' && typeof data.message === 'string') {
                streamError = data.message;
              }
            } catch {
              // incomplete JSON, ignore
            }
          }
        }
        if (streamError && !anyLineReceived) {
          throw new Error(streamError);
        }
      } else {
        // ── JSON フォールバック (従来の { lines: [...] } 形式) ──────
        const body = await res.json();
        if (Array.isArray(body.lines)) {
          type MaybeLine = { speaker?: unknown; emotion?: unknown; text?: unknown };
          const arr: SpeakerLine[] = (body.lines as unknown[])
            .filter((l): l is MaybeLine => !!l && typeof l === 'object')
            .map((l): SpeakerLine => ({
              speaker: isCharacter(l.speaker) ? l.speaker : 'zundamon',
              emotion: isEmotion(l.emotion) ? l.emotion : (cfg.defaultEmotion ?? 'neutral'),
              text: String(l.text ?? ''),
            }))
            .filter((l) => l.text.length > 0);
          for (const line of arr) schedule(line);
        } else {
          const replyText = body.replyText ?? body.text ?? body.message ?? text;
          schedule({
            speaker: isCharacter(body.character) ? body.character : 'zundamon',
            emotion: isEmotion(body.emotion) ? body.emotion : (cfg.defaultEmotion ?? 'neutral'),
            text: replyText,
          });
        }
      }

      // 全行の再生完了を待つ
      await playChain;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '不明なエラー';
      console.error('[widget] runConversation failed', e);
      setError(msg);
      emit('zundamon:error', { message: msg });
      // エラーで 1 行も届かなかった場合はフォールバックを鳴らす
      if (!anyLineReceived) {
        try {
          const lines = SAMPLE_RESPONSES[classifyTheme(text)];
          for (const line of lines) schedule(line);
          await playChain;
        } catch { /* noop */ }
      }
    } finally {
      for (const u of urlsToRevoke) URL.revokeObjectURL(u);
      playingRef.current = false;
      setIsLoading(false);
    }
  }, [appendAssistantLine, appendMessageToActive, emit, isLoading, playLinesBatch, prepareAndRunLine]);

  // ── postMessage 受信 ────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.namespace !== 'zundamonWidget') return;
      if (parentOriginRef.current !== '*' && event.origin !== parentOriginRef.current) return;

      switch (data.type) {
        case 'zundamon:init': {
          const raw = (data.payload ?? {}) as WidgetInitConfig;
          // undefined を含むキーは既存値を上書きしないよう除外
          const next = Object.fromEntries(
            Object.entries(raw).filter(([, v]) => v !== undefined)
          ) as WidgetInitConfig;
          const effectiveUserId = resolveWidgetUserId(next.humanId, next.userId);
          parentOriginRef.current = next.parentOrigin || event.origin || parentOriginRef.current;
          contextRef.current = next.context ?? contextRef.current;
          setConfig((prev) => ({
            ...prev,
            ...next,
            humanId: next.humanId ?? prev.humanId,
            userId: effectiveUserId ?? prev.userId,
            context: next.context ?? prev.context,
          }));
          if (typeof next.showDebugPanel === 'boolean') setShowControlPanel(next.showDebugPanel);
          postResize();
          break;
        }
        case 'zundamon:sendMessage': {
          const payload = data.payload as { text?: string };
          if (payload?.text) void runConversation(payload.text);
          break;
        }
        case 'zundamon:setContext': {
          const payload = data.payload as { context?: Record<string, unknown> };
          contextRef.current = payload?.context ?? {};
          setConfig((prev) => ({ ...prev, context: payload?.context ?? {} }));
          break;
        }
        case 'zundamon:refreshToken': {
          const payload = data.payload as { token?: string };
          if (payload?.token) setConfig((prev) => ({ ...prev, token: payload.token }));
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postResize, runConversation]);

  // unmount cleanup
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const suggestions = useMemo(
    () => (config.suggestedPrompts?.length ? config.suggestedPrompts : DEFAULT_SUGGESTIONS),
    [config.suggestedPrompts]
  );

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div ref={widgetRootRef} className="w-full flex flex-col">
      <div className="concierge-wrap flex flex-col bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)] overflow-hidden rounded-b-[20px] md:rounded-b-[24px]">

        {/* ══════════════════════════════════════════════════════════
            折りたたみ状態: スリム入力バー (~52px)
        ════════════════════════════════════════════════════════════ */}
        {!panelOpen && (
          <div className="flex items-center gap-2 px-3 py-2" style={{ minHeight: '52px' }}>
            {/* ブランドアイコン + タイトル */}
            <div
              className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer select-none"
              onClick={() => setPanelOpen(true)}
              title="展開する"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: primaryColor }}
              />
              <span className="hidden sm:block text-xs font-bold text-gray-700 whitespace-nowrap">
                {config.title ?? 'AIコンシェルジュ'}
              </span>
              <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium flex-shrink-0">β版</span>
              {showControlPanel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold flex-shrink-0">DEBUG</span>
              )}
            </div>
            {/* 入力フィールド */}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const t = input.trim();
                  if (!t) return;
                  setInput('');
                  setPanelOpen(true);
                  void runConversation(t);
                }
              }}
              placeholder="AIに相談したいことを入力してください..."
              rows={1}
              className="flex-1 rounded-full border border-gray-300 px-4 py-1.5 text-[13px] resize-none outline-none focus:border-teal-500 transition-colors leading-snug"
              style={{ minHeight: '34px', maxHeight: '34px' }}
            />
            {/* 送信ボタン */}
            <button
              type="button"
              onClick={() => {
                const t = input.trim();
                if (!t) return;
                setInput('');
                setPanelOpen(true);
                void runConversation(t);
              }}
              disabled={isLoading || !input.trim()}
              className="px-3 py-1.5 rounded-full text-white text-xs font-bold flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed shadow transition-opacity"
              style={{ backgroundColor: primaryColor }}
            >
              {isLoading ? '...' : '送信'}
            </button>
            {/* ▲ 展開ボタン */}
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="w-8 h-8 rounded-full border border-gray-200 bg-gray-50 text-gray-500 text-xs flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
              aria-label="展開する"
            >
              ▲
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            展開状態: フル表示 (固定高さ ~680px)
        ════════════════════════════════════════════════════════════ */}
        {panelOpen && (
          <div className="flex flex-col" style={{ height: '680px' }}>

            {/* ── スリムヘッダー ─────────────────────────────────── */}
            <div className="c-bar flex items-center justify-between px-3 md:px-4 border-b border-gray-100 select-none flex-shrink-0" style={{ height: '44px' }}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* モバイル: サイドバー開閉 */}
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen((v) => !v)}
                  className="md:hidden w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 flex-shrink-0"
                  aria-label="会話履歴"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                </button>
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="text-xs font-bold text-gray-700 truncate">
                  {config.subtitle ?? config.title ?? 'AIコンシェルジュ'}
                  <span className="hidden sm:inline ml-1 font-normal text-gray-400">（ずんだもん × 四国めたん）</span>
                </span>
                <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium flex-shrink-0">β版</span>
                {showControlPanel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold flex-shrink-0">DEBUG</span>
                )}
              </div>
              {/* ▼ 閉じるボタン */}
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 flex-shrink-0 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
                aria-label="閉じる"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
                <span className="hidden sm:inline">閉じる</span>
              </button>
            </div>

            {/* ── コンテンツ本体 (flex-1: ヘッダーと入力バーを除いた高さ) ── */}
            <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden relative">
            {/* ── 左: 会話履歴 (SPではドロワー) ──────────────────── */}
            {mobileSidebarOpen && (
              <div
                className="md:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}
            <div className={cn(
              'shrink-0 flex flex-col border-r border-gray-200 bg-gray-50',
              'md:w-[160px] md:relative md:translate-x-0',
              'fixed md:static inset-y-0 left-0 w-[260px] z-50 transition-transform duration-300 shadow-2xl md:shadow-none',
              mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            )}>
              <div className="px-3 py-2 text-[11px] font-bold text-gray-400 border-b border-gray-200 bg-white flex items-center justify-between">
                <span>📋 会話履歴</span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="md:hidden text-gray-400 hover:text-gray-600 text-lg leading-none"
                  aria-label="閉じる"
                >×</button>
              </div>
              <div className="px-2 py-2 border-b border-gray-200">
                <button
                  type="button"
                  onClick={startNewConversation}
                  className="w-full py-1 rounded-lg border border-dashed border-teal-500 text-teal-600 text-[11px] font-bold hover:bg-teal-50 transition-colors"
                >
                  ＋ 新しい会話
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setActiveConvId(c.id); setMobileSidebarOpen(false); }}
                    className={`w-full text-left px-3 py-2 border-b border-gray-100 text-[11px] leading-tight ${
                      c.id === activeConvId
                        ? 'bg-teal-50 text-teal-700 border-l-[3px] border-l-teal-500'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-medium truncate">{c.title}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {formatDateShort(c.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 中央: 3D VRM (ずんだ × めたん) ───────────────────── */}
            <div className="viewer-container flex-1 flex flex-col relative overflow-hidden md:border-r border-gray-200 viewer-bg min-h-[38vh] md:min-h-0">
              <style>{buildViewerCSS(viewerEmotion)}</style>

              {/* 感情エフェクト背景層 */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 viewer-dot-grid" />
                <div className="absolute inset-0 viewer-vignette" />
                {EMOTION_EFFECTS[viewerEmotion].overlayBg && (
                  <div className="absolute inset-0 viewer-overlay" />
                )}
                <div className={cn('viewer-ring-outer absolute rounded-full border transition-colors duration-700 animate-[spin_22s_linear_infinite]', EMOTION_EFFECTS[viewerEmotion].ring1)} />
                <div className={cn('viewer-ring-inner absolute rounded-full border transition-colors duration-700 animate-[spin_15s_linear_infinite_reverse]', EMOTION_EFFECTS[viewerEmotion].ring2)} />
                <div className="viewer-aura absolute rounded-full blur-3xl" />
              </div>

              {/* パーティクル層 */}
              <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
                {viewerEmotion === 'sad' && Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="rain-streak absolute top-0 w-px rounded-full opacity-40 bg-sky-300" />
                ))}
                {viewerEmotion === 'happy' && Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="sparkle-dot absolute rounded-full bottom-[10%] bg-amber-300" />
                ))}
                {viewerEmotion === 'surprised' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="burst-ring absolute rounded-full border border-violet-400/40" />
                    ))}
                  </div>
                )}
                {viewerEmotion === 'angry' && <div className="heat-flicker absolute inset-0" />}
              </div>

              {/* 吹き出し */}
              {bubble && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[85%]">
                  <div
                    className={`rounded-xl px-3 py-2 shadow-md border ${
                      bubble.speaker === 'zundamon'
                        ? 'bg-white border-teal-200'
                        : 'bg-white border-violet-200'
                    }`}
                  >
                    <div
                      className={`text-[10px] font-bold mb-0.5 ${
                        bubble.speaker === 'zundamon' ? 'text-teal-700' : 'text-violet-700'
                      }`}
                    >
                      {CHARACTER_CONFIG[bubble.speaker].label}
                    </div>
                    <div className="text-[11px] text-gray-800 leading-relaxed">{bubble.text}</div>
                  </div>
                </div>
              )}

              <div className="flex flex-1 min-h-0 relative z-10 scale-[0.82] md:scale-100 origin-center">
                {/* ずんだもん */}
                <div className="relative flex-1">
                  <VRMViewer
                    ref={zundaRef}
                    className="w-full h-full"
                    modelPath={CHARACTER_CONFIG.zundamon.modelPath}
                    initialRotationY={ZUNDAMON_ROT}
                    animationPreset="jump15"
                  />
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/90 shadow border border-teal-200 text-teal-700">
                      {CHARACTER_CONFIG.zundamon.label}
                    </span>
                  </div>
                </div>
                {/* 四国めたん */}
                <div className="relative flex-1">
                  <VRMViewer
                    ref={metanRef}
                    className="w-full h-full"
                    modelPath={CHARACTER_CONFIG.metan.modelPath}
                    initialRotationY={METAN_ROT}
                    animationPreset="spin20"
                  />
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/90 shadow border border-violet-200 text-violet-700">
                      {CHARACTER_CONFIG.metan.label}
                    </span>
                  </div>
                </div>
              </div>

              {/* クイック質問 */}
              <div className="flex flex-wrap gap-2 justify-center px-3 py-2 bg-white/60 border-t border-gray-100">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void runConversation(s)}
                    disabled={isLoading}
                    className="px-2.5 py-1 rounded-full border border-teal-500 bg-white text-teal-600 text-[10px] hover:bg-teal-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {voicevoxOk === false && (
                <div className="absolute top-3 right-3 z-20 bg-amber-50 border border-amber-200 text-amber-700 text-[11px] px-3 py-1.5 rounded-full shadow-sm">
                  VOICEVOX未接続（音声なし）
                </div>
              )}

              {/* SP: チャット開閉フローティングボタン */}
              <button
                type="button"
                onClick={() => setMobileChatOpen((v) => !v)}
                className="md:hidden absolute bottom-3 right-3 z-20 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white transition-transform active:scale-95"
                style={{ backgroundColor: primaryColor }}
                aria-label={mobileChatOpen ? 'チャットを閉じる' : 'チャットを開く'}
              >
                {mobileChatOpen ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                )}
                {messages.length > 0 && !mobileChatOpen && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                    {messages.length}
                  </span>
                )}
              </button>
            </div>

            {/* ── 右: チャット履歴 (SPでは下段、折りたたみ可能) ─── */}
            <div className={cn(
              'flex flex-col bg-[#fafcff] border-t md:border-t-0 border-gray-200',
              'md:w-[420px] md:shrink-0 md:flex',
              mobileChatOpen ? 'flex flex-1 min-h-[40vh]' : 'hidden md:flex',
            )}>
              <div className="px-3 py-2 text-[11px] font-bold text-gray-400 border-b border-gray-200 bg-white flex items-center justify-between">
                <span>💬 チャット</span>
                {isLoading && <span className="text-teal-600">返答生成中...</span>}
              </div>
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center opacity-70 text-xs">
                    <div className="text-3xl mb-2">💬</div>
                    <p>何でも質問してほしいのだ！</p>
                    <p className="mt-1 text-gray-400">二人で答えるのだ</p>
                  </div>
                ) : (
                  messages.map((m) => {
                    if (m.role === 'user') {
                      return (
                        <div key={m.id} className="flex flex-row-reverse gap-1.5 items-start">
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-sm flex-shrink-0">👤</div>
                          <div>
                            <div
                              className="max-w-[260px] px-3 py-2 text-xs leading-relaxed rounded-[14px_3px_14px_14px] text-white shadow-sm"
                              style={{ backgroundColor: primaryColor }}
                            >
                              {m.text}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5 text-right">
                              {formatTime(m.timestamp)}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    const isZunda = m.character === 'zundamon';
                    return (
                      <div key={m.id} className="flex gap-1.5 items-start">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                            isZunda ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'
                          }`}
                        >
                          {isZunda ? 'Z' : 'M'}
                        </div>
                        <div>
                          <div
                            className={`text-[10px] font-bold mb-0.5 ${
                              isZunda ? 'text-teal-700' : 'text-violet-700'
                            }`}
                          >
                            {m.character ? CHARACTER_CONFIG[m.character].label : 'AI'}
                            {showControlPanel && m.emotion && (
                              <span className="ml-2 text-gray-400 font-normal">
                                [{EMOTION_LABELS[m.emotion]}]
                              </span>
                            )}
                          </div>
                          <div
                            className={`max-w-[280px] px-3 py-2 text-xs leading-relaxed border rounded-[3px_14px_14px_14px] shadow-sm ${
                              isZunda
                                ? 'bg-[#f0f9f5] border-teal-200 text-gray-800'
                                : 'bg-[#f9f0ff] border-violet-200 text-gray-800'
                            }`}
                          >
                            {m.text}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {formatTime(m.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ── 下: チャット入力 (全カラム跨ぎ) ─────────────────────── */}
          <div
            className="flex items-end gap-2 px-3 md:px-4 pt-3 pb-4 md:py-3 border-t border-gray-100 bg-white flex-shrink-0 rounded-b-[24px] md:rounded-b-[28px]"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <select className="hidden md:block px-2 py-1.5 rounded-md border border-gray-300 bg-cyan-700 text-white text-[11px] cursor-pointer flex-shrink-0">
              <option>DX ▼</option>
              <option>教務</option>
              <option>総務</option>
            </select>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const t = input.trim();
                  if (!t) return;
                  setInput('');
                  void runConversation(t);
                }
              }}
              placeholder="質問を入力..."
              rows={1}
              className="flex-1 min-h-[40px] md:min-h-[34px] max-h-[80px] rounded-full md:rounded-md border border-gray-300 px-4 md:px-3 py-2 text-[14px] md:text-[12px] resize-none outline-none focus:border-teal-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => {
                const t = input.trim();
                if (!t) return;
                setInput('');
                void runConversation(t);
              }}
              disabled={isLoading || !input.trim()}
              className="w-10 h-10 md:w-auto md:h-auto md:px-4 md:py-2 rounded-full md:rounded-md text-white text-xs font-bold flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform shadow-md"
              style={{ backgroundColor: primaryColor }}
              aria-label="送信"
            >
              {isLoading ? (
                <svg className="animate-spin md:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg className="md:hidden" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2z"/>
                </svg>
              )}
              <span className="hidden md:inline">{isLoading ? '送信中' : '送信'}</span>
            </button>
          </div>

          {error && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-md border border-red-200 bg-red-50 text-red-700 text-xs">
              {error}
            </div>
          )}

          {/* ── デバッグ/コントロールパネル (隠しコマンド: Ctrl+Shift+D) ── */}
          {showControlPanel && (
            <div className="border-t border-dashed border-violet-300 bg-violet-50/50 px-4 py-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold text-violet-700">
                  🔧 DEBUG / コントロールパネル
                  <span className="ml-2 text-[10px] font-normal text-violet-500">
                    Ctrl+Shift+D で閉じる
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowControlPanel(false)}
                  className="text-violet-500 hover:text-violet-700 text-sm"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {EMOTIONS.map((emo) => (
                  <button
                    key={emo}
                    type="button"
                    onClick={() => {
                      void playLinesBatch([
                        { speaker: 'zundamon', emotion: emo, text: `ぼくは今${EMOTION_LABELS[emo]}の気分なのだ！` },
                      ]);
                    }}
                    className="py-2 rounded border border-violet-200 bg-white text-[10px] font-bold text-gray-700 hover:bg-violet-100 transition-colors"
                  >
                    {EMOTION_LABELS[emo]}
                  </button>
                ))}
              </div>

              {/* 掛け合いスクリプト入力 ─────────────────────────── */}
              {(() => {
                const parsed = parseDialogueScript(debugScript, config.defaultEmotion ?? 'neutral');
                return (
                  <div className="mt-3 border-t border-violet-200 pt-3">
                    <div className="text-[11px] font-bold text-violet-700 mb-1">
                      🎭 掛け合いスクリプト入力
                    </div>
                    <div className="text-[10px] text-gray-600 mb-2 leading-relaxed">
                      書式:{' '}
                      <code className="bg-white px-1 rounded">ずんだ: テキスト(2)</code>{' '}
                      /{' '}
                      <code className="bg-white px-1 rounded">めたん: テキスト(3)</code>{' '}
                      /{' '}
                      <code className="bg-white px-1 rounded">テキスト_z1</code>{' '}
                      /{' '}
                      <code className="bg-white px-1 rounded">テキスト_m4</code>
                      <br />
                      感情番号: 1=ニュートラル / 2=喜び / 3=怒り / 4=悲しみ / 5=驚き / 6=照れ
                      <br />
                      話者: z/ずんだ/ずんだもん, m/めたん/メタン/四国めたん
                    </div>

                    <div className="grid grid-cols-[1fr_220px] gap-2">
                      <textarea
                        value={debugScript}
                        onChange={(e) => setDebugScript(e.target.value)}
                        rows={6}
                        placeholder={'例）\nずんだ: こんにちは(2)\nめたん: よろしくね(6)\nやあ_z5\nあら_m3'}
                        className="w-full rounded-md border border-violet-200 bg-white px-2 py-1.5 text-[11px] font-mono resize-y outline-none focus:border-violet-500 transition-colors"
                      />
                      <div className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-[10px] overflow-y-auto max-h-[180px]">
                        <div className="font-bold text-violet-600 mb-1">
                          解析プレビュー ({parsed.length}件)
                        </div>
                        {parsed.length === 0 ? (
                          <div className="text-gray-400 text-[10px]">
                            解析可能な行がありません
                          </div>
                        ) : (
                          parsed.map((p, i) => (
                            <div
                              key={i}
                              className={`mb-1 leading-tight ${
                                p.character === 'zundamon' ? 'text-teal-700' : 'text-violet-700'
                              }`}
                            >
                              <span className="font-bold">
                                [{CHARACTER_CONFIG[p.character].label}/{EMOTION_LABELS[p.emotion]}]
                              </span>{' '}
                              <span className="text-gray-700">{p.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        disabled={parsed.length === 0 || isLoading}
                        onClick={() => {
                          void playLinesBatch(
                            parsed.map((p) => ({ speaker: p.character, emotion: p.emotion, text: p.text }))
                          );
                        }}
                        className="px-3 py-1.5 rounded-md bg-violet-600 text-white text-[11px] font-bold hover:bg-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ▶ 掛け合い再生 ({parsed.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDebugScript('')}
                        className="px-3 py-1.5 rounded-md border border-violet-300 text-violet-600 text-[11px] hover:bg-violet-100 transition-colors"
                      >
                        クリア
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDebugScript(
                            'ずんだ: こんにちは、今日はずんだ日和なのだ！(2)\nめたん: あらあら、また張り切っているのね。(6)\nぼくは空を飛べるのだ！_z5\nそんなわけないでしょ_m3'
                          )
                        }
                        className="px-3 py-1.5 rounded-md border border-violet-300 text-violet-600 text-[11px] hover:bg-violet-100 transition-colors"
                      >
                        サンプル
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-3 text-[10px] text-gray-500 border-t border-violet-200 pt-2">
                tenant: <code className="bg-white px-1 rounded">{config.tenantId ?? '-'}</code>{' '}
                user: <code className="bg-white px-1 rounded">{config.userId ?? '-'}</code>{' '}
                endpoint: <code className="bg-white px-1 rounded">{config.aiEndpoint ?? 'fallback (sample)'}</code>
              </div>
            </div>
          )}
            </div>
          )}
      </div>
    </div>
  );
}
