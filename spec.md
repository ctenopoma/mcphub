# プロジェクト仕様書: DinD MCP & Web IDE Manager (完全版)

## 1. プロジェクト概要
Docker in Docker (DinD) 環境内で、ホストコンテナがトラフィックルーティング(Traefik)と複数の子コンテナの管理を一元的に行うシステムを構築する。
子コンテナは「純粋なREST API(FastAPI)」と「セキュアなWebブラウザベースのIDE(code-server)」を同時に提供する。
ホストコンテナは、子コンテナの `openapi.json` を動的に解析し、FastMCPを用いてLLM向けのMCPツールとして自動登録・公開する。

## 2. 技術スタック
* **インフラ:** Docker in Docker (Alpineベース), Traefik v3
* **バックエンド (管理用UI API):** Rust (Axum)
* **フロントエンド (管理用UI):** Next.js (App Router), Tailwind CSS, shadcn/ui, Lucide React
  * ※Rustで配信するため `output: 'export'` を使用した静的エクスポート構成とする。
* **MCPサーバー & オーケストレーション:** Python 3.11 (FastMCP, docker-py, httpx)
* **子コンテナ (アプリ群):** Python 3.11 (FastAPI, uvicorn), code-server (Web IDE)

## 3. ディレクトリ構成
```text
mcp-dind-project/
├── docker-compose.yml
├── Dockerfile.manager
├── entrypoint.sh
├── requirements.txt
├── mcp_server.py
├── rust_ui/
│   ├── Cargo.toml
│   ├── src/main.rs
│   └── frontend/
│       ├── package.json
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── components/
│       └── app/
└── apps/
    └── myapp/
        ├── Dockerfile
        ├── requirements.txt
        └── app.py

```

## 4. コンポーネント詳細要件

### 4.1. インフラ層 (`docker-compose.yml`, `entrypoint.sh`)

* `mcp-manager` コンテナを `privileged: true` で起動。
* 公開ポート: `8080`(Traefik用), `8000`(MCP SSE用), `8081`(Rust UI用)。
* `entrypoint.sh` にて以下を順次バックグラウンド起動すること:
1. Dockerデーモン (`dockerd-entrypoint.sh`)
2. 内部ネットワーク `mcp-net` の作成
3. Traefik (ポート80番をホストの8080へバインド、ネットワークは `mcp-net`)
4. Rust管理UIバイナリ (`/manager/manager-ui` : ポート8081)
5. Python MCPサーバー (`mcp_server.py` : ポート8000) - フォアグラウンド



### 4.2. Rust 管理バックエンド (`rust_ui/src/main.rs`)

* `axum` を使用し、ポート8081でリッスンする。
* `/api/apps` (GET): `/apps` ディレクトリを走査し、`docker ps` でステータスを取得して返す。
* `/api/deploy/:app_name` (POST): 対象コンテナをビルドし、Traefikラベルを付与して起動する。
* API用: `rule=PathPrefix(/{name})`, `middlewares={name}-strip`, `port=80`
* IDE用: `rule=PathPrefix(/{name}-ide)`, パス削除なし, `port=8000`


* `/api/logs/:app_name` (GET): `docker logs` を取得して返す。
* `/api/delete/:app_name` (POST): `docker rm -f` でコンテナを削除する。
* 静的ファイル配信: `/manager/frontend/out` ディレクトリ内のNext.jsビルド成果物を配信(フォールバック設定含む)。

### 4.3. Next.js フロントエンド (`rust_ui/frontend/`)

* Next.js + Tailwind CSS + shadcn/ui で構築。
* `next.config.ts` に `output: 'export'` を設定。
* UI要件:
* ダークモード対応のSaaS風モダンデザイン。Card, Button, Badge, ScrollArea 等のshadcn/uiコンポーネントを使用。
* コンテナの一覧表示、デプロイ、削除、ログ表示UI。
* コンテナごとに「Web IDEを開く」ボタンを配置し、別タブで `http://localhost:8080/{app_name}-ide/` を開く。



### 4.4. マルチステージ Dockerfile (`Dockerfile.manager`)

* Stage 1 (frontend-builder): Node.js (Alpine) で Next.jsをビルド (`npm run build`)
* Stage 2 (rust-builder): Rust (Alpine + musl-dev) で バックエンドをビルド (`cargo build --release`)
* Stage 3 (runner): Docker DinDイメージをベースに、Python環境を構築。Stage 2のRustバイナリと、Stage 1の `out/` ディレクトリをコピー。

### 4.5. 動的MCPサーバー (`mcp_server.py`)

