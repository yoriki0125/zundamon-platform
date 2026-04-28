# ずんだもんウィジェット 埋め込みガイド

ずんだもん × 四国めたん の AI コンシェルジュを、任意の Web ページに `<script>` 1 本で組み込むためのガイドです。

汎用ウィジェットとして設計されているため、ホスト側が独自の AI バックエンドを持たなくてもそのまま動作します（デフォルトで同梱の `/api/widget-chat` → Dify にフォールバックします）。

## 1. 最短の埋め込み手順

```html
<div id="ai-concierge-root"></div>
<script src="https://YOUR-DOMAIN/widget/zundamon-widget-sdk.js"></script>
<script>
  const widget = window.ZundamonWidget.init({
    container: '#ai-concierge-root',
    baseUrl: 'https://YOUR-DOMAIN',
    mode: 'embedded',
    title: 'AIコンシェルジュ',
    subtitle: 'ずんだもん × 四国めたん',
  });
</script>
```

これだけで iframe が展開され、質問入力 → AI 応答 → ずんだもん/めたんの音声読み上げ + 3D 表情 が動きます。

動作サンプルは [`public/widget/host-demo.html`](../public/widget/host-demo.html) を参照してください。

## 2. 動作モード (`mode`)

| mode | 用途 | 見た目 |
| --- | --- | --- |
| `embedded`   | ページ内セクションとして埋め込む（推奨） | 指定した `container` の中に iframe |
| `floating`   | 画面右下にチャットバブルとして表示 | ランチャー + ポップアップ |
| `fullscreen` | 全画面モーダル | 画面いっぱい |

```js
window.ZundamonWidget.init({
  container: '#ai-concierge-root',
  baseUrl: 'https://YOUR-DOMAIN',
  mode: 'floating',
});
```

## 3. 設定オプション

| key | 型 | 説明 |
| --- | --- | --- |
| `container` | `string \| HTMLElement` | iframe を差し込む要素 |
| `baseUrl` | `string` | ウィジェットを配信しているオリジン |
| `mode` | `'embedded' \| 'floating' \| 'fullscreen'` | 動作モード |
| `title` | `string` | ヘッダータイトル |
| `subtitle` | `string` | ヘッダーサブタイトル |
| `characterName` | `string` | 主キャラ名 (既定: ずんだもん) |
| `tenantId` / `userId` / `token` | `string` | ホスト側の識別子 / 短命トークン |
| `humanid` (iframe query) | `string` | iframe URLクエリで渡す利用ユーザーID。1〜50文字、有効時は`userId`として扱われる |
| `aiEndpoint` | `string` | 独自 AI エンドポイント。未指定なら `/api/widget-chat` |
| `suggestedPrompts` | `string[]` | 入力欄のサジェスト |
| `theme.primaryColor` / `accentColor` | `string` | ブランドカラー |
| `minHeight` / `maxHeight` | `number` | `embedded` 時の iframe 高さ |
| `onReady` / `onAnswerShown` / `onMessageSent` / `onError` | `(payload) => void` | イベントコールバック |

## 4. AI エンドポイントの契約

`iframe`埋め込みURLに `humanid` を付与できます。

```html
<iframe src="https://YOUR-DOMAIN/widget?mode=embedded&humanid=EMP00123"></iframe>
```

- `humanid` は trim 後 1〜50 文字のときのみ有効です。
- 有効な `humanid` がある場合、内部では `userId` より優先してAIリクエストへ渡されます。

`aiEndpoint` を指定しない場合、ウィジェットは同梱の `/api/widget-chat`（Dify プロキシ）を使います。独自 AI につなぐ場合は、以下の契約を満たしてください。

### Request

```json
{
  "input": "有給休暇の確認方法は？",
  "history": [{ "role": "user", "content": "..." }],
  "context": { "page": "dashboard" },
  "tenantId": "xxx",
  "userId": "12345",
  "defaultEmotion": "neutral",
  "character": "ずんだもん",
  "conversationId": "optional-dify-conversation-id"
}
```

### Response

単発の返答:

```json
{ "replyText": "有給休暇はメニューの勤怠画面から確認できるのだ。", "emotion": "happy" }
```

掛け合い (ずんだもん × めたん) を返したい場合:

```json
{
  "lines": [
    { "speaker": "zundamon", "text": "有給は勤怠画面から確認なのだ！", "emotion": "happy" },
    { "speaker": "metan",    "text": "そうね、右上のメニューからどうぞ。", "emotion": "neutral" }
  ],
  "conversationId": "xxxx-xxxx"
}
```

- `lines[]` を返すと 1 行ずつ順に吹き出し + 音声再生されます（chat 履歴は一気に表示）。
- `replyText` のみでも動作します（`text` / `message` もフォールバックで拾います）。
- `emotion` は `neutral | happy | sad | angry | surprised | thinking` のいずれか。

## 5. postMessage API

SDK が返すハンドルからウィジェットを外部制御できます。

```js
widget.sendMessage('受講生がログインできない');
widget.setContext({ page: 'dashboard', role: 'ssc' });
widget.destroy();
```

ホスト側で受け取れるイベント（`onReady` などのコールバック、あるいは `window.addEventListener('message', ...)`）:

- `zundamon:ready` — ウィジェット起動完了
- `zundamon:messageSent` — 質問送信
- `zundamon:answerShown` — 回答表示
- `zundamon:error` — エラー

## 6. 開発 Tips

- `file://` でホスト HTML を開いた場合、SDK は自動で `http://localhost:3000` にフォールバックします（`host-demo.html` 参照）。
- ウィジェット画面上で `Ctrl + Shift + D` を押すとデバッグパネル（感情切替、台本テスター等）が開きます。
- 音声合成は VOICEVOX (既定: `http://localhost:50021`) を使用。本番は `VOICEVOX_URL` 環境変数で差し替えてください。
- `DIFY_API_KEY` / `DIFY_API_URL` を `.env.local` に設定すると、デフォルト AI エンドポイントが Dify に接続されます。

## 7. 公開 URL 早見表

- ウィジェット本体: `/widget`
- SDK スクリプト: `/widget/zundamon-widget-sdk.js`
- 埋め込みデモ: `/widget/host-demo.html`
- デフォルト AI: `/api/widget-chat`
- 発話 API: `/api/speak`

## 8. 今後の TODO

- 署名付きトークンの検証 API
- テナントごとのナレッジ切り替え
- human escalation フロー
- allowed origin のサーバー側検証
