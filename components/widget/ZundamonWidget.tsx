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
import { CHARACTER_CONFIG, EMOTION_LABELS } from '@/lib/emotion-map';
import { synthesize, checkVoicevox } from '@/lib/voicevox';
import { useLipSyncVolume } from '@/lib/lipsync';
import type { VRMViewerHandle } from '@/components/VRMViewer';
import type {
  WidgetConversation,
  WidgetInitConfig,
  WidgetMessage,
} from '@/lib/widget-types';

const VRMViewer = dynamic(() => import('@/components/VRMViewer'), { ssr: false });

const EMOTIONS: Emotion[] = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'shy'];
const DEFAULT_SUGGESTIONS = [
  '受講生がログインできない場合',
  '有給休暇の確認方法は？',
];

const ZUNDAMON_ROT = Math.PI + 0.32;
const METAN_ROT = Math.PI - 0.32;

type SpeakerLine = { speaker: Character; emotion: Emotion; text: string };

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
    mode: (searchParams.get('mode') as WidgetInitConfig['mode']) ?? 'embedded',
    title: searchParams.get('title') ?? 'AIコンシェルジュ',
    subtitle: searchParams.get('subtitle') ?? 'ずんだもん × 四国めたん',
    characterName: searchParams.get('characterName') ?? 'ずんだもん',
    defaultEmotion: isEmotion(searchParams.get('emotion')) ? (searchParams.get('emotion') as Emotion) : 'neutral',
    showDebugPanel: searchParams.get('debug') === '1',
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
  const [panelOpen, setPanelOpen] = useState(true);
  const [showControlPanel, setShowControlPanel] = useState<boolean>(!!config.showDebugPanel);
  const [bubble, setBubble] = useState<{ speaker: Character; text: string } | null>(null);

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

  const postResize = useCallback(() => {
    if (typeof document === 'undefined') return;
    const doc = document.documentElement;
    const body = document.body;
    const height = Math.max(body.scrollHeight, body.offsetHeight, doc.clientHeight, doc.scrollHeight, doc.offsetHeight);
    emit('zundamon:resize', { height });
  }, [emit]);

  // ── Effects ─────────────────────────────────────────────────────
  useEffect(() => { parentOriginRef.current = resolveParentOrigin(searchParams); }, [searchParams]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { messagesRef.current = messages; postResize(); }, [messages, postResize]);
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
    const observer = new ResizeObserver(() => postResize());
    observer.observe(document.body);
    resizeObserverRef.current = observer;
    postResize();
    return () => { observer.disconnect(); resizeObserverRef.current = null; };
  }, [postResize]);

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

  // ── AI endpoint resolve (or fallback) ──────────────────────────
  const resolveReply = useCallback(async (prompt: string): Promise<SpeakerLine[]> => {
    const cfg = configRef.current;
    if (!cfg.aiEndpoint) {
      return SAMPLE_RESPONSES[classifyTheme(prompt)];
    }
    try {
      const res = await fetch(cfg.aiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        },
        body: JSON.stringify({
          input: prompt,
          history: messagesRef.current,
          context: contextRef.current,
          tenantId: cfg.tenantId,
          userId: cfg.userId,
          defaultEmotion: cfg.defaultEmotion ?? 'neutral',
          character: cfg.characterName ?? 'ずんだもん',
        }),
      });
      if (!res.ok) throw new Error(`AI endpoint ${res.status}`);
      const body = await res.json();

      // 配列応答なら掛け合いをそのまま使う
      if (Array.isArray(body.lines)) {
        type MaybeLine = { speaker?: unknown; emotion?: unknown; text?: unknown };
        return (body.lines as unknown[])
          .filter((l): l is MaybeLine => !!l && typeof l === 'object')
          .map((l): SpeakerLine => ({
            speaker: isCharacter(l.speaker) ? l.speaker : 'zundamon',
            emotion: isEmotion(l.emotion) ? l.emotion : (cfg.defaultEmotion ?? 'neutral'),
            text: String(l.text ?? ''),
          }))
          .filter((l) => l.text.length > 0);
      }
      // 単発応答
      const text = body.replyText ?? body.text ?? body.message ?? prompt;
      return [{
        speaker: isCharacter(body.character) ? body.character : 'zundamon',
        emotion: isEmotion(body.emotion) ? body.emotion : (cfg.defaultEmotion ?? 'neutral'),
        text,
      }];
    } catch (e) {
      console.error('[widget] AI endpoint failed, fallback:', e);
      return SAMPLE_RESPONSES[classifyTheme(prompt)];
    }
  }, []);

  const runConversation = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isLoading) return;
    setError(null);
    setIsLoading(true);
    const userMessage: WidgetMessage = {
      id: makeId(),
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    };
    appendMessageToActive(userMessage);
    emit('zundamon:messageSent', userMessage);

    try {
      const lines = await resolveReply(text);
      for (const line of lines) queueRef.current.push(() => playLine(line));
      await runQueue();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '不明なエラー';
      setError(msg);
      emit('zundamon:error', { message: msg });
      setIsLoading(false);
    }
  }, [appendMessageToActive, emit, isLoading, playLine, resolveReply, runQueue]);

  // ── postMessage 受信 ────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.namespace !== 'zundamonWidget') return;
      if (parentOriginRef.current !== '*' && event.origin !== parentOriginRef.current) return;

      switch (data.type) {
        case 'zundamon:init': {
          const next = (data.payload ?? {}) as WidgetInitConfig;
          parentOriginRef.current = next.parentOrigin || event.origin || parentOriginRef.current;
          contextRef.current = next.context ?? contextRef.current;
          setConfig((prev) => ({ ...prev, ...next, context: next.context ?? prev.context }));
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
    <div className="min-h-screen w-full flex flex-col" style={{ background: '#f5f6f8' }}>
      <div className="concierge-wrap flex flex-col flex-1 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.07)] border-b-2 border-gray-200 overflow-hidden">
        {/* ── タイトルバー (プルダウン開閉) ─────────────────────────── */}
        <div className="c-bar flex items-center justify-between px-4 py-2 select-none border-b border-gray-100">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span className="text-lg">🌿💜</span>
            <span className="text-sm font-bold text-gray-800">
              {config.title ?? 'AIコンシェルジュ'}（ずんだもん × 四国めたん）
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">β版</span>
            {showControlPanel && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">
                DEBUG
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="w-7 h-7 rounded-full text-white text-sm flex items-center justify-center transition-transform"
            style={{
              backgroundColor: primaryColor,
              transform: panelOpen ? 'rotate(180deg)' : 'none',
            }}
            aria-label={panelOpen ? '閉じる' : '開く'}
          >
            ▲
          </button>
        </div>

        {/* ── 本体 (開閉可能) ──────────────────────────────────────── */}
        <div
          className="flex flex-col transition-all duration-500 ease-in-out overflow-hidden"
          style={{
            height: panelOpen ? 'calc(100vh - 40px)' : '0px',
            opacity: panelOpen ? 1 : 0,
          }}
        >
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── 左: 会話履歴 ────────────────────────────────────── */}
            <div className="w-[160px] shrink-0 flex flex-col border-r border-gray-200 bg-gray-50">
              <div className="px-3 py-2 text-[11px] font-bold text-gray-400 border-b border-gray-200 bg-white">
                📋 会話履歴
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
                    onClick={() => setActiveConvId(c.id)}
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
            <div
              className="flex-1 flex flex-col relative overflow-hidden border-r border-gray-200"
              style={{ background: 'linear-gradient(180deg, #eef7f4, #f5fdfb)' }}
            >
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

              <div className="flex flex-1 min-h-0">
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
                <div className="w-px bg-gray-200" />
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
            </div>

            {/* ── 右: チャット履歴 ───────────────────────────────── */}
            <div className="w-[420px] shrink-0 flex flex-col bg-[#fafcff]">
              <div className="px-3 py-2 text-[11px] font-bold text-gray-400 border-b border-gray-200 bg-white flex items-center justify-between">
                <span>💬 チャット</span>
                {isLoading && <span className="text-teal-600">返答生成中...</span>}
              </div>
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center opacity-70 text-xs">
                    <div className="text-3xl mb-2">💬</div>
                    <p>何でも質問してほしいのだ！</p>
                    <p className="mt-1 text-gray-400">二人で答えるのだ 🌿💜</p>
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
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                            isZunda ? 'bg-teal-50' : 'bg-violet-50'
                          }`}
                        >
                          {isZunda ? '🌿' : '💜'}
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
          <div className="flex items-end gap-2 px-4 py-2 border-t-2 border-gray-200 bg-white flex-shrink-0">
            <select className="px-2 py-1.5 rounded-md border border-gray-300 bg-cyan-700 text-white text-[11px] cursor-pointer flex-shrink-0">
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
              placeholder="質問を入力（Enterで送信、Shift+Enterで改行）"
              rows={1}
              className="flex-1 min-h-[34px] max-h-[80px] rounded-md border border-gray-300 px-3 py-2 text-[12px] resize-none outline-none focus:border-teal-500 transition-colors"
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
              className="px-4 py-2 rounded-md text-white text-xs font-bold flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: primaryColor }}
            >
              {isLoading ? '送信中' : '送信'}
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
                      // 強制的にずんだもんへ感情を乗せてお試し発話
                      queueRef.current.push(() =>
                        playLine({ speaker: 'zundamon', emotion: emo, text: `ぼくは今${EMOTION_LABELS[emo]}の気分なのだ！` })
                      );
                      void runQueue();
                    }}
                    className="py-2 rounded border border-violet-200 bg-white text-[10px] font-bold text-gray-700 hover:bg-violet-100 transition-colors"
                  >
                    {EMOTION_LABELS[emo]}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                tenant: <code className="bg-white px-1 rounded">{config.tenantId ?? '-'}</code>{' '}
                user: <code className="bg-white px-1 rounded">{config.userId ?? '-'}</code>{' '}
                endpoint: <code className="bg-white px-1 rounded">{config.aiEndpoint ?? 'fallback (sample)'}</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
