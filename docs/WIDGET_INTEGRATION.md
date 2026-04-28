# zundamon-platform を汎用ウィジェット化する実装セット

## このセットで追加するもの

- `app/widget/page.tsx`
  - iframe 本体になるウィジェット画面
- `components/widget/ZundamonWidget.tsx`
  - ずんだもん PF の UI 本体
- `lib/widget-types.ts`
  - SDK と iframe 間で使う型
- `public/widget/zundamon-widget-sdk.js`
  - ホストページ側で読む Loader Script
- `public/widget/host-demo.html`
  - 埋め込みサンプル

## 既存 repo とどうつながるか

この実装は、既存の以下を再利用します。

- `app/api/speak/route.ts`
  - テキスト → ずんだもん向け発話テキスト + 感情別 blendShape + styleId を返す
- `components/VRMViewer.tsx`
  - 3D VRM 表示
- `lib/voicevox.ts`
  - VOICEVOX 音声合成
- `lib/lipsync.ts`
  - 口パク
- `lib/emotion-map.ts`
  - 感情マスタ

## 追加後の利用 URL

- 通常アプリ画面: `/`
- ウィジェット本体: `/widget`
- SDK スクリプト: `/widget/zundamon-widget-sdk.js`
- 埋め込みデモ: `/widget/host-demo.html`

## ホストページでの利用例

```html
<div id="ai-concierge-root"></div>
<script src="https://YOUR-DOMAIN/widget/zundamon-widget-sdk.js"></script>
<script>
  const widget = window.ZundamonWidget.init({
    container: '#ai-concierge-root',
    baseUrl: 'https://YOUR-DOMAIN',
    mode: 'embedded',
    humanId: 'EMP00123',
    tenantId: 'xxx',
    userId: '12345',
    token: 'signed_token',
    aiEndpoint: 'https://YOUR-API/assistant/reply',
    title: 'AIコンシェルジュ',
    subtitle: 'ずんだもん PF',
    theme: { primaryColor: '#14b8a6' }
  });
</script>
```

ユーザー識別子の優先順位は `humanId (SDK init)` > `humanid (iframe query)` > `userId` です。`humanId` / `humanid` は trim 後 1〜50 文字のみ有効です。

## AI Endpoint の期待レスポンス

widget は `aiEndpoint` が指定されている場合、次のような JSON を期待します。

### request

```json
{
  "input": "有給休暇の確認方法は？",
  "history": [],
  "context": {},
  "tenantId": "xxx",
  "userId": "12345",
  "defaultEmotion": "neutral",
  "character": "ずんだもん"
}
```

### response

```json
{
  "replyText": "有給休暇の確認はメニューの勤怠画面からできるのだ。",
  "emotion": "happy"
}
```

`replyText` がなければ `text` / `message` も拾います。

## いまの段階で未実装のもの

- 署名付きトークンの検証 API
- テナントごとのナレッジ切り替え
- human escalation
- floating モードの iframe 内ヘッダー制御
- 親アプリとネイティブアプリの bridge 最適化

## 次にやるとよいこと

1. `aiEndpoint` を既存の AI コンシェルジュ API に接続する
2. `token` を短命 JWT にする
3. `allowed origin` をサーバー側でも検証する
4. `floating` と `fullscreen` の UI 差分を詰める
5. `setContext()` にユーザー属性・画面文脈・FAQ領域を渡す
