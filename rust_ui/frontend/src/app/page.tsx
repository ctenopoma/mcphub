"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Terminal, Trash2, ExternalLink, RefreshCw, Key, Copy, RotateCcw, Plus, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

interface AppStatus {
  name: string;
  status: string;
}

export default function Dashboard() {
  const [apps, setApps] = useState<AppStatus[]>([]);
  const [logs, setLogs] = useState<{ [key: string]: string }>({});
  const [passwords, setPasswords] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newAppName, setNewAppName] = useState("");

  const fetchApps = async () => {
    try {
      const res = await fetch("/api/apps");
      if (res.ok) {
        const data = await res.json();
        setApps(data);
      } else {
        setApps([{ name: "myapp", status: "Not Started" }]);
      }
    } catch (e) {
      console.error("Backend not reachable, using mock data", e);
      setApps([{ name: "myapp", status: "Not Started" }]);
    }
  };

  useEffect(() => {
    fetchApps();
    const interval = setInterval(fetchApps, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDeploy = async (appName: string) => {
    setLoading(true);
    try {
      await fetch(`/api/deploy/${appName}`, { method: "POST" });
      await fetchApps();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (appName: string) => {
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
      // Toggle off
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
      // Toggle off
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

  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Manager Dashboard</h1>
            <p className="text-muted-foreground mt-2">MCP & Web IDE Container Orchestration</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setNewAppName(""); setShowCreateDialog(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              New App
            </Button>
            <Button onClick={fetchApps} variant="outline" size="icon">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {apps.map((app) => {
            const isUp = app.status.startsWith("Up");
            return (
              <Card key={app.name} className="flex flex-col transition-all hover:shadow-md border-border">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl">{app.name}</CardTitle>
                      <CardDescription>Container App</CardDescription>
                    </div>
                    <Badge variant={isUp ? "default" : "secondary"}>
                      {isUp ? "Running" : app.status}
                    </Badge>
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
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(app.name)}
                      disabled={loading || app.status === "Not Started"}
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
                <CardFooter className="pt-4 border-t border-border">
                  <Button
                    className="w-full font-semibold"
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
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}
