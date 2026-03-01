# Microsoft Entra ID 認証 設定ガイド

MCP HUB のアプリに Microsoft Entra ID（旧 Azure AD）による JWT 認証を設定する手順を、Azure Portal でのアプリ登録から MCP HUB 側の設定、アクセストークンの取得・利用まで解説します。

---

## 目次

1. [前提条件](#1-前提条件)
2. [Azure Portal でのアプリ登録](#2-azure-portal-でのアプリ登録)
3. [MCP HUB での認証設定](#3-mcp-hub-での認証設定)
4. [アクセストークンの取得](#4-アクセストークンの取得)
5. [API へのアクセス](#5-api-へのアクセス)
6. [アプリ側でのユーザー情報の取得](#6-アプリ側でのユーザー情報の取得)
7. [認証フローの全体像](#7-認証フローの全体像)
8. [トラブルシューティング](#8-トラブルシューティング)

---

## 1. 前提条件

- Microsoft Entra ID テナント（Microsoft 365 や Azure サブスクリプションに付属）
- Azure Portal（https://portal.azure.com）へのアクセス権（アプリ登録権限が必要）
- MCP HUB が起動済みで、対象アプリがデプロイ済みであること

---

## 2. Azure Portal でのアプリ登録

### 2.1 アプリを登録する

1. [Azure Portal](https://portal.azure.com) にサインイン
2. **「Microsoft Entra ID」** → **「アプリの登録」** → **「新規登録」**

   ![App Registration](https://learn.microsoft.com/ja-jp/entra/identity-platform/media/quickstart-register-app/portal-02-app-reg-01.png)

3. 以下を入力して「登録」:

   | 項目 | 設定値 |
   |------|--------|
   | **名前** | `MCP HUB - <アプリ名>`（任意の表示名） |
   | **サポートされているアカウントの種類** | 用途に応じて選択（下表参照） |
   | **リダイレクト URI** | （空欄のままでOK — API アクセスのみの場合は不要） |

   **アカウントの種類の選び方:**

   | 選択肢 | ユースケース |
   |--------|-------------|
   | この組織ディレクトリのみ（シングルテナント） | 自社の社員のみがアクセスする場合 |
   | 任意の組織ディレクトリ（マルチテナント） | 複数の組織のユーザーがアクセスする場合 |

### 2.2 Tenant ID と Client ID を確認する

登録完了後、**「概要」** ページに表示される以下の 2 つの値をメモします:

| 項目 | 表示名 | 例 |
|------|--------|----|
| **Tenant ID** | ディレクトリ（テナント）ID | `12345678-abcd-1234-abcd-1234567890ab` |
| **Client ID** | アプリケーション（クライアント）ID | `abcdef01-2345-6789-abcd-ef0123456789` |

### 2.3 クライアントシークレットを作成する

サービス間通信（Client Credentials フロー）でトークンを取得する場合に必要です。

1. **「証明書とシークレット」** → **「新しいクライアント シークレット」**
2. 説明（例: `mcp-hub-secret`）と有効期限を入力して「追加」
3. 表示された **「値」** をコピーして安全に保管

   > **重要:** この値はこの画面でしか表示されません。ページを離れると再表示できないため、必ずこの時点でコピーしてください。

### 2.4 API のアクセス許可を設定する（任意）

ユーザー委任フロー（ユーザーがブラウザでログインしてトークンを取得）を使う場合:

1. **「API のアクセス許可」** → **「アクセス許可の追加」**
2. **「Microsoft Graph」** → **「委任されたアクセス許可」**
3. `User.Read` を選択して「アクセス許可の追加」
4. 必要に応じて **「管理者の同意を与える」** をクリック

### 2.5 アプリケーション ID URI を設定する（任意）

Client Credentials フローで `scope` に `.default` を使う場合:

1. **「API の公開」** → **「アプリケーション ID URI の設定」**
2. デフォルトの `api://<client-id>` をそのまま「保存」

---

## 3. MCP HUB での認証設定

### 3.1 管理画面から設定する

1. MCP HUB 管理画面（`http://<host>:8081`）にログイン
2. 対象アプリのカードにある **「Auth」**（盾アイコン）ボタンをクリック
3. 認証方式を **「Microsoft Entra ID (JWT)」** に変更
4. Azure Portal でメモした値を入力:

   | フィールド | 入力値 |
   |-----------|--------|
   | **Tenant ID** | `12345678-abcd-1234-abcd-1234567890ab` |
   | **Client ID** | `abcdef01-2345-6789-abcd-ef0123456789` |

5. **「Save」** をクリック

設定は即座に反映されます（アプリの再デプロイは不要）。

### 3.2 API から設定する

```bash
# ログイン
curl -c cookies.txt -X POST http://<host>:8081/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<管理パスワード>"}'

# Entra ID 認証を設定
curl -b cookies.txt -X POST http://<host>:8081/api/apps/<アプリ名>/auth \
  -H "Content-Type: application/json" \
  -d '{
    "auth_type": "entra_id",
    "tenant_id": "12345678-abcd-1234-abcd-1234567890ab",
    "client_id": "abcdef01-2345-6789-abcd-ef0123456789"
  }'

# 設定を確認
curl -b cookies.txt http://<host>:8081/api/apps/<アプリ名>/auth
```

---

## 4. アクセストークンの取得

### 4.1 Client Credentials フロー（サービス間通信）

人間のユーザーが介在しない、バックエンドサービスや自動化スクリプトからのアクセスに使います。

#### curl（Linux / macOS）

```bash
TENANT_ID="12345678-abcd-1234-abcd-1234567890ab"
CLIENT_ID="abcdef01-2345-6789-abcd-ef0123456789"
CLIENT_SECRET="<クライアントシークレット>"

TOKEN=$(curl -s -X POST \
  "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
  -d "client_id=${CLIENT_ID}" \
  -d "scope=${CLIENT_ID}/.default" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "grant_type=client_credentials" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "$TOKEN"
```

#### PowerShell（Windows）

```powershell
$TenantId = "12345678-abcd-1234-abcd-1234567890ab"
$ClientId = "abcdef01-2345-6789-abcd-ef0123456789"
$ClientSecret = "<クライアントシークレット>"

$body = @{
    client_id     = $ClientId
    scope         = "$ClientId/.default"
    client_secret = $ClientSecret
    grant_type    = "client_credentials"
}

$response = Invoke-RestMethod -Method Post `
    -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
    -Body $body

$token = $response.access_token
Write-Host $token
```

#### Python

```python
import requests

tenant_id = "12345678-abcd-1234-abcd-1234567890ab"
client_id = "abcdef01-2345-6789-abcd-ef0123456789"
client_secret = "<クライアントシークレット>"

response = requests.post(
    f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
    data={
        "client_id": client_id,
        "scope": f"{client_id}/.default",
        "client_secret": client_secret,
        "grant_type": "client_credentials",
    },
)

token = response.json()["access_token"]
print(token)
```

### 4.2 Authorization Code フロー（ユーザーログイン）

ユーザーがブラウザでサインインしてトークンを取得するフローです。Web アプリや SPA からのアクセスに使います。

#### 手順

1. ブラウザで以下の URL にアクセス:

   ```
   https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize?
     client_id=<client-id>
     &response_type=code
     &redirect_uri=http://localhost
     &scope=<client-id>/.default
   ```

2. Microsoft アカウントでサインイン
3. リダイレクト先の URL に含まれる `code` パラメータを取得
4. コードをトークンに交換:

   ```bash
   curl -X POST "https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token" \
     -d "client_id=<client-id>" \
     -d "scope=<client-id>/.default" \
     -d "code=<取得したコード>" \
     -d "redirect_uri=http://localhost" \
     -d "grant_type=authorization_code" \
     -d "client_secret=<クライアントシークレット>"
   ```

   > **注意:** Authorization Code フローを使う場合は、Azure Portal の **「認証」** → **「プラットフォームの追加」** で `http://localhost` をリダイレクト URI として登録してください。

---

## 5. API へのアクセス

取得したトークンを `Authorization: Bearer` ヘッダーに付けてリクエストします。

#### curl

```bash
# GET
curl -H "Authorization: Bearer ${TOKEN}" \
  http://<host>:8085/<アプリ名>/

# POST (JSON)
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Widget", "price": 9.99}' \
  http://<host>:8085/<アプリ名>/items

# ファイルアップロード
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@./data.csv" \
  http://<host>:8085/<アプリ名>/upload
```

#### PowerShell

```powershell
# GET
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Uri "http://<host>:8085/<アプリ名>/" -Headers $headers

# POST
$body = @{ name = "Widget"; price = 9.99 } | ConvertTo-Json
Invoke-RestMethod -Method Post `
    -Uri "http://<host>:8085/<アプリ名>/items" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body
```

#### Python

```python
import requests

headers = {"Authorization": f"Bearer {token}"}

# GET
resp = requests.get("http://<host>:8085/<アプリ名>/", headers=headers)
print(resp.json())

# POST
resp = requests.post(
    "http://<host>:8085/<アプリ名>/items",
    headers=headers,
    json={"name": "Widget", "price": 9.99},
)
print(resp.json())
```

---

## 6. アプリ側でのユーザー情報の取得

Entra ID 認証を通過したリクエストには、MCP HUB が `X-Forwarded-User` ヘッダーを自動付与します。アプリ（FastAPI）側でこのヘッダーを読むことで、認証済みユーザーを識別できます。

```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.get("/whoami")
def whoami(request: Request):
    """認証済みユーザーの情報を返す"""
    user = request.headers.get("X-Forwarded-User", "anonymous")
    return {"user": user}
```

`X-Forwarded-User` には JWT の以下のクレームが優先順で設定されます:

| 優先度 | クレーム | 内容 | 例 |
|--------|---------|------|----|
| 1 | `preferred_username` | ユーザーの表示用メールアドレス | `user@contoso.com` |
| 2 | `upn` | ユーザープリンシパル名 | `user@contoso.onmicrosoft.com` |
| 3 | `sub` | サブジェクト識別子（一意ID） | `AAAAAAAAAAAAAAAAAAAAALkHH...` |

> **注意:** Client Credentials フロー（サービス間通信）で取得したトークンには `preferred_username` や `upn` が含まれないため、`sub`（アプリケーションの Object ID）が使われます。

---

## 7. 認証フローの全体像

```
┌──────────────┐     ① トークン取得     ┌─────────────────────┐
│  クライアント  │ ──────────────────→  │  Microsoft Entra ID  │
│  (curl/app)   │ ←──────────────────  │  login.microsoft...  │
└──────┬───────┘   access_token        └──────────┬──────────┘
       │                                          │
       │ ② API リクエスト                          │
       │ Authorization: Bearer <token>            │
       ▼                                          │
┌──────────────┐                                  │
│   Traefik     │                                  │
│  (:8085)      │                                  │
└──────┬───────┘                                  │
       │ ③ ForwardAuth                             │
       ▼                                          │
┌──────────────┐     ④ JWKS 取得         │
│  Rust Server  │ ──────────────────→         │
│  /api/verify  │ ←──────────────────         │
│               │   公開鍵セット               │
│  ┌──────────┐│                              │
│  │JWT 検証   ││ ⑤ RS256 署名検証             │
│  │aud,iss   ││                                  │
│  └──────────┘│                                  │
└──────┬───────┘                                  │
       │ ⑥ 検証 OK → X-Forwarded-User 付与
       ▼
┌──────────────┐
│  アプリコンテナ │
│  (FastAPI)    │
└──────────────┘
```

**ステップの詳細:**

| # | ステップ | 説明 |
|---|---------|------|
| ① | トークン取得 | クライアントが Microsoft Entra ID からアクセストークン（JWT）を取得 |
| ② | API リクエスト | `Authorization: Bearer <token>` ヘッダー付きで API にアクセス |
| ③ | ForwardAuth | Traefik がリクエストを Rust サーバーの `/api/verify` に転送 |
| ④ | JWKS 取得 | Rust サーバーが Microsoft の公開鍵セット（JWKS）を取得（1時間キャッシュ） |
| ⑤ | JWT 検証 | RS256 署名検証、audience（= Client ID）、issuer（= テナント URL）を検証 |
| ⑥ | リクエスト転送 | 検証 OK なら `X-Forwarded-User` ヘッダーを付けてアプリコンテナに転送 |

---

## 8. トラブルシューティング

### 401 Unauthorized が返る

| 原因 | 確認方法 | 対処 |
|------|---------|------|
| トークンが期限切れ | JWT を [jwt.ms](https://jwt.ms) に貼って `exp` を確認 | トークンを再取得 |
| Client ID が不一致 | JWT の `aud` クレームと MCP HUB の設定を比較 | Azure Portal で確認して再設定 |
| Tenant ID が不一致 | JWT の `iss` クレームのテナント部分を確認 | Azure Portal で確認して再設定 |
| `Authorization` ヘッダーの形式が不正 | `Bearer ` プレフィックスが付いているか確認 | `Authorization: Bearer <token>` の形式にする |
| scope が間違っている | トークン取得時の scope を確認 | `<client-id>/.default` を使用 |

### JWT のデバッグ方法

取得したトークンの中身を確認するには:

**[jwt.ms](https://jwt.ms) を使う（推奨）:**

Microsoft 公式のデコードツール。ブラウザでトークンを貼り付けるとクレームが表示されます。

**コマンドラインで確認:**

```bash
# JWT のペイロード部分をデコード（2番目の . 区切り）
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

**確認すべきクレーム:**

| クレーム | 説明 | 期待値 |
|---------|------|--------|
| `aud` | 対象の Client ID | MCP HUB に設定した Client ID と一致すること |
| `iss` | 発行者 | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `exp` | 有効期限（UNIX タイムスタンプ） | 現在時刻より未来であること |

### MCP HUB コンテナから Microsoft へのネットワーク接続

Rust サーバーは JWKS 取得のために `https://login.microsoftonline.com` に HTTPS 接続する必要があります。

```bash
# コンテナ内からの接続テスト
docker compose exec mcp-manager curl -s -o /dev/null -w "HTTP %{http_code}" \
  https://login.microsoftonline.com/common/discovery/v2.0/keys
# → HTTP 200 が返れば OK
```

接続できない場合は、ネットワーク設定やプロキシの確認が必要です。
