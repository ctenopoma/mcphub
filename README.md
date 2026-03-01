<div align="center">

<img src="rust_ui/frontend/public/mcphub.png" alt="MCP Hub Logo" width="200">

# 🐳 DinD MCP Hub

**Docker-in-Docker ベースのコンテナオーケストレーションシステム**

子コンテナのデプロイ・管理・Web IDE アクセスを提供し、FastAPI の OpenAPI スキーマから MCP ツールを自動登録します。

[![Docker](https://img.shields.io/badge/Docker-24.0--dind-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Rust](https://img.shields.io/badge/Rust-Axum-DEA584?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Python](https://img.shields.io/badge/Python-FastMCP-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-shadcn/ui-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Traefik](https://img.shields.io/badge/Traefik-v3.0-24A1C1?style=for-the-badge&logo=traefikproxy&logoColor=white)](https://traefik.io/)

</div>

---

## 📐 アーキテクチャ

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

---

## ⚡ クイックスタート

### 📋 前提条件

| 必要ツール | バージョン |
|:----------:|:----------:|
| ![Docker](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&logo=docker&logoColor=white) | 最新推奨 |
| ![Docker Compose](https://img.shields.io/badge/-Docker_Compose-2496ED?style=flat-square&logo=docker&logoColor=white) | v2+ |

### ⚙️ 設定

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

### 🚀 起動

```bash
docker compose up -d
```

> [!NOTE]
> 初回ビルドには数分かかります（Rust コンパイル + Traefik イメージ取得）。

### 🛑 停止

```bash
docker compose down
```

---

## 🎯 使い方

### 1️⃣ 管理UIからデプロイ

ブラウザで `http://<HOST>:<UI_PORT>` を開き、アプリカードの **Deploy** ボタンをクリックします。

### 2️⃣ APIからデプロイ

```bash
# 🚀 デプロイ
curl -X POST http://<HOST>:8081/api/deploy/myapp

# 📋 一覧
curl http://<HOST>:8081/api/apps

# 📄 ログ
curl http://<HOST>:8081/api/logs/myapp

# 🗑️ 削除
curl -X POST http://<HOST>:8081/api/delete/myapp
```

### 3️⃣ 子コンテナへのアクセス

デプロイ後、Traefik 経由で子コンテナにアクセスできます:

| 用途 | URL | 説明 |
|:----:|:---:|:----:|
| ![FastAPI](https://img.shields.io/badge/-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white) | `http://<HOST>:<TRAEFIK_PORT>/myapp/` | API エンドポイント |
| ![VS Code](https://img.shields.io/badge/-Web_IDE-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white) | `http://<HOST>:<TRAEFIK_PORT>/myapp-ide/` | ブラウザ IDE |

> [!TIP]
> Web IDE のパスワードはコンテナログで確認できます。

### 4️⃣ MCP サーバー連携

MCP SSE サーバーは子コンテナの OpenAPI スキーマを **15秒ごと** にポーリングし、ツールとして自動登録します。

<details>
<summary>📎 Claude Desktop 等の設定例</summary>

```json
{
  "mcpServers": {
    "dind-hub": {
      "url": "http://<HOST>:<MCP_PORT>/sse"
    }
  }
}
```

</details>

---

## ➕ 新しいアプリの追加

`apps/` に新しいディレクトリを作成して Dockerfile と FastAPI アプリを置き、再ビルドします:

```bash
cp -r apps/myapp apps/newapp
# apps/newapp/app.py を編集
docker compose build
docker compose up -d
curl -X POST http://<HOST>:8081/api/deploy/newapp
```

---

## 📁 プロジェクト構成

```
McpHub/
├── 📄 .env                      # IP・ポート設定
├── 🐳 docker-compose.yml        # DinD サービス定義
├── 🐳 Dockerfile.manager        # マルチステージビルド
├── 🔧 entrypoint.sh             # 内部サービス起動スクリプト
├── 🐍 mcp_server.py             # FastMCP 動的ツール登録
├── 📋 requirements.txt          # Python 依存関係
├── 📂 apps/
│   └── 📂 myapp/                # 子コンテナテンプレート
│       ├── 🐳 Dockerfile
│       ├── 🐍 app.py
│       └── 📋 requirements.txt
└── 📂 rust_ui/
    ├── 📦 Cargo.toml
    ├── 🦀 src/main.rs           # Axum バックエンド
    └── 📂 frontend/             # Next.js + shadcn/ui
```

---

## 🔧 トラブルシューティング

<details>
<summary>❌ <code>error getting credentials</code> でビルドが失敗する</summary>

ホスト側の Docker クレデンシャルヘルパーの問題です。

**![Linux](https://img.shields.io/badge/-Linux-FCC624?style=flat-square&logo=linux&logoColor=black) / ![macOS](https://img.shields.io/badge/-macOS-000000?style=flat-square&logo=apple&logoColor=white):**

```bash
mkdir -p ~/.docker
echo '{"credsStore":""}' > ~/.docker/config.json
```

**![Windows](https://img.shields.io/badge/-Windows-0078D6?style=flat-square&logo=windows&logoColor=white) (PowerShell):**

```powershell
[System.IO.File]::WriteAllText("$env:USERPROFILE\.docker\config.json", '{"credsStore":""}')
```

> [!WARNING]
> Windows では `echo` や `>` でファイルを作ると BOM が付いて Docker がパースに失敗します。必ず上記の `WriteAllText` を使ってください。

その後 `docker compose build` を再実行してください。

</details>

---

## 🏗️ 技術スタック

| レイヤー | 技術 | バッジ |
|:--------:|:----:|:------:|
| コンテナ基盤 | Docker-in-Docker | ![Docker](https://img.shields.io/badge/docker:24.0--dind-2496ED?style=flat-square&logo=docker&logoColor=white) |
| リバースプロキシ | Traefik v3.0 | ![Traefik](https://img.shields.io/badge/Traefik_v3.0-24A1C1?style=flat-square&logo=traefikproxy&logoColor=white) |
| バックエンド | Rust / Axum | ![Rust](https://img.shields.io/badge/Rust%2FAxum-DEA584?style=flat-square&logo=rust&logoColor=white) |
| フロントエンド | Next.js / shadcn/ui | ![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=next.js&logoColor=white) |
| MCP サーバー | Python / FastMCP | ![Python](https://img.shields.io/badge/FastMCP-3776AB?style=flat-square&logo=python&logoColor=white) |
| 子コンテナ | Ubuntu / code-server | ![Ubuntu](https://img.shields.io/badge/Ubuntu_22.04-E95420?style=flat-square&logo=ubuntu&logoColor=white) |

---

<div align="center">

**Made with ❤️ by DinD MCP Hub Team**

[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>
