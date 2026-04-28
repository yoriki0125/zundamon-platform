# Zundamon Platform 🌱

ずんだもん × 四国めたん の **AI コンシェルジュ プラットフォーム**。
質問テキストを投げると 2 体の VRM 3D キャラクターが掛け合いで回答し、VOICEVOX で音声合成、感情に応じた表情変化と口パクまで行います。

任意のサイトに `<script>` 1 本で組み込める **汎用 iframe ウィジェット** としても配信できます。

---

## 🎯 主な機能

| 機能 | 説明 |
| --- | --- |
| 3D キャラクター描画 | VRM ファイルを Three.js + @pixiv/three-vrm でリアルタイム表示。呼吸・横揺れ・表情ブレンドシェイプ対応。 |
| 感情マッピング | `neutral / happy / sad / angry / surprised / shy` などの感情タグ → 表情 + VOICEVOX スタイル ID へ自動変換。 |
| 音声合成 (VOICEVOX) | ローカル VOICEVOX エンジン (`localhost:50021`) で発話。スタイル候補から最適な ID を解決。 |
| リップシンク | 合成音声の波形解析からリアルタイムに口を動かす (`lib/lipsync.ts`)。 |
| 掛け合い対話 | `ずんだもん:` / `めたん:` プレフィックス、または `_z1` / `_m2` サフィックスで台本を解析し、1 行ずつ順次再生。 |
| AI 連携 (Dify) | `/api/dify` 経由で Dify Chatflow に接続。SSE ストリーミングをパースしてテキスト化。 |
| 汎用 iframe ウィジェット | `<script src=".../zundamon-widget-sdk.js">` 1 本で任意サイトに埋め込み可能。`embedded` / `floating` / `fullscreen` 3 モード対応。 |
| SP (モバイル) 対応 | レスポンシブ。サイドバー / チャット履歴はドロワー化。3D モデルは縮小表示。 |
| デバッグパネル | `Ctrl + Shift + D` で感情お試し・台本テスター起動。 |

---

## 📦 技術スタック

- **フレームワーク**: Next.js 16.2.4 (App Router, Turbopack) / React 19 / TypeScript 5
- **3D**: Three.js + @pixiv/three-vrm
- **UI**: Tailwind CSS / shadcn-ui 派生コンポーネント
- **音声**: VOICEVOX (HTTP API)
- **AI**: Dify Chatflow (Server-Sent Events)
- **配布**: Docker / Docker Compose

> ⚠️ Next.js 16 は破壊的変更を含みます。実装前に `node_modules/next/dist/docs/` を必ず確認してください (`AGENTS.md` 参照)。

---

## 🗂 ディレクトリ構成

```
zundamon-platform/
├── app/
│   ├── page.tsx                  # スタジオ画面 (DialoguePanel + VRMViewer)
│   ├── layout.tsx
│   ├── widget/page.tsx           # iframe で読み込まれるウィジェット本体
│   └── api/
│       ├── speak/route.ts        # テキスト → 発話テキスト + blendShape + styleId
│       ├── dify/route.ts         # Dify Chatflow プロキシ (SSE → テキスト)
│       └── widget-chat/route.ts  # ウィジェット既定 AI エンドポイント (lines[] を返す)
├── components/
│   ├── VRMViewer.tsx             # VRM 3D 描画
│   ├── DialoguePanel.tsx         # スタジオ画面の入力 + 履歴
│   ├── SpeakPanel.tsx
│   ├── HistoryList.tsx
│   ├── widget/
│   │   └── ZundamonWidget.tsx    # ウィジェット UI (postMessage 受信含む)
│   └── ui/                       # shadcn 系プリミティブ
├── lib/
│   ├── voicevox.ts               # VOICEVOX クライアント・スタイル ID 解決
│   ├── emotion-map.ts            # 感情 → 表情 / スタイル候補マスタ
│   ├── lipsync.ts                # 音声波形 → 口パク
│   ├── dialogue-parser.ts        # ずんだ/めたん 台本パーサ
│   ├── zundamon-transform.ts     # 「〜なのだ」変換等
│   ├── widget-types.ts           # SDK ⇔ iframe 共有型
│   └── types.ts
├── public/
│   ├── models/zundamon.vrm       # ⚠ 別途配置必要
│   ├── models/metan.vrm          # ⚠ 別途配置必要
│   └── widget/
│       ├── zundamon-widget-sdk.js
│       └── host-demo.html
├── docs/
│   ├── EMBEDDING_GUIDE.md        # ウィジェット埋め込み詳細ガイド
│   └── WIDGET_INTEGRATION.md
├── docker-compose.yml
├── Dockerfile
└── AGENTS.md                     # Next.js 16 利用上の注意
```

