"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Terminal, Trash2, ExternalLink, RefreshCw, Key, Copy, RotateCcw, Plus, X, LogOut, Lock, Shield, Shuffle, Hammer } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

interface AppStatus {
  name: string;
  status: string;
  auth_type: string;
}

interface AuthConfig {
  auth_type: "none" | "api_key" | "entra_id";
  api_key?: string;
  tenant_id?: string;
  client_id?: string;
}

export default function Dashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [apps, setApps] = useState<AppStatus[]>([]);
  const [logs, setLogs] = useState<{ [key: string]: string }>({});
  const [passwords, setPasswords] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newAppName, setNewAppName] = useState("");

  // Auth settings modal
  const [showAuthDialog, setShowAuthDialog] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({ auth_type: "none" });
  const [authLoading, setAuthLoading] = useState(false);

  // Rebuild terminal
  const [rebuildState, setRebuildState] = useState<{
    appName: string;
    logs: string[];
    status: "building" | "success" | "failed";
  } | null>(null);
  const buildLogRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll rebuild terminal to bottom on each new log line
  useEffect(() => {
    if (buildLogRef.current) {
      buildLogRef.current.scrollTop = buildLogRef.current.scrollHeight;
    }
  }, [rebuildState]);

  const closeRebuildModal = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setRebuildState(null);
  };

  const startRebuild = (appName: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setRebuildState({ appName, logs: [], status: "building" });

    const es = new EventSource(`/api/rebuild/${appName}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      setRebuildState((prev) =>
        prev ? { ...prev, logs: [...prev.logs, e.data] } : null
      );
    };

    es.addEventListener("done", (e: Event) => {
      const success = (e as MessageEvent).data === "success";
      setRebuildState((prev) =>
        prev ? { ...prev, status: success ? "success" : "failed" } : null
      );
      es.close();
      eventSourceRef.current = null;
      fetchApps();
    });

    es.onerror = () => {
      setRebuildState((prev) =>
        prev
          ? { ...prev, status: "failed", logs: [...prev.logs, "Connection error"] }
          : null
      );
      es.close();
      eventSourceRef.current = null;
    };
  };

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/check");
      setIsAuthenticated(res.ok);
    } catch {
      setIsAuthenticated(false);
    }
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        setIsAuthenticated(true);
        setLoginPassword("");
      } else {
        setLoginError("パスワードが正しくありません");
      }
    } catch {
      setLoginError("サーバーに接続できません");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/logout", { method: "POST" });
    setIsAuthenticated(false);
    setApps([]);
    setLogs({});
    setPasswords({});
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const fetchApps = async () => {
    try {
      const res = await fetch("/api/apps");
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setApps(data);
      }
    } catch (e) {
      console.error("Backend not reachable", e);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchApps();
    const interval = setInterval(fetchApps, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleDeploy = async (appName: string) => {
    setLoading(true);
    try {
      await fetch(`/api/deploy/${appName}`, { method: "POST" });
      await fetchApps();
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (appName: string) => {
    setLoading(true);
    try {
      await fetch(`/api/stop/${appName}`, { method: "POST" });
      await fetchApps();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (appName: string) => {
    if (!confirm(`「${appName}」を完全に削除しますか？\nコンテナとアプリディレクトリが削除されます。`)) return;
    setLoading(true);
    try {
      await fetch(`/api/delete/${appName}`, { method: "POST" });
      await fetchApps();
      setLogs((prev) => {
        const newLogs = { ...prev };
        delete newLogs[appName];
        return newLogs;
      });
      setPasswords((prev) => {
        const p = { ...prev };
        delete p[appName];
        return p;
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleLogs = async (appName: string) => {
    if (logs[appName]) {
      setLogs((prev) => {
        const newLogs = { ...prev };
        delete newLogs[appName];
        return newLogs;
      });
      return;
    }

    try {
      const res = await fetch(`/api/logs/${appName}`);
      if (res.ok) {
        const text = await res.text();
        setLogs((prev) => ({ ...prev, [appName]: text }));
      } else {
        setLogs((prev) => ({ ...prev, [appName]: "No logs found or backend error." }));
      }
    } catch (e) {
      console.error(e);
      setLogs((prev) => ({ ...prev, [appName]: "Error fetching logs." }));
    }
  };

  const togglePassword = async (appName: string) => {
    if (passwords[appName]) {
      setPasswords((prev) => {
        const p = { ...prev };
        delete p[appName];
        return p;
      });
      return;
    }

    try {
      const res = await fetch(`/api/password/${appName}`);
      if (res.ok) {
        const data = await res.json();
        if (data.password) {
          setPasswords((prev) => ({ ...prev, [appName]: data.password }));
        } else {
          setPasswords((prev) => ({ ...prev, [appName]: data.error || "Error" }));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const resetPassword = async (appName: string) => {
    if (!confirm("パスワードをリセットしますか？")) return;
    try {
      const res = await fetch(`/api/password/${appName}/reset`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.password) {
          setPasswords((prev) => ({ ...prev, [appName]: data.password }));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const isDuplicate = apps.some((app) => app.name === newAppName);
  const isCreateDisabled = !newAppName.trim() || isDuplicate || loading;

  const handleCreate = async () => {
    if (isCreateDisabled) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/create/${newAppName.trim()}`, { method: "POST" });
      if (res.ok) {
        setShowCreateDialog(false);
        setNewAppName("");
        await fetchApps();
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  // Auth settings modal handlers
  const openAuthDialog = async (appName: string) => {
    setShowAuthDialog(appName);
    setAuthLoading(true);
    try {
      const res = await fetch(`/api/apps/${appName}/auth`);
      if (res.ok) {
        const data = await res.json();
        const auth = data.auth;
        setAuthConfig({
          auth_type: auth.auth_type || "none",
          api_key: auth.api_key || "",
          tenant_id: auth.tenant_id || "",
          client_id: auth.client_id || "",
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAuthLoading(false);
    }
  };

  const generateRandomKey = () => {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    const key = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
    setAuthConfig({ ...authConfig, api_key: key });
  };

  const saveAuthConfig = async () => {
    if (!showAuthDialog) return;
    setAuthLoading(true);
    try {
      const body: Record<string, unknown> = { auth_type: authConfig.auth_type };
      if (authConfig.auth_type === "api_key") {
        body.api_key = authConfig.api_key;
      } else if (authConfig.auth_type === "entra_id") {
        body.tenant_id = authConfig.tenant_id;
        body.client_id = authConfig.client_id;
      }
      const res = await fetch(`/api/apps/${showAuthDialog}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowAuthDialog(null);
        await fetchApps();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAuthLoading(false);
    }
  };

  const authLabel = (type: string) => {
    switch (type) {
      case "api_key": return "API Key";
      case "entra_id": return "Entra ID";
      default: return null;
    }
  };

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img src="/mcphub.png" alt="MCP HUB" className="h-16 w-16 rounded-lg object-cover" />
            </div>
            <CardTitle className="text-2xl">MCP HUB</CardTitle>
            <CardDescription>管理画面にアクセスするにはパスワードを入力してください</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="パスワード"
                className="pl-10"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                autoFocus
              />
            </div>
            {loginError && (
              <p className="text-sm text-destructive">{loginError}</p>
            )}
            <Button className="w-full" onClick={handleLogin} disabled={loginLoading || !loginPassword}>
              {loginLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
              ログイン
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <img src="/mcphub.png" alt="MCP HUB" className="h-14 w-14 rounded-lg object-cover" />
            <div>
              <h1 className="text-4xl font-bold tracking-tight">MCP HUB</h1>
              <p className="text-muted-foreground mt-1">MCP & Web IDE Container Orchestration</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setNewAppName(""); setShowCreateDialog(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              New App
            </Button>
            <Button onClick={fetchApps} variant="outline" size="icon">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={handleLogout} variant="outline" size="icon" title="ログアウト">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {apps.map((app) => {
            const isUp = app.status.startsWith("Up");
            const authBadge = authLabel(app.auth_type);
            return (
              <Card key={app.name} className="flex flex-col transition-all hover:shadow-md border-border">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl">{app.name}</CardTitle>
                      <CardDescription>Container App</CardDescription>
                    </div>
                    <div className="flex gap-1">
                      {authBadge && (
                        <Badge variant="outline">
                          <Shield className="mr-1 h-3 w-3" />
                          {authBadge}
                        </Badge>
                      )}
                      <Badge variant={isUp ? "default" : "secondary"}>
                        {isUp ? "Running" : app.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-grow space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={isUp ? "outline" : "default"}
                      size="sm"
                      onClick={() => handleDeploy(app.name)}
                      disabled={loading}
                    >
                      {isUp ? <RefreshCw className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                      {isUp ? "Restart" : "Deploy"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleStop(app.name)}
                      disabled={loading || !isUp}
                    >
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(app.name)}
                      disabled={loading}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                    <Button
                      variant={logs[app.name] ? "default" : "secondary"}
                      size="sm"
                      onClick={() => toggleLogs(app.name)}
                    >
                      <Terminal className="mr-2 h-4 w-4" />
                      Logs
                    </Button>
                    <Button
                      variant={passwords[app.name] ? "default" : "secondary"}
                      size="sm"
                      onClick={() => togglePassword(app.name)}
                      disabled={!isUp}
                    >
                      <Key className="mr-2 h-4 w-4" />
                      Password
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openAuthDialog(app.name)}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Auth
                    </Button>
                  </div>

                  {passwords[app.name] && (
                    <div className="mt-3 rounded-md bg-muted p-3 border border-border">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">IDE Password</p>
                          <code className="text-sm font-mono font-semibold">{passwords[app.name]}</code>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => copyToClipboard(passwords[app.name])}
                            title="Copy"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => resetPassword(app.name)}
                            title="Reset Password"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {logs[app.name] && (
                    <div className="mt-4 rounded-md bg-muted p-2 h-48 border border-border">
                      <ScrollArea className="h-full w-full">
                        <pre className="text-xs font-mono p-2">{logs[app.name]}</pre>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="pt-4 border-t border-border flex gap-2">
                  <Button
                    className="flex-1 font-semibold"
                    variant="default"
                    disabled={!isUp}
                    onClick={() => {
                      const traefikPort = process.env.NEXT_PUBLIC_TRAEFIK_PORT || "8085";
                      const host = window.location.hostname;
                      window.open(`http://${host}:${traefikPort}/${app.name}-ide/`, "_blank");
                    }}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Web IDE
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => startRebuild(app.name)}
                    disabled={
                      rebuildState?.appName === app.name &&
                      rebuildState.status === "building"
                    }
                  >
                    <Hammer className="mr-2 h-4 w-4" />
                    Rebuild
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Create App Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Create New App</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowCreateDialog(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>Enter a name for your new application template.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="my-new-app"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowCreateDialog(false);
                }}
                autoFocus
              />
              {isDuplicate && (
                <p className="text-sm text-destructive">
                  This app name already exists.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isCreateDisabled}>
                <Plus className="mr-2 h-4 w-4" />
                Create
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Auth Settings Dialog */}
      {showAuthDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>
                  <Shield className="inline mr-2 h-5 w-5" />
                  Auth Settings: {showAuthDialog}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowAuthDialog(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>API の認証方式を設定します。設定は即座に反映されます。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">認証方式</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={authConfig.auth_type}
                  onChange={(e) => setAuthConfig({ ...authConfig, auth_type: e.target.value as AuthConfig["auth_type"] })}
                >
                  <option value="none">認証なし (Public)</option>
                  <option value="api_key">API Key</option>
                  <option value="entra_id">Microsoft Entra ID (JWT)</option>
                </select>
              </div>

              {authConfig.auth_type === "api_key" && (
                <div>
                  <label className="text-sm font-medium mb-2 block">API Key</label>
                  <div className="flex gap-2">
                    <Input
                      value={authConfig.api_key || ""}
                      onChange={(e) => setAuthConfig({ ...authConfig, api_key: e.target.value })}
                      placeholder="APIキーを入力"
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={generateRandomKey} title="ランダム生成">
                      <Shuffle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => authConfig.api_key && copyToClipboard(authConfig.api_key)}
                      title="コピー"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {authConfig.auth_type === "entra_id" && (
                <>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Tenant ID</label>
                    <Input
                      value={authConfig.tenant_id || ""}
                      onChange={(e) => setAuthConfig({ ...authConfig, tenant_id: e.target.value })}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Client ID (Application ID)</label>
                    <Input
                      value={authConfig.client_id || ""}
                      onChange={(e) => setAuthConfig({ ...authConfig, client_id: e.target.value })}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    />
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAuthDialog(null)}>
                Cancel
              </Button>
              <Button onClick={saveAuthConfig} disabled={authLoading}>
                {authLoading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
      {/* Rebuild Terminal Overlay */}
      {rebuildState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="w-full max-w-3xl flex flex-col" style={{ height: "80vh" }}>
            <CardHeader className="flex-none">
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Hammer className="h-5 w-5" />
                  Rebuild: {rebuildState.appName}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {rebuildState.status === "building" && (
                    <Badge variant="secondary">
                      <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                      Building...
                    </Badge>
                  )}
                  {rebuildState.status === "success" && (
                    <Badge className="bg-green-600 text-white">Success</Badge>
                  )}
                  {rebuildState.status === "failed" && (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={closeRebuildModal}
                    disabled={rebuildState.status === "building"}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardDescription>
                {rebuildState.status === "building"
                  ? "Dockerイメージをビルド中です..."
                  : rebuildState.status === "success"
                  ? "ビルドが成功しました。コンテナを再起動しました。"
                  : "ビルドに失敗しました。ログを確認してIDEで修正してください。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pb-0">
              <div
                ref={buildLogRef}
                className="h-full rounded-md bg-black text-green-400 font-mono text-xs p-4 overflow-y-auto"
              >
                {rebuildState.logs.length === 0 && rebuildState.status === "building" && (
                  <span className="text-gray-500">Waiting for build output...</span>
                )}
                {rebuildState.logs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all leading-5">
                    {line}
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter className="flex-none flex justify-end gap-2 pt-4">
              {rebuildState.status === "success" && (
                <Button
                  onClick={() => {
                    const traefikPort = process.env.NEXT_PUBLIC_TRAEFIK_PORT || "8085";
                    const host = window.location.hostname;
                    window.open(
                      `http://${host}:${traefikPort}/${rebuildState.appName}-ide/`,
                      "_blank"
                    );
                  }}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Web IDE
                </Button>
              )}
              {rebuildState.status === "failed" && (
                <Button
                  variant="outline"
                  onClick={() => startRebuild(rebuildState.appName)}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              )}
              <Button
                variant="outline"
                onClick={closeRebuildModal}
                disabled={rebuildState.status === "building"}
              >
                Close
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
