# DinD MCP Hub

Docker-in-Docker ベースのコンテナオーケストレーションシステム。  
子コンテナのデプロイ・管理・Web IDE アクセスを提供し、FastAPI の OpenAPI スキーマから MCP ツールを自動登録します。

## アーキテクチャ

```
Host
└── mcp-manager (docker:24.0-dind, privileged)
    ├── dockerd (内部 Docker デーモン)
    │   ├── traefik:v3.0 (リバースプロキシ :8080)
    │   └── myapp (子コンテナ on mcp-net)
    │       ├── code-server (:8000 → Web IDE)
    │       └── uvicorn/FastAPI (:80 → API)
    ├── manager-ui (Rust/Axum)
    └── mcp_server.py (FastMCP SSE)
```

## クイックスタート

### 前提条件

- Docker & Docker Compose

### 設定

`.env` ファイルで IP・ポートを設定します:

```env
# バインドアドレス (0.0.0.0 = 全インターフェース, 127.0.0.1 = ローカルのみ)
BIND_HOST=0.0.0.0

# Traefik リバースプロキシポート
TRAEFIK_PORT=8085

# 管理UI ポート
UI_PORT=8081

# MCP SSE サーバーポート
MCP_PORT=8000
```

### 起動

```bash
docker compose up -d
```

初回ビルドには数分かかります（Rust コンパイル + Traefik イメージ取得）。

### 停止

```bash
docker compose down
```

## 使い方

### 1. 管理UIからデプロイ

ブラウザで `http://<HOST>:<UI_PORT>` を開き、アプリカードの **Deploy** ボタンをクリックします。

### 2. APIからデプロイ

```bash
# デプロイ
curl -X POST http://<HOST>:8081/api/deploy/myapp

# 一覧
curl http://<HOST>:8081/api/apps

# ログ
curl http://<HOST>:8081/api/logs/myapp

# 削除
curl -X POST http://<HOST>:8081/api/delete/myapp
```

### 3. 子コンテナへのアクセス

デプロイ後、Traefik 経由で子コンテナにアクセスできます:

| 用途 | URL |
|------|-----|
| FastAPI | `http://<HOST>:<TRAEFIK_PORT>/myapp/` |
| Web IDE | `http://<HOST>:<TRAEFIK_PORT>/myapp-ide/` |

> **Note:** Web IDE のパスワードはコンテナログで確認できます。

### 4. MCP サーバー連携

MCP SSE サーバーは子コンテナの OpenAPI スキーマを15秒ごとにポーリングし、ツールとして自動登録します。

**Claude Desktop 等の設定例:**

```json
{
  "mcpServers": {
    "dind-hub": {
      "url": "http://<HOST>:<MCP_PORT>/sse"
    }
  }
}
```

## 新しいアプリの追加

`apps/` に新しいディレクトリを作成して Dockerfile と FastAPI アプリを置き、再ビルドします:

```bash
cp -r apps/myapp apps/newapp
# apps/newapp/app.py を編集
docker compose build
docker compose up -d
curl -X POST http://<HOST>:8081/api/deploy/newapp
```

## プロジェクト構成

```
McpHub/
├── .env                      # IP・ポート設定
├── docker-compose.yml        # DinD サービス定義
├── Dockerfile.manager        # マルチステージビルド
├── entrypoint.sh             # 内部サービス起動スクリプト
├── mcp_server.py             # FastMCP 動的ツール登録
├── requirements.txt          # Python 依存関係
├── apps/
│   └── myapp/                # 子コンテナテンプレート
│       ├── Dockerfile
│       ├── app.py
│       └── requirements.txt
└── rust_ui/
    ├── Cargo.toml
    ├── src/main.rs           # Axum バックエンド
    └── frontend/             # Next.js + shadcn/ui
```

## トラブルシューティング

### `error getting credentials` でビルドが失敗する

ホスト側の Docker クレデンシャルヘルパーの問題です。以下を実行してください:

```bash
mkdir -p ~/.docker
echo '{"credsStore":""}' > ~/.docker/config.json
```

その後 `docker compose build` を再実行してください。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| コンテナ基盤 | Docker-in-Docker (docker:24.0-dind) |
| リバースプロキシ | Traefik v3.0 |
| バックエンド | Rust / Axum |
| フロントエンド | Next.js / shadcn/ui |
| MCP サーバー | Python / FastMCP (SSE) |
| 子コンテナ | Ubuntu 22.04 / code-server / FastAPI |