---

## 🚀 セットアップ

### 前提

- **Node.js 20+**
- **VOICEVOX アプリ** (ローカル開発時) または **Docker** (運用時)
- VRM モデル: `public/models/zundamon.vrm` / `public/models/metan.vrm`
  > VRM のライセンスは配布元規約に従ってください。

### ローカル開発

```bash
# 1. 依存インストール
npm install

# 2. 環境変数を設定
cat > .env.local <<'EOF'
DIFY_API_KEY=app-xxxxxxxxxxxxxxxxxxxxxxxx
DIFY_API_URL=https://api.dify.ai/v1/chat-messages
VOICEVOX_URL=http://localhost:50021
EOF

# 3. VOICEVOX エンジンを起動 (アプリを開く)

# 4. dev サーバー起動
npm run dev
```

- スタジオ画面: http://localhost:3000
- ウィジェット単体: http://localhost:3000/widget
- 埋め込みデモ: http://localhost:3000/widget/host-demo.html

### Docker

```bash
docker compose up --build
```

GPU 版 VOICEVOX を使うには `docker-compose.yml` のコメントを参照。

---

## 🔌 API リファレンス

### `POST /api/speak`

テキストと感情を受け取り、VOICEVOX 用 styleId と表情データを返す。

**Request**
```json
{ "text": "こんにちはなのだ", "emotion": "happy", "character": "zundamon" }
```

**Response**
```json
{
  "spokenText": "こんにちはなのだ！",
  "blendShapes": { "happy": 1.0 },
  "voicevoxStyleId": 1,
  "character": "zundamon"
}
```

URL を含むテキストは VOICEVOX が誤読するため自動で除去されます。

### `POST /api/dify`

Dify Chatflow への薄いプロキシ。SSE をサーバ側で読み切ってプレーンテキストに圧縮。

**Request**
```json
{ "query": "有給の取り方を教えて", "conversationId": "", "userId": "u1" }
```

**Response**
```json
{ "answer": "ずんだ: 有給は勤怠画面から申請なのだ(1)", "conversationId": "abc-123" }
```

### `POST /api/widget-chat`

ウィジェットの**既定** AI エンドポイント。`/api/dify` の応答を `lines[]` 配列に整形。

**Request**
```json
{
  "input": "有給の確認方法は？",
  "history": [],
  "context": {},
  "tenantId": "demo",
  "userId": "u1",
  "conversationId": ""
}
```

**Response**
```json
{
  "lines": [
    { "speaker": "zundamon", "text": "勤怠画面から確認なのだ！", "emotion": "happy" },
    { "speaker": "metan",    "text": "右上のメニューからどうぞ。", "emotion": "neutral" }
  ],
  "conversationId": "abc-123"
}
```

---

## 🧩 ウィジェット埋め込み

詳細は [`docs/EMBEDDING_GUIDE.md`](docs/EMBEDDING_GUIDE.md) を参照。最小例:

```html
<div id="ai-concierge-root"></div>
<script src="https://YOUR-DOMAIN/widget/zundamon-widget-sdk.js"></script>
<script>
  const widget = window.ZundamonWidget.init({
    container: '#ai-concierge-root',
    baseUrl: 'https://YOUR-DOMAIN',
    mode: 'embedded',           // 'embedded' | 'floating' | 'fullscreen'
    humanId: 'EMP00123',        // 推奨: 利用ユーザーID (1〜50文字)
    title: 'AIコンシェルジュ',
    subtitle: 'ずんだもん × 四国めたん',
    suggestedPrompts: ['有給休暇の確認方法は？'],
    theme: { primaryColor: '#14b8a6', accentColor: '#8b5cf6' },
  });

  // ホストから外部制御
  widget.sendMessage('受講生がログインできない');
  widget.setContext({ page: 'dashboard' });
</script>
```

