"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Terminal, Trash2, ExternalLink, RefreshCw, Key, Copy, RotateCcw, Plus, X, LogOut, Lock, Shield, Shuffle, Hammer, FolderKanban, LayoutList, Settings, ChevronLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import ProjectGroupsDashboard from "@/components/ProjectGroupsDashboard";

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
  const [loadingApps, setLoadingApps] = useState<Set<string>>(new Set());
  const [createLoading, setCreateLoading] = useState(false);
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

  const setAppLoading = (appName: string, isLoading: boolean) => {
    setLoadingApps((prev) => {
      const next = new Set(prev);
      if (isLoading) next.add(appName);
      else next.delete(appName);
      return next;
    });
  };

  const handleDeploy = async (appName: string) => {
    setAppLoading(appName, true);
    try {
      await fetch(`/api/deploy/${appName}`, { method: "POST" });
      await fetchApps();
    } finally {
      setAppLoading(appName, false);
    }
  };

  const handleStop = async (appName: string) => {
    setAppLoading(appName, true);
    try {
      await fetch(`/api/stop/${appName}`, { method: "POST" });
      await fetchApps();
    } finally {
      setAppLoading(appName, false);
    }
  };

  const handleDelete = async (appName: string) => {
    if (!confirm(`「${appName}」を完全に削除しますか？\nコンテナとアプリディレクトリが削除されます。`)) return;
    setAppLoading(appName, true);
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
      setAppLoading(appName, false);
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
        if (data.is_custom) {
          setPasswords((prev) => ({ ...prev, [appName]: "__custom__" }));
        } else if (data.password) {
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
    if (!confirm("パスワードを初期化しますか？新しいランダムパスワードが生成されます。")) return;
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

  const [currentView, setCurrentView] = useState<"groups" | "containers" | "group-detail">("groups");
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string; description: string; containers: string[] } | null>(null);
  const [allGroups, setAllGroups] = useState<{ id: string; name: string; containers: string[] }[]>([]);
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});

  const fetchGroups = async () => {
    const res = await fetch("/api/groups");
    if (res.ok) {
      const data = await res.json();
      setAllGroups(data);
    }
  };

  const handleGroupSelect = (group: { id: string; name: string; description: string; containers: string[] }) => {
    setSelectedGroup(group);
    setCurrentView("group-detail");
    fetchGroups();
  };

  const moveContainer = async (containerName: string, fromGroupId: string, toGroupId: string) => {
    if (!toGroupId) return;
    if (fromGroupId !== "default") {
      await fetch(`/api/groups/${fromGroupId}/containers/${containerName}`, { method: "DELETE" });
    }
    await fetch(`/api/groups/${toGroupId}/containers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ container_name: containerName }),
    });
    setMoveTargets((prev) => ({ ...prev, [containerName]: "" }));
    // Refresh selectedGroup data
    const res = await fetch("/api/groups");
    if (res.ok) {
      const updated = await res.json();
      setAllGroups(updated);
      if (selectedGroup) {
        const found = updated.find((g: { id: string }) => g.id === fromGroupId);
        if (found) setSelectedGroup(found);
      }
    }
  };

  const isDuplicate = apps.some((app) => app.name === newAppName);
  const isCreateDisabled = !newAppName.trim() || isDuplicate || createLoading;

  const handleCreate = async () => {
    if (isCreateDisabled) return;
    setCreateLoading(true);
    try {
      const res = await fetch(`/api/create/${newAppName.trim()}`, { method: "POST" });
      if (res.ok) {
        setShowCreateDialog(false);
        setNewAppName("");
        await fetchApps();
      }
    } finally {
      setCreateLoading(false);
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
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Top header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src="/mcphub.png" alt="MCP HUB" className="h-9 w-9 rounded-lg object-cover" />
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">MCP HUB</h1>
            <p className="text-xs text-muted-foreground mt-0.5">MCP & Web IDE Container Orchestration</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchApps} variant="outline" size="icon" title="更新">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={handleLogout} variant="outline" size="icon" title="ログアウト">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 border-r border-border flex-shrink-0 flex flex-col p-3 gap-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
            ナビゲーション
          </p>
          <button
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
              currentView === "groups" || currentView === "group-detail"
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
            onClick={() => { setCurrentView("groups"); setSelectedGroup(null); }}
          >
            <FolderKanban className="h-4 w-4 flex-shrink-0" />
            ホーム（グループ一覧）
          </button>
          <button
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
              currentView === "containers"
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
            onClick={() => setCurrentView("containers")}
          >
            <LayoutList className="h-4 w-4 flex-shrink-0" />
            すべてのコンテナ
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <Settings className="h-4 w-4 flex-shrink-0" />
            システム設定
          </button>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-8">
          {currentView === "groups" ? (
            <div className="max-w-6xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">プロジェクトグループ</h2>
                <p className="text-muted-foreground mt-1">コンテナをグループ（プロジェクト）単位で管理します</p>
              </div>
              <ProjectGroupsDashboard onGroupSelect={handleGroupSelect} />
            </div>
          ) : currentView === "group-detail" && selectedGroup ? (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => { setCurrentView("groups"); setSelectedGroup(null); }}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  グループ一覧
                </Button>
                <div className="h-4 w-px bg-border" />
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{selectedGroup.name}</h2>
                  {selectedGroup.description && (
                    <p className="text-muted-foreground mt-0.5 text-sm">{selectedGroup.description}</p>
                  )}
                </div>
              </div>
              {selectedGroup.containers.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  コンテナがありません。グループ編集からコンテナを追加してください。
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {selectedGroup.containers.map((containerName) => {
                    const app = apps.find((a) => a.name === containerName);
                    if (!app) {
                      return (
                        <Card key={containerName} className="flex flex-col border-border opacity-60">
                          <CardHeader>
                            <CardTitle className="text-xl">{containerName}</CardTitle>
                            <CardDescription>未デプロイ</CardDescription>
                          </CardHeader>
                        </Card>
                      );
                    }
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
                              disabled={loadingApps.has(app.name)}
                            >
                              {loadingApps.has(app.name) ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : isUp ? <RefreshCw className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                              {isUp ? "Restart" : "Deploy"}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleStop(app.name)}
                              disabled={loadingApps.has(app.name) || !isUp}
                            >
                              <Square className="mr-2 h-4 w-4" />
                              Stop
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(app.name)}
                              disabled={loadingApps.has(app.name)}
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
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(passwords[app.name])} title="Copy">
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetPassword(app.name)} title="Reset Password">
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
                        <CardFooter className="pt-4 border-t border-border flex flex-col gap-2">
                          <div className="flex gap-2 w-full">
                            <Button
                              className="flex-1 font-semibold"
                              variant="default"
                              disabled={!isUp}
                              onClick={() => {
                                const traefikPort = process.env.NEXT_PUBLIC_TRAEFIK_PORT || "8085";
                                const host = window.location.hostname;
                                window.open(`http://${host}:${traefikPort}/${app.name}-dashboard/`, "_blank");
                              }}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open Dashboard
                            </Button>
                            <Button
                              className="flex-1"
                              variant="outline"
                              onClick={() => startRebuild(app.name)}
                              disabled={rebuildState?.appName === app.name && rebuildState.status === "building"}
                            >
                              <Hammer className="mr-2 h-4 w-4" />
                              Rebuild
                            </Button>
                          </div>
                          {allGroups.filter((g) => g.id !== "default" && g.id !== selectedGroup.id).length > 0 && (
                            <div className="flex gap-2 w-full items-center">
                              <span className="text-xs text-muted-foreground flex-shrink-0">移動:</span>
                              <select
                                className="flex-1 text-xs rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
                                value={moveTargets[app.name] || ""}
                                onChange={(e) => setMoveTargets((prev) => ({ ...prev, [app.name]: e.target.value }))}
                              >
                                <option value="">グループを選択...</option>
                                {allGroups
                                  .filter((g) => g.id !== "default" && g.id !== selectedGroup.id)
                                  .map((g) => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))}
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!moveTargets[app.name]}
                                onClick={() => moveContainer(app.name, selectedGroup.id, moveTargets[app.name])}
                              >
                                移動
                              </Button>
                            </div>
                          )}
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">すべてのコンテナ</h2>
                  <p className="text-muted-foreground mt-1">システム上のすべてのコンテナを管理します</p>
                </div>
                <Button onClick={() => { setNewAppName(""); setShowCreateDialog(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  New App
                </Button>
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
                      disabled={loadingApps.has(app.name)}
                    >
                      {loadingApps.has(app.name) ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : isUp ? <RefreshCw className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                      {isUp ? "Restart" : "Deploy"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleStop(app.name)}
                      disabled={loadingApps.has(app.name) || !isUp}
                    >
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(app.name)}
                      disabled={loadingApps.has(app.name)}
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
                          {passwords[app.name] === "__custom__" ? (
                            <span className="text-sm text-muted-foreground">ユーザー設定済み（非表示）</span>
                          ) : (
                            <code className="text-sm font-mono font-semibold">{passwords[app.name]}</code>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {passwords[app.name] !== "__custom__" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => copyToClipboard(passwords[app.name])}
                              title="Copy"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => resetPassword(app.name)}
                            title="パスワード初期化"
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
                      window.open(`http://${host}:${traefikPort}/${app.name}-dashboard/`, "_blank");
                    }}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Dashboard
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
          )}
        </main>
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