* `mcp` (FastMCP) と `httpx` を使用。SSEモード(port 8000)で起動。
* **動的ツール登録ロジックの実装:**
* 定期的に(またはリクエスト時に) `docker-py` で起動中の子コンテナ一覧を取得。
* 各コンテナの `http://{app_name}:80/openapi.json` にアクセス。
* 取得したOpenAPIスキーマの `paths` を解析し、各エンドポイント（GET/POST等）を個別のMCPツールとして動的に生成・登録する。
* ツールの名前空間が衝突しないよう、ツール名は `{app_name}_{operationId}` のような命名規則にする。



### 4.6. 子コンテナテンプレート (`apps/myapp/`)

* `Dockerfile` 内で `code-server` と `python-multipart` をインストール。
* セキュリティ担保のため、環境変数 `PASSWORD` (例: `mcp-ide-pass`) を設定する。
* 起動コマンド (`CMD`) で以下2つを並行稼働:
1. `code-server --bind-addr 0.0.0.0:8000 /app` (※認証あり)
2. `uvicorn app:app --host 0.0.0.0 --port 80 --reload`


* `app.py` は純粋なFastAPIアプリとして実装し、以下の2つのエンドポイントを標準搭載する:
1. 動作確認用の `/` (GET)
2. ファイルアップロード用の `/upload` (POST) : 受け取ったファイルを `uploads/` ディレクトリに保存する。



## 5. エージェントへの実装指示 (Step-by-Step)

循環論理や文脈の喪失を防ぐため、以下の順序で実装・コミットを行ってください。

1. **フロントエンドの実装:** `rust_ui/frontend` ディレクトリを作成し、Next.jsをセットアップ。shadcn/uiを導入してモダンなUIを構築する。
2. **バックエンドの実装:** `rust_ui` にCargoプロジェクトを作成し、AxumによるAPIと静的ファイル配信を実装する。
3. **子コンテナ環境の作成:** `apps/myapp` のDockerfile(認証付きcode-server)とサンプルAPI(GETとファイルアップロードPOST)を作成する。
4. **統合環境の構築:** `Dockerfile.manager`, `docker-compose.yml`, `entrypoint.sh` を作成する。
5. **動的MCPサーバーの実装:** `mcp_server.py` を作成し、OpenAPIスキーマを解析してFastMCPツールを動的生成する高度なロジックを実装する。

## 6. ユースケース (Given-When-Then)

システムが満たすべき主要なシナリオと受入条件を定義する。実装時はこれらのシナリオを満たしているか都度テストすること。

### 6.1. ダッシュボードの表示と状態確認

* **Given (前提):** ホストコンテナが正常に稼働しており、`apps/` ディレクトリに `myapp` が存在する。
* **When (操作):** ユーザーがブラウザで管理画面 (`http://localhost:8081`) にアクセスする。
* **Then (結果):** Next.jsで構築されたモダンなUIが表示され、アプリ一覧にステータスとともに `myapp` が表示される。

### 6.2. アプリのデプロイ（ビルドと起動）

* **Given (前提):** `myapp` が未起動状態である。
* **When (操作):** ユーザーがUI上で「デプロイ/再起動」ボタンをクリックする。
* **Then (結果):** コンテナが起動し、UI上のステータスが「Up」に変わる。Traefikによって `http://localhost:8080/myapp/` と `http://localhost:8080/myapp-ide/` へのルーティングが開通する。

### 6.3. セキュアなWeb IDEでの開発とホットリロード

* **Given (前提):** `myapp` が稼働中である。
* **When (操作):** ユーザーが「Web IDE」ボタンをクリックしてエディタを開き、ログイン画面でパスワードを入力する。その後、ブラウザ上で `app.py` を編集して保存する。
* **Then (結果):** 認証を通過したユーザーのみがIDEにアクセスできる。保存した瞬間に `uvicorn --reload` が変更を検知し、APIが自動再起動して最新のロジックが即座に適用される。

### 6.4. 動的MCPツールの登録とLLMからの実行

* **Given (前提):** `myapp` が稼働しており、FastAPIによって `/upload` (POST) などのエンドポイントが定義されている。
* **When (操作):** LLMクライアントがMCPサーバー(ポート8000)に接続し、ツール一覧を要求する。
* **Then (結果):** `mcp_server.py` がOpenAPIを動的解析し、LLMに対して `myapp_upload_file` といった個別のMCPツールとして自動登録・提示される。LLMはこれを呼び出して子コンテナにファイルを送り込むことができる。

### 6.5. コンテナログの確認とアプリの削除

* **Given (前提):** `myapp` が稼働中である。
* **When (操作):** ユーザーがUI上で「ログ」ボタン、または「削除」ボタンをクリックする。
* **Then (結果):** ログボタン押下時はTerminalコンポーネントに最新ログが表示され、削除ボタン押下時はコンテナが安全に破棄されてステータスが未起動に戻る。
