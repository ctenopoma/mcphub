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
    ├── manager-ui (Rust/Axum :8081)
    └── mcp_server.py (FastMCP SSE :8000)
```

### ポートマッピング

| ホスト | コンテナ内 | サービス |
|--------|-----------|---------|
| 8085 | 8080 | Traefik（子コンテナへのルーティング） |
| 8081 | 8081 | 管理UI（Rust/Axum + Next.js） |
| 8000 | 8000 | MCP SSE サーバー |

## クイックスタート

### 前提条件

- Docker & Docker Compose

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

ブラウザで `http://localhost:8081` を開き、アプリカードの **Deploy** ボタンをクリックします。

### 2. APIからデプロイ

```bash
# デプロイ
curl -X POST http://localhost:8081/api/deploy/myapp

# 一覧
curl http://localhost:8081/api/apps

# ログ
curl http://localhost:8081/api/logs/myapp

# 削除
curl -X POST http://localhost:8081/api/delete/myapp
```

### 3. 子コンテナへのアクセス

デプロイ後、Traefik 経由で子コンテナにアクセスできます。

| 用途 | URL |
|------|-----|
| FastAPI | `http://localhost:8085/myapp/` |
| Web IDE (code-server) | `http://localhost:8085/myapp-ide/` |

> **Note:** Web IDE のパスワードはコンテナログ (`curl http://localhost:8081/api/logs/myapp`) で確認できます。

### 4. MCP サーバー連携

MCP SSE サーバーは子コンテナの OpenAPI スキーマを15秒ごとにポーリングし、エンドポイントを MCP ツールとして自動登録します。

**Claude Desktop 等の設定例:**

```json
{
  "mcpServers": {
    "dind-hub": {
      "url": "http://localhost:8000/sse"
    }
  }
}
```

**登録ツールの確認:**

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install mcp httpx
python3 test_client.py
```

```
Tools:
- list_registered_tools: List all currently registered dynamic MCP tools.
- myapp_read_root__get: Read Root
- myapp_upload_file_upload_post: Upload File
```

## 新しいアプリの追加

`apps/` に新しいディレクトリを作成して Dockerfile と FastAPI アプリを置きます。

```bash
cp -r apps/myapp apps/newapp
# apps/newapp/app.py を編集
curl -X POST http://localhost:8081/api/deploy/newapp
```

OpenAPI スキーマを公開している FastAPI アプリであれば、MCP ツールとして自動で登録されます。

## プロジェクト構成

```
McpHub/
├── docker-compose.yml        # DinD サービス定義
├── Dockerfile.manager        # マルチステージビルド (Next.js → Rust → DinD)
├── entrypoint.sh             # dockerd, Traefik, Rust UI, MCP サーバー起動
├── mcp_server.py             # FastMCP 動的ツール登録サーバー
├── requirements.txt          # Python 依存関係
├── test_client.py            # MCP ツール確認用クライアント
├── apps/
│   └── myapp/                # 子コンテナテンプレート
│       ├── Dockerfile
│       ├── app.py            # FastAPI アプリ
│       └── requirements.txt
└── rust_ui/
    ├── Cargo.toml
    ├── src/main.rs           # Axum バックエンド
    └── frontend/             # Next.js + shadcn/ui ダッシュボード
        ├── package.json
        └── src/app/page.tsx
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| コンテナ基盤 | Docker-in-Docker (docker:24.0-dind) |
| リバースプロキシ | Traefik v3.0 |
| バックエンド | Rust / Axum |
| フロントエンド | Next.js / shadcn/ui / Radix UI |
| MCP サーバー | Python / FastMCP (SSE transport) |
| 子コンテナ | Ubuntu 22.04 / code-server / FastAPI |
