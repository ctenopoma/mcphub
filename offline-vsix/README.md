このディレクトリには、ホスト側で offvsix などを使って取得した .vsix ファイルを配置します。

配置ルール:

- ファイル名は任意ですが、拡張子は .vsix にしてください
- このディレクトリ直下に置いた .vsix のみ自動反映対象です
- 子コンテナ起動時に /opt/offline-vsix として読み取り専用マウントされます

反映タイミング:

- Deploy または Rebuild でアプリコンテナが起動すると、自動でインストールされます
- 既に起動中のアプリには即時反映されないため、再起動または Rebuild を実行してください

永続化先:

- 各アプリの code-server 拡張は /apps/.code-server/<app>/extensions に保存されます
- config.yaml と同じ永続化領域を使うため、コンテナを入れ替えても保持されます

Python 拡張を追加する例:

PowerShell で offvsix を使って Python 拡張を取得し、このディレクトリへ保存します。

```powershell
offvsix download ms-python.python --output-dir .\offline-vsix
```

補完や型解析もオフラインで使いたい場合は、Pylance もあわせて取得します。

```powershell
offvsix download ms-python.vscode-pylance --output-dir .\offline-vsix
```

その後、対象アプリを Rebuild または再デプロイします。起動時に自動でインストールされます。

反映確認例:

1. 管理 UI から対象アプリの Rebuild を実行する
2. Web IDE を開く
3. Extensions で Python が有効になっていることを確認する
4. 必要なら Command Palette で Python: Select Interpreter が出ることを確認する