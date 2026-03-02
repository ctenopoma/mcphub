<div align="center">

<img src="rust_ui/frontend/public/mcphub.png" alt="MCP Hub Logo" width="200">

# DinD MCP Hub

**Docker-in-Docker ベースのコンテナオーケストレーション & MCP ツール自動登録プラットフォーム**

子コンテナのデプロイ・管理・Web IDE・認証設定を Web UI から一元管理し、
FastAPI の OpenAPI スキーマから MCP ツールを自動登録します。

[![Docker](https://img.shields.io/badge/Docker-24.0--dind-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Rust](https://img.shields.io/badge/Rust-Axum_0.8-DEA584?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Python](https://img.shields.io/badge/Python-FastMCP-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js_16-shadcn/ui-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Traefik](https://img.shields.io/badge/Traefik-v3.0-24A1C1?style=for-the-badge&logo=traefikproxy&logoColor=white)](https://traefik.io/)

</div>

---

## アーキテクチャ

```
Host
├── :8081  管理 UI (Rust/Axum + Next.js 静的エクスポート)
├── :8085  Traefik リバースプロキシ → 子コンテナ API / IDE / ダッシュボード
└── :8000  MCP SSE サーバー (Python/FastMCP → Claude 連携)

└── mcp-manager コンテナ (docker:24.0-dind, privileged)
    ├── dockerd (内部 Docker デーモン)
    │   └── mcp-net (内部ブリッジネットワーク)
    │       ├── traefik:v3.0 (Docker + File プロバイダー)
    │       └── <app> (子コンテナ)
    │           ├── uvicorn / FastAPI  :80   → REST API
    │           └── code-server        :8000 → Web IDE
    ├── manager-ui  (Rust/Axum バイナリ :8081)
    └── mcp_server.py (FastMCP SSE :8000)
```

---

## クイックスタート

### 前提条件

- Docker (v28 推奨。v29 は WSL2 環境でポートフォワーディングの問題あり)
- Docker Compose v2+

### 設定

`.env` ファイルでポート・パスワードを設定します:

```env
BIND_HOST=0.0.0.0          # バインドアドレス (127.0.0.1 = ローカルのみ)
TRAEFIK_PORT=8085           # Traefik リバースプロキシポート
UI_PORT=8081                # 管理 UI ポート
MCP_PORT=8000               # MCP SSE サーバーポート
MANAGER_PASSWORD=mcp-hub-password  # 管理画面のログインパスワード
```

### 起動

```bash
docker compose up -d --build
```

> **Note:** 初回ビルドには数分かかります (Rust コンパイル + npm ビルド + Traefik イメージ取得)。

### 停止

```bash
docker compose down
```

---

## 使い方

### 1. 管理 UI にログイン

ブラウザで `http://<HOST>:8081` を開き、`MANAGER_PASSWORD` でログインします。

### 2. アプリの作成・デプロイ

1. **New App** ボタン → アプリ名を入力 → **Create**
   - `apps/<name>/` に Dockerfile、app.py、requirements.txt がスキャフォールドされます
2. アプリカードの **Deploy** ボタンをクリック
   - Docker イメージをビルドし、Traefik ラベル付きでコンテナを起動します

### 3. アプリへのアクセス (Traefik 経由)

デプロイ後、Traefik 経由で以下の URL にアクセスできます:

| URL パターン | 説明 |
|:---|:---|
| `http://<HOST>:8085/<app>/` | FastAPI REST API (ForwardAuth による認証あり) |
| `http://<HOST>:8085/<app>-ide/` | Web IDE (code-server、独自パスワード認証) |
| `http://<HOST>:8085/<app>-dashboard/` | アプリダッシュボード (IDE / Rebuild / App リンク) |

### 4. アプリダッシュボード

管理 UI のカードから **Open Dashboard** をクリックすると、アプリ専用のダッシュボードが開きます。

- **パスワード認証**: code-server のパスワードでログイン (管理画面の Password ボタンで確認可能)
- **Open Web IDE**: ブラウザ上の VS Code (code-server) を起動
- **Rebuild**: アプリの Docker イメージを再ビルドし、ログをターミナルにリアルタイム表示
- **Open App**: FastAPI の API エンドポイントを開く

### 5. MCP サーバー連携

MCP SSE サーバーは子コンテナの OpenAPI スキーマを **15 秒ごと** にポーリングし、ツールとして自動登録します。
コンテナの内部 IP に直接アクセスするため、ForwardAuth は適用されません。

<details>
<summary>Claude Desktop / Claude Code の設定例</summary>

```json
{
  "mcpServers": {
    "dind-hub": {
      "url": "http://<HOST>:8000/sse"
    }
  }
}
```

</details>

### 6. 認証設定 (Per-App)

管理 UI の各アプリカードにある **Auth** ボタンから、API エンドポイントの認証方式を切り替えられます。
再デプロイ不要で、ライブで切り替わります。

| 認証方式 | 説明 |
|:---|:---|
| **None** | 認証なし (`X-Forwarded-User: anonymous` が付与される) |
| **API Key** | `X-API-Key` ヘッダーで認証 (ランダムキー生成機能付き) |
| **Entra ID** | Microsoft Entra ID (旧 Azure AD) の RS256 JWT Bearer トークンで認証 |

---

## 管理 API

管理 UI と同じエンドポイントを API から直接利用できます (要 Cookie 認証):

```bash
# アプリ一覧
curl http://<HOST>:8081/api/apps

# アプリ作成
curl -X POST http://<HOST>:8081/api/create/newapp

# デプロイ
curl -X POST http://<HOST>:8081/api/deploy/newapp

# ログ取得
curl http://<HOST>:8081/api/logs/newapp

# 停止
curl -X POST http://<HOST>:8081/api/stop/newapp

# 削除
curl -X POST http://<HOST>:8081/api/delete/newapp
```

---

## プロジェクト構成

```
McpHub/
├── .env                        ポート・パスワード設定
├── docker-compose.yml          DinD サービス定義
├── Dockerfile.manager          マルチステージビルド (Node → Rust → DinD)
├── entrypoint.sh               dockerd / Traefik / manager-ui / MCP 起動
├── mcp_server.py               FastMCP 動的ツール登録 (SSE)
├── requirements.txt            Python 依存関係
├── apps/
│   └── myapp/                  子コンテナテンプレート
│       ├── Dockerfile          Ubuntu 22.04 + code-server + Python
│       ├── app.py              FastAPI サンプル
│       └── requirements.txt
├── rust_ui/
│   ├── Cargo.toml
│   ├── src/main.rs             Axum バックエンド (認証・デプロイ・SSE)
│   └── frontend/               Next.js 16 + shadcn/ui + Tailwind CSS 4
│       ├── package.json
│       └── src/app/page.tsx    管理画面メイン
└── docs/
    └── spec.md                 仕様書
```

---

## 起動シーケンス

`entrypoint.sh` は以下の順序で内部サービスを起動します:

1. `iptables -P FORWARD ACCEPT` — DinD ネットワーク転送を許可
2. `/etc/docker/daemon.json` を生成 (DNS: 8.8.8.8, MTU: 1400, overlay2)
3. `dockerd` をバックグラウンドで起動、最大 30 秒待機
4. `docker network create mcp-net` — 内部ネットワークを作成
5. Traefik 動的設定 (`dynamic.yml`) を生成 — ダッシュボード・API プロキシルート
6. Traefik コンテナを `mcp-net` 上で起動 (Docker Provider + File Provider)
7. Rust `manager-ui` をバックグラウンドで起動 (`:8081`)
8. Python `mcp_server.py` をフォアグラウンドで起動 (`:8000`)

---

## 技術スタック

| レイヤー | 技術 |
|:---|:---|
| コンテナ基盤 | Docker-in-Docker (`docker:24.0-dind`) |
| リバースプロキシ | Traefik v3.0 (Docker Provider + File Provider) |
| バックエンド | Rust / Axum 0.8 (Cookie セッション認証) |
| フロントエンド | Next.js 16 / React 19 / shadcn/ui / Tailwind CSS 4 (静的エクスポート) |
| MCP サーバー | Python / FastMCP (SSE) |
| 子コンテナ | Ubuntu 22.04 / code-server / uvicorn |
| 認証 | パスワード / API Key / Microsoft Entra ID (JWT RS256) |

---

## トラブルシューティング

<details>
<summary><code>error getting credentials</code> でビルドが失敗する</summary>

ホスト側の Docker クレデンシャルヘルパーの問題です。

**Linux / macOS:**

```bash
mkdir -p ~/.docker
echo '{"credsStore":""}' > ~/.docker/config.json
```

**Windows (PowerShell):**

```powershell
[System.IO.File]::WriteAllText("$env:USERPROFILE\.docker\config.json", '{"credsStore":""}')
```

> Windows では `echo` や `>` でファイルを作ると BOM が付いて Docker がパースに失敗します。必ず上記の `WriteAllText` を使ってください。

</details>

<details>
<summary><code>parent snapshot does not exist</code> でビルドが失敗する</summary>

Docker のビルドキャッシュが壊れています。以下でクリーンアップしてください:

```bash
docker builder prune -f
docker compose build
```

</details>

<details>
<summary>Docker v29 でポートに接続できない (Connection reset by peer)</summary>

Docker v29 の `docker-proxy -use-listen-fd` が WSL2 環境で正しく動作しない場合があります。
Docker v28 へのダウングレードを推奨します。

</details>

---

<div align="center">

**Made with Rust, Python, and Docker by DinD MCP Hub Team**

</div>