`aiEndpoint` を渡さなければ同梱の `/api/widget-chat` (Dify 接続) にフォールバックします。

ユーザー識別子の優先順位は `humanId (SDK init)` > `humanid (iframe query)` > `userId` です。`humanId` / `humanid` は trim 後 1〜50 文字のみ有効です。

---

## 🎭 感情タグ

| 番号 | タグ | 用途 | VOICEVOX スタイル候補 (ずんだもん) |
| --- | --- | --- | --- |
| 1 | `neutral`   | 平常・説明               | 3 (ノーマル) |
| 2 | `happy`     | 喜び・ポジティブな情報   | 1 (あまあま) |
| 3 | `angry`     | 注意・NG・憤慨           | 7 (ツンツン) |
| 4 | `sad`       | 残念・制限事項           | 3 |
| 5 | `surprised` | 驚き・新発見             | 1 |
| 6 | `shy`       | 照れ・締め・やさしい瞬間 | 5 (ささやき) |

スタイル ID はランタイムで `lib/voicevox.ts` の `resolveStyleId()` がエンジンに問い合わせて解決します。

台本・Dify 出力では末尾に `_z2`（ずんだもん・喜び）`_m6`（めたん・照れ）のように記述します。詳細は次節の台本フォーマットを参照。

---

## 📝 台本フォーマット

`lib/dialogue-parser.ts` は以下の表記をパースします（混在可）。

```
ずんだもん：有給は勤怠画面なのだ_z1
めたん：右上のメニューからね_m2
```

- プレフィックス: `ずんだもん:` / `ずんだ:` / `四国めたん:` / `めた:` / `metan:` / `zundamon:` 等
- サフィックス: `_z1`〜`_z6` (ずんだもん) / `_m1`〜`_m6` (めたん) — 数字は感情番号
- プレフィックスとサフィックスが両方ある場合も正しく剥離して感情を上書き

---

## 🤖 Dify システムプロンプト

Dify の **Instructions 欄**に貼り付けるプロンプト全文は [`docs/dify-system-prompt.md`](docs/dify-system-prompt.md) を参照。

主な設計ポイント:

| 項目 | 内容 |
| --- | --- |
| キャラクター調整 | ずんだもんは「突拍子もなさ」を感情リアクションに限定し、誤情報・脱線を禁止。コンシェルジュとして信頼できる水準を維持 |
| 感情の積極利用 | ニュートラル（1）のみで埋めることを禁止。1返答で最低3種類の感情番号を使用し、最終行は必ず照れ（6）か喜び（2）で締める |
| ずんだもんの感情傾向 | 行の過半数を喜び（2）か驚き（5）にする。勢いとリアクションがキャラの核 |
| めたんの感情傾向 | 説明本文はニュートラル（1）可。締め・フォローは必ず照れ（6）か喜び（2）を使う |
| 文体ルール | 箇条書き（`・` `-` `※`）・文書ラベル（`CC：` `注：`）・発話内改行を禁止。会話口調に変換 |
| コード・ID | 講座コード等は文章に自然に埋め込む。括弧だけの羅列禁止 |
| 完結性 | 1ターンで必ず完結。追加質問や「詳細は〜を確認して」の丸投げ禁止 |

---

## 🛠 開発 Tips

- `Ctrl + Shift + D` でデバッグパネル表示（感情切替 / 台本テスター）
- ホスト HTML を `file://` で開いた場合、SDK は自動で `http://localhost:3000` にフォールバック
- ハイドレーションエラーは ColorZilla 等の拡張機能由来のため `suppressHydrationWarning` で抑止済み
- `npm run lint` / `npm run build` で本番ビルド確認

---

## 📄 ライセンス / クレジット

- VRM モデル / VOICEVOX 音源は各配布元の規約に従ってください
- 本リポジトリのソースコードは社内利用を想定しています

---

## 🗺 ロードマップ

- [ ] 署名付きトークンの検証 API
- [ ] テナントごとのナレッジ切り替え
- [ ] human escalation
- [ ] floating モードの iframe 内ヘッダー制御
- [ ] allowed origin のサーバー側検証
- [ ] WebRTC / WebSocket でのストリーミング再生
