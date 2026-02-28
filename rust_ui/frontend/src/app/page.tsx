"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Terminal, Trash2, ExternalLink, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AppStatus {
  name: string;
  status: string;
}

export default function Dashboard() {
  const [apps, setApps] = useState<AppStatus[]>([]);
  const [logs, setLogs] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(false);

  const fetchApps = async () => {
    try {
      const res = await fetch("/api/apps");
      if (res.ok) {
        const data = await res.json();
        setApps(data);
      } else {
        // Mock data when backend is not ready
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
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (appName: string) => {
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

  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Manager Dashboard</h1>
            <p className="text-muted-foreground mt-2">MCP & Web IDE Container Orchestration</p>
          </div>
          <Button onClick={fetchApps} variant="outline" size="icon">
            <RefreshCw className="h-4 w-4" />
          </Button>
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
                      variant="secondary"
                      size="sm"
                      onClick={() => fetchLogs(app.name)}
                    >
                      <Terminal className="mr-2 h-4 w-4" />
                      Logs
                    </Button>
                  </div>

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
                      const traefikPort = process.env.NEXT_PUBLIC_TRAEFIK_PORT || "8080";
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
    </div>
  );
}
