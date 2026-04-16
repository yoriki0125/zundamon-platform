# ずんだもん喋らせ台

テキストと感情タグを入力すると、3Dずんだもんが感情に応じた表情・声で喋る社内ツールです。

## 前提条件

- **`public/models/zundamon.vrm`** が配置済みであること
- ローカル開発時: Node.js 20+ / VOICEVOXアプリ起動済み
- サーバー運用時: Docker / Docker Compose

## ローカル開発

### 1. VRMモデルの配置

```
public/models/zundamon.vrm
```

> **注意**: VRMモデルの利用は配布元の規約に従ってください。社内利用であっても、モデルのライセンス条件を必ず確認してから使用してください。

### 2. VOICEVOXエンジンの起動

VOICEVOXアプリを起動してください (`localhost:50021` で動作)。

### 3. 起動

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開いてください。

---

## Docker (サーバー運用)

### 前提

- Docker / Docker Compose がインストール済みであること
- `public/models/zundamon.vrm` が配置済みであること

### 起動

```bash
docker compose up --build
```

- アプリ: http://サーバーIP:3000
- VOICEVOXエンジン: http://サーバーIP:50021 (内部のみで使用)

### GPU版VOICEVOXを使う場合

`docker-compose.yml` 内のコメントを参照してください。

### 停止

```bash
docker compose down
```

---

## Step別 動作確認手順

### Step 1: VRM表示
- `npm run dev` でずんだもんが画面中央に表示される
- ゆっくり呼吸している (胸の上下)
- ブラウザのDevToolsコンソールに利用可能なExpression名が出力される
- VRMファイルが無い場合はエラーメッセージが表示される

### Step 2〜5
(実装後に追記予定)

---

## 感情タグ一覧

| タグ | 説明 | VOICEVOXスタイル |
|---|---|---|
| neutral | ノーマル | 3 |
| happy | うれしい | 1 (あまあま) |
| angry | おこ | 7 (ツンツン) |
| sad | かなしい | 3 |
| surprised | びっくり | 1 |
| shy | はずかしい | 5 (ささやき) |
