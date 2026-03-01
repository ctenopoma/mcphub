# MCP HUB アプリコンテナ開発ガイド

## 目次

1. [システム全体像](#1-システム全体像)
2. [アプリコンテナの構成](#2-アプリコンテナの構成)
3. [FastAPI によるアプリ開発](#3-fastapi-によるアプリ開発)
4. [MCP（API）の仕組みと使い方](#4-mcpapiの仕組みと使い方)
5. [開発ワークフロー](#5-開発ワークフロー)
6. [API 認証（ForwardAuth）](#6-api-認証forwardauth)
7. [実践例：独自 API の追加](#7-実践例独自-api-の追加)
8. [トラブルシューティング](#8-トラブルシューティング)

---

## 1. システム全体像

MCP HUB は Docker-in-Docker (DinD) アーキテクチャにより、ホストマシン上でコンテナ管理コンテナを動かし、その中で子コンテナ（アプリ）を動的にデプロイ・管理するシステムです。

```
ホストマシン
│
├── :8081  管理画面 (Rust/Axum + Next.js)
├── :8085  Traefik リバースプロキシ（子コンテナの API / IDE へのルーティング）
└── :8000  MCP サーバー (SSE)（LLM 連携用）
│
└── mcp-manager コンテナ (privileged)
    ├── dockerd (内部 Docker デーモン)
    │   └── mcp-net ネットワーク
    │       ├── traefik (リバースプロキシ, 内部 :80)
    │       └── myapp  (子コンテナ)
    │           ├── FastAPI  :80  ← API エンドポイント
    │           └── code-server :8000 ← Web IDE
    │
    ├── manager-ui  :8081 (管理画面バックエンド)
    └── mcp_server.py :8000 (MCP SSE サーバー)
```

### ポート一覧（.env で変更可能）

| ポート | サービス | 用途 |
|--------|----------|------|
| `8081` | 管理画面 | ブラウザからアプリのデプロイ・停止・削除を操作 |
| `8085` | Traefik | 子コンテナの API や Web IDE にアクセス |
| `8000` | MCP サーバー | Claude 等の LLM クライアントからツール呼び出し |

### URL のルーティング規則

子コンテナ名が `myapp` の場合：

| URL | 転送先 | 説明 |
|-----|--------|------|
| `http://<host>:8085/myapp/` | コンテナ内 `:80` | FastAPI REST API |
| `http://<host>:8085/myapp-ide/` | コンテナ内 `:8000` | Web IDE (code-server) |

Traefik がパスプレフィックス（`/myapp`）を自動的に除去してからコンテナに転送するため、**アプリ側ではプレフィックスを意識する必要はありません**。

---

## 2. アプリコンテナの構成

### ファイル構成

管理画面の「New App」ボタンでアプリを作成すると、以下のテンプレートが `/apps/<アプリ名>/` に生成されます。

```
/apps/myapp/
├── Dockerfile          # コンテナビルド定義
├── app.py              # FastAPI アプリケーション本体
└── requirements.txt    # Python パッケージ一覧
```

### Dockerfile

```dockerfile
FROM python:3.11-slim

# code-server（Web IDE）をインストール
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://code-server.dev/install.sh | sh

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

# FastAPI (:80) と code-server (:8000) を同時起動
CMD code-server --bind-addr 0.0.0.0:8000 /app & uvicorn app:app --host 0.0.0.0 --port 80 --reload
```

**ポイント:**
- **FastAPI は必ず `:80` で起動する** — Traefik がこのポートにルーティングします
- **code-server は `:8000`** — Web IDE 用のポートです
- `--reload` オプションにより、コードを変更すると自動的にサーバーが再起動します
- `/app` ディレクトリはホストの `./apps/<アプリ名>/` にマウントされているため、**コンテナを再起動してもコードは保持されます**

### requirements.txt

```
fastapi
uvicorn
python-multipart
```

必要に応じてパッケージを追加してください。追加後は管理画面から「Restart」ボタンでコンテナを再ビルド＆再起動します。

---

## 3. FastAPI によるアプリ開発

### 3.1 基本的な API エンドポイント

```python
from fastapi import FastAPI

app = FastAPI(
    title="My App API",
    description="サンプル API"
)

@app.get("/")
def read_root():
    return {"message": "Hello World"}
```

**重要:** FastAPI のインスタンス変数名は **必ず `app`** にしてください。Dockerfile の `uvicorn app:app` がこの変数名を参照しています。

### 3.2 GET エンドポイント

```python
@app.get("/items")
def list_items():
    return {"items": ["item1", "item2", "item3"]}

@app.get("/items/{item_id}")
def get_item(item_id: int):
    return {"item_id": item_id, "name": f"Item {item_id}"}
```

**アクセス方法:**
```bash
# ブラウザまたは curl からアクセス
curl http://<host>:8085/myapp/items
curl http://<host>:8085/myapp/items/42
```

### 3.3 POST エンドポイント（JSON）

```python
from pydantic import BaseModel

class Item(BaseModel):
    name: str
    price: float
    description: str = ""

@app.post("/items")
def create_item(item: Item):
    # item.name, item.price, item.description でアクセス
    return {"status": "created", "item": item.model_dump()}
```

**アクセス方法:**
```bash
curl -X POST http://<host>:8085/myapp/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Widget", "price": 9.99}'
```

### 3.4 ファイルアップロード

```python
from fastapi import UploadFile, File
import shutil
import os

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    os.makedirs("uploads", exist_ok=True)
    file_path = f"uploads/{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"status": "success", "filename": file.filename}
```

**アクセス方法:**
```bash
curl -X POST http://<host>:8085/myapp/upload \
  -F "file=@./sample.txt"
```

### 3.5 クエリパラメータ

```python
@app.get("/search")
def search(q: str, limit: int = 10):
    return {"query": q, "limit": limit, "results": []}
```

**アクセス方法:**
```bash
curl "http://<host>:8085/myapp/search?q=hello&limit=5"
```

### 3.6 データの永続化（ファイルベース）

コンテナの `/app` ディレクトリはホストにマウントされているため、`/app` 配下にファイルを保存すればコンテナ再起動後も残ります。

```python
import json

DATA_FILE = "data.json"

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            return json.load(f)
    return []

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.get("/todos")
def list_todos():
    return load_data()

@app.post("/todos")
def add_todo(item: dict):
    data = load_data()
    data.append(item)
    save_data(data)
    return {"status": "added", "total": len(data)}
```

### 3.7 OpenAPI ドキュメントの確認

FastAPI は自動的に OpenAPI スキーマを生成します。これは MCP サーバーがツールを自動検出するためにも使われます。

| URL | 内容 |
|-----|------|
| `http://<host>:8085/myapp/docs` | Swagger UI（インタラクティブ API ドキュメント） |
| `http://<host>:8085/myapp/redoc` | ReDoc ドキュメント |
| `http://<host>:8085/myapp/openapi.json` | OpenAPI JSON スキーマ |

---

## 4. MCP（API）の仕組みと使い方

### 4.1 MCP とは

MCP (Model Context Protocol) は、LLM（Claude 等）が外部ツールを呼び出すためのプロトコルです。MCP HUB では、子コンテナの FastAPI エンドポイントが**自動的に MCP ツールとして登録**されます。

### 4.2 自動ツール検出の仕組み

```
1. 子コンテナが起動（FastAPI が :80 で稼働）
      ↓
2. MCP サーバーが 15 秒ごとにポーリング
      ↓
3. コンテナに直接アクセスして /openapi.json を取得
   GET http://<コンテナIP>:80/openapi.json
   ※ Traefik を経由しないため ForwardAuth の影響を受けない
      ↓
4. OpenAPI スキーマからエンドポイントを解析
      ↓
5. 各エンドポイントを MCP ツールとして動的登録
   ツール名: <アプリ名>_<operationId>
```

### 4.3 ツール名の命名規則

FastAPI のエンドポイントは以下のルールで MCP ツール名に変換されます:

```python
# FastAPI のエンドポイント定義
@app.get("/")
def read_root():          # ← operationId = "read_root"
    ...

@app.post("/upload")
async def upload_file():  # ← operationId = "upload_file"
    ...
```

アプリ名が `myapp` の場合:

| FastAPI 関数名 | MCP ツール名 |
|----------------|-------------|
| `read_root` | `myapp_read_root` |
| `upload_file` | `myapp_upload_file` |
| `list_items` | `myapp_list_items` |
| `create_item` | `myapp_create_item` |

**重要:** 関数名がそのまま `operationId` になり、MCP ツール名の一部になります。わかりやすい関数名を付けてください。

### 4.4 MCP サーバーへの接続

MCP サーバーは SSE (Server-Sent Events) で `http://<host>:8000/sse` にて稼働しています。

#### Claude Desktop からの接続

Claude Desktop の設定ファイル（`claude_desktop_config.json`）に以下を追加します:

```json
{
  "mcpServers": {
    "mcp-hub": {
      "url": "http://<host>:8000/sse"
    }
  }
}
```

設定ファイルの場所:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop を再起動すると、子コンテナの API が Claude のツールとして表示されます。

#### Claude Code (CLI) からの接続

```bash
claude mcp add mcp-hub --transport sse http://<host>:8000/sse
```

### 4.5 Python クライアントからの接続

```python
import asyncio
from mcp import ClientSession
from mcp.client.sse import sse_client

async def main():
    # MCP サーバーに SSE で接続
    async with sse_client("http://<host>:8000/sse") as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            # セッション初期化
            await session.initialize()

            # 登録されているツール一覧を表示
            tools = await session.list_tools()
            print("利用可能なツール:")
            for tool in tools.tools:
                print(f"  - {tool.name}: {tool.description}")

            # ツールを呼び出す例（GET リクエスト）
            result = await session.call_tool("myapp_read_root", arguments={})
            print(f"結果: {result}")

            # ツールを呼び出す例（POST リクエスト・JSON）
            result = await session.call_tool("myapp_create_item", arguments={
                "payload": {
                    "name": "テストアイテム",
                    "price": 1500
                }
            })
            print(f"結果: {result}")

            # ファイルアップロードの例
            result = await session.call_tool("myapp_upload_file", arguments={
                "payload": {
                    "file_path": "/path/to/file.txt"
                }
            })
            print(f"結果: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

**必要パッケージ:**
```bash
pip install mcp httpx
```

### 4.6 MCP ツールのメソッド別動作

MCP サーバーは HTTP メソッドに応じて異なる方法でリクエストを送信します:

| HTTP メソッド | payload の扱い | 説明 |
|--------------|----------------|------|
| `GET` | クエリパラメータ | `?key=value` として送信 |
| `POST` | JSON ボディ | `Content-Type: application/json` で送信 |
| `POST`（ファイル） | `file_path` | パスに `upload` や `file` を含む場合、ファイルアップロードとして送信 |
| `PUT` | JSON ボディ | `Content-Type: application/json` で送信 |
| `DELETE` | クエリパラメータ | `?key=value` として送信 |

### 4.7 組み込みツール

子コンテナの API ツールに加えて、以下のツールが常に利用可能です:

| ツール名 | 説明 |
|----------|------|
| `list_registered_tools` | 現在登録されている全 MCP ツールの一覧を返す |

### 4.8 Claude での利用例

Claude Desktop または Claude Code に MCP サーバーを接続した状態で、自然言語で操作できます:

```
ユーザー: 「myapp にファイルをアップロードして」
Claude:   myapp_upload_file ツールを使ってファイルをアップロードします。

ユーザー: 「myapp の全アイテムを見せて」
Claude:   myapp_list_items ツールを呼び出します。

ユーザー: 「myapp に新しいアイテムを追加して。名前は"ウィジェット"、価格は 500 円」
Claude:   myapp_create_item ツールを使って追加します。
```

---

## 5. 開発ワークフロー

### 5.1 新規アプリの作成からデプロイまで

```
1. 管理画面 (http://<host>:8081) にログイン
      ↓
2. 「New App」ボタンをクリック
      ↓
3. アプリ名を入力して「Create」
   → /apps/<アプリ名>/ にテンプレートが生成される
      ↓
4. アプリカードの「Deploy」ボタンをクリック
   → Docker イメージのビルド＆コンテナ起動
      ↓
5. 「Open Web IDE」ボタンで code-server を開く
   → ブラウザ上で app.py を直接編集可能
      ↓
6. コードを編集して保存
   → uvicorn の --reload により自動反映
      ↓
7. 約 15 秒後、MCP サーバーが新しいエンドポイントを検出
   → Claude から利用可能に
```

### 5.2 コード編集の方法

#### 方法 1: Web IDE (code-server)

管理画面の「Open Web IDE」ボタンから、ブラウザ上で VS Code ライクなエディタが起動します。
- URL: `http://<host>:8085/<アプリ名>-ide/`
- パスワード: 管理画面の「Password」ボタンで確認

#### 方法 2: ホストマシンから直接編集

`./apps/<アプリ名>/` がホストにマウントされているため、ホスト側の好きなエディタで編集できます。

```bash
# ホストマシンで
vim ./apps/myapp/app.py
# ↑ 保存すると uvicorn が自動リロード
```

### 5.3 パッケージの追加

1. `requirements.txt` にパッケージ名を追加
2. 管理画面から「Restart」ボタンでコンテナを再ビルド

```
# requirements.txt の例
fastapi
uvicorn
python-multipart
requests          # ← 追加
beautifulsoup4    # ← 追加
```

**注意:** `--reload` はコードの変更を反映しますが、新しい pip パッケージのインストールにはコンテナの再ビルド（Restart）が必要です。

### 5.4 API のテスト

#### curl で直接テスト

```bash
# GET
curl http://<host>:8085/myapp/

# POST (JSON)
curl -X POST http://<host>:8085/myapp/items \
  -H "Content-Type: application/json" \
  -d '{"name": "test", "price": 100}'

# ファイルアップロード
curl -X POST http://<host>:8085/myapp/upload -F "file=@test.txt"
```

#### Swagger UI でテスト

`http://<host>:8085/myapp/docs` にアクセスすると、インタラクティブな API ドキュメントで各エンドポイントを直接テストできます。

#### MCP 経由でテスト

```bash
python test_client.py
```

---

## 6. API 認証（ForwardAuth）

MCP HUB では、アプリの API エンドポイントに対してインフラ層（Traefik + Rust バックエンド）で一元的にアクセス制御を行えます。アプリ側（FastAPI）に認証ロジックを実装する必要はありません。

### 6.1 認証方式

管理画面の各アプリカードにある「Auth」ボタンから、以下の 3 種類の認証方式を選択できます。

| 方式 | 説明 | ユースケース |
|------|------|-------------|
| **認証なし (None)** | デフォルト。誰でもアクセス可能 | 開発中、内部専用 API |
| **API Key** | 静的キーによる認証。リクエストに `X-API-Key` ヘッダーが必要 | 外部サービス連携、シンプルなアクセス制御 |
| **Microsoft Entra ID** | JWT トークンによる認証。Azure AD で発行されたトークンを検証 | 企業環境、SSO 連携 |

### 6.2 認証の仕組み（ForwardAuth パターン）

```
クライアント → Traefik → ForwardAuth (Rust /api/verify) → 認証 OK → 子コンテナ
                                                          → 認証 NG → 401 Unauthorized
```

1. クライアントが `http://<host>:8085/myapp/endpoint` にリクエスト
2. Traefik が Rust サーバーの `/api/verify` に事前問い合わせ（ForwardAuth）
3. Rust サーバーが `/apps/auth_config.json` から該当アプリの認証設定を参照
4. 認証方式に応じてヘッダーを検証
5. 認証成功 → `X-Forwarded-User` ヘッダー付きで子コンテナにリクエスト転送
6. 認証失敗 → `401 Unauthorized` を返す（子コンテナには到達しない）

**注意:**
- **IDE（code-server）には ForwardAuth は適用されません。** IDE は独自のパスワード認証を使用します。
- **MCP サーバーは Traefik を経由せずコンテナに直接アクセスするため、認証の影響を受けません。**

### 6.3 API Key 認証の設定と使用

#### 設定手順

1. 管理画面でアプリカードの「Auth」ボタンをクリック
2. 認証方式を「API Key」に変更
3. API キーを入力（またはシャッフルアイコンでランダム生成）
4. 「Save」で保存 → **設定は即座に反映されます**

#### API キーを使ったアクセス

```bash
# API キーなし → 401 Unauthorized（レスポンスボディなし）
curl http://<host>:8085/myapp/

# API キーあり → 正常レスポンス
curl -H "X-API-Key: your-secret-key-here" http://<host>:8085/myapp/
# {"message": "Hello from MyApp!"}

# POST リクエスト + API キー
curl -X POST http://<host>:8085/myapp/items \
  -H "X-API-Key: your-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{"name": "Widget", "price": 9.99}'

# ファイルアップロード + API キー
curl -X POST http://<host>:8085/myapp/upload \
  -H "X-API-Key: your-secret-key-here" \
  -F "file=@test.txt"
```

### 6.4 Entra ID (JWT) 認証の設定と使用

#### 設定手順

1. Azure Portal で App Registration を作成し、Tenant ID と Client ID（Application ID）を取得
2. 管理画面でアプリカードの「Auth」ボタンをクリック
3. 認証方式を「Microsoft Entra ID (JWT)」に変更
4. Tenant ID と Client ID を入力
5. 「Save」で保存

#### JWT トークンを使ったアクセス

```bash
# Azure AD からアクセストークンを取得（例: Client Credentials フロー）
TOKEN=$(curl -s -X POST \
  "https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token" \
  -d "client_id=<client-id>&scope=<client-id>/.default&client_secret=<secret>&grant_type=client_credentials" \
  | jq -r '.access_token')

# Bearer トークン付きでアクセス
curl -H "Authorization: Bearer $TOKEN" http://<host>:8085/myapp/
```

### 6.5 アプリ側での認証ユーザー情報の取得

認証を通過したリクエストには、Rust サーバーが `X-Forwarded-User` ヘッダーを付与します。アプリ側でこのヘッダーを参照することで、認証済みユーザーの情報を取得できます。

```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.get("/whoami")
def whoami(request: Request):
    """認証済みユーザーの情報を返す"""
    user = request.headers.get("X-Forwarded-User", "anonymous")
    return {"user": user}
```

| 認証方式 | `X-Forwarded-User` の値 |
|----------|------------------------|
| 認証なし | `anonymous` |
| API Key | `api-key-user` |
| Entra ID | JWT の `preferred_username` / `upn` / `sub` |

### 6.6 認証設定の管理 API

プログラムから認証設定を操作することもできます（管理画面の Cookie 認証が必要）。

```bash
# 認証設定の取得
curl -b cookies.txt http://<host>:8081/api/apps/myapp/auth

# API Key を設定
curl -b cookies.txt -X POST http://<host>:8081/api/apps/myapp/auth \
  -H "Content-Type: application/json" \
  -d '{"auth_type": "api_key", "api_key": "my-secret-key"}'

# 認証を無効化
curl -b cookies.txt -X POST http://<host>:8081/api/apps/myapp/auth \
  -H "Content-Type: application/json" \
  -d '{"auth_type": "none"}'
```

---

## 7. 実践例：独自 API の追加

### 例 1: メモ帳 API

```python
from fastapi import FastAPI
from pydantic import BaseModel
import json
import os
from datetime import datetime

app = FastAPI(title="Notes API", description="シンプルなメモ帳 API")

NOTES_FILE = "notes.json"

class Note(BaseModel):
    title: str
    content: str

def load_notes():
    if os.path.exists(NOTES_FILE):
        with open(NOTES_FILE) as f:
            return json.load(f)
    return []

def save_notes(notes):
    with open(NOTES_FILE, "w") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)

@app.get("/notes")
def list_notes():
    """全てのメモを取得する"""
    return load_notes()

@app.post("/notes")
def create_note(note: Note):
    """新しいメモを作成する"""
    notes = load_notes()
    new_note = {
        "id": len(notes) + 1,
        "title": note.title,
        "content": note.content,
        "created_at": datetime.now().isoformat()
    }
    notes.append(new_note)
    save_notes(notes)
    return new_note

@app.delete("/notes/{note_id}")
def delete_note(note_id: int):
    """指定したメモを削除する"""
    notes = load_notes()
    notes = [n for n in notes if n["id"] != note_id]
    save_notes(notes)
    return {"status": "deleted"}
```

**MCP での自動登録結果:**

| MCP ツール名 | 説明 |
|-------------|------|
| `myapp_list_notes` | 全てのメモを取得する |
| `myapp_create_note` | 新しいメモを作成する |
| `myapp_delete_note` | 指定したメモを削除する |

**Claude での使い方:**
```
「myapp に"買い物リスト"というタイトルで"牛乳、卵、パン"というメモを追加して」
→ Claude が myapp_create_note を呼び出す
```

### 例 2: Web スクレイピング API

```python
from fastapi import FastAPI
import requests
from bs4 import BeautifulSoup

app = FastAPI(title="Scraper API", description="Web ページの情報を取得する API")

@app.get("/scrape")
def scrape_page(url: str):
    """指定した URL のページタイトルと本文を取得する"""
    response = requests.get(url, timeout=10)
    soup = BeautifulSoup(response.text, "html.parser")
    title = soup.title.string if soup.title else "No title"
    # 本文テキストを取得（最初の 1000 文字）
    body = soup.get_text(strip=True)[:1000]
    return {"title": title, "body": body}
```

**requirements.txt に追加:**
```
fastapi
uvicorn
python-multipart
requests
beautifulsoup4
```

**Claude での使い方:**
```
「myapp で https://example.com の内容を取得して」
→ Claude が myapp_scrape_page(payload={"url": "https://example.com"}) を呼び出す
```

### 例 3: データ分析 API

```python
from fastapi import FastAPI, UploadFile, File
import csv
import io

app = FastAPI(title="Data Analysis API", description="CSV データを分析する API")

@app.post("/analyze")
async def analyze_csv(file: UploadFile = File(...)):
    """CSV ファイルをアップロードして基本的な統計情報を返す"""
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        return {"error": "Empty CSV"}

    columns = list(rows[0].keys())

    # 数値カラムの統計
    stats = {}
    for col in columns:
        values = []
        for row in rows:
            try:
                values.append(float(row[col]))
            except (ValueError, TypeError):
                continue
        if values:
            stats[col] = {
                "count": len(values),
                "min": min(values),
                "max": max(values),
                "avg": sum(values) / len(values)
            }

    return {
        "total_rows": len(rows),
        "columns": columns,
        "numeric_stats": stats
    }
```

---

## 8. トラブルシューティング

### API にアクセスできない

| 症状 | 原因 | 対処法 |
|------|------|--------|
| 401 Unauthorized | 認証が設定されている | `X-API-Key` または `Authorization: Bearer` ヘッダーを付与 |
| 404 Not Found | コンテナが起動していない | 管理画面で「Deploy」ボタンを押す |
| 502 Bad Gateway | コンテナ内の FastAPI がまだ起動中 | 数秒待ってリトライ |
| 接続拒否 | Traefik ポートが違う | `.env` の `TRAEFIK_PORT` を確認 |

### MCP ツールが登録されない

| 症状 | 原因 | 対処法 |
|------|------|--------|
| ツール一覧に出ない | 検出ポーリング待ち | 最大 15 秒待つ |
| ツール一覧に出ない | OpenAPI スキーマ取得失敗 | `http://<host>:8085/<アプリ名>/openapi.json` にアクセスして確認 |
| ツール呼び出しエラー | payload の形式が不正 | Swagger UI (`/docs`) でパラメータを確認 |

### コード変更が反映されない

| 症状 | 原因 | 対処法 |
|------|------|--------|
| 古い応答が返る | uvicorn のリロードに失敗 | 管理画面から「Restart」 |
| import エラー | 新パッケージ未インストール | `requirements.txt` に追加後「Restart」 |
| シンタックスエラー | コード記法ミス | Web IDE またはコンテナログで確認 |

### 管理画面から確認する方法

- **ログ確認:** アプリカードの「Logs」ボタンでコンテナの stdout/stderr を表示
- **IDE パスワード:** 「Password」ボタンで code-server のパスワードを確認
- **強制再起動:** 「Restart」ボタンでイメージ再ビルド＋コンテナ再作成
