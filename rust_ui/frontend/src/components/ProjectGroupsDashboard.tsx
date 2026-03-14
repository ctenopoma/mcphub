"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  LayoutGrid,
  List,
  Plus,
  Search,
  X,
  Pencil,
  Trash2,
} from "lucide-react";

interface AppStatus {
  name: string;
  status: string;
  auth_type: string;
}

interface ContainerSummary {
  total: number;
  running: number;
  stopped: number;
  error: number;
}

interface Group {
  id: string;
  name: string;
  description: string;
  containers: string[];
  containerSummary: ContainerSummary;
  createdAt: string;
  updatedAt: string;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}日前`;
  if (hours > 0) return `${hours}時間前`;
  return `${Math.max(1, minutes)}分前`;
}

function ContainerStatusBadges({ summary }: { summary: ContainerSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {summary.error > 0 && (
        <Badge variant="destructive" className="text-xs">
          エラー: {summary.error}
        </Badge>
      )}
      {summary.running > 0 && (
        <Badge className="bg-green-600 text-white text-xs">
          稼働中: {summary.running}
        </Badge>
      )}
      {summary.stopped > 0 && (
        <Badge variant="secondary" className="text-xs">
          停止中: {summary.stopped}
        </Badge>
      )}
      {summary.total === 0 && (
        <Badge variant="outline" className="text-xs">
          コンテナなし
        </Badge>
      )}
    </div>
  );
}

interface GroupSelectInfo {
  id: string;
  name: string;
  description: string;
  containers: string[];
}

interface Props {
  onGroupSelect?: (group: GroupSelectInfo) => void;
}

export default function ProjectGroupsDashboard({ onGroupSelect }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [allApps, setAllApps] = useState<AppStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // Edit dialog
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [selectedContainer, setSelectedContainer] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [groupsRes, appsRes] = await Promise.all([
        fetch("/api/groups"),
        fetch("/api/apps"),
      ]);
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (appsRes.ok) setAllApps(await appsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreateLoading(true);
    try {
      await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim(), description: newGroupDesc.trim() }),
      });
      setShowCreateDialog(false);
      setNewGroupName("");
      setNewGroupDesc("");
      await fetchData();
    } finally {
      setCreateLoading(false);
    }
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup || !editName.trim()) return;
    setEditLoading(true);
    try {
      await fetch(`/api/groups/${editingGroup.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
      });
      await fetchData();
      // Update editingGroup to reflect latest state
      setEditingGroup((prev) => prev ? { ...prev, name: editName.trim(), description: editDesc.trim() } : null);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm("このグループを削除しますか？")) return;
    await fetch(`/api/groups/${id}`, { method: "DELETE" });
    await fetchData();
    if (editingGroup?.id === id) setEditingGroup(null);
  };

  const handleAddContainer = async (groupId: string, containerName: string) => {
    if (!containerName) return;
    await fetch(`/api/groups/${groupId}/containers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ container_name: containerName }),
    });
    setSelectedContainer("");
    await fetchData();
    // Refresh editingGroup
    const updated = groups.find((g) => g.id === groupId);
    if (updated) {
      const refreshed = await fetch("/api/groups").then((r) => r.json());
      const found = (refreshed as Group[]).find((g) => g.id === groupId);
      if (found) setEditingGroup(found);
    }
  };

  const handleRemoveContainer = async (groupId: string, containerName: string) => {
    await fetch(`/api/groups/${groupId}/containers/${containerName}`, { method: "DELETE" });
    await fetchData();
    // Refresh editingGroup
    const refreshed = await fetch("/api/groups").then((r) => r.json());
    const found = (refreshed as Group[]).find((g) => g.id === groupId);
    if (found) setEditingGroup(found);
  };

  const openEditDialog = (group: Group) => {
    setEditingGroup(group);
    setEditName(group.name);
    setEditDesc(group.description);
    setSelectedContainer("");
  };

  // Containers not yet in the editing group
  const availableContainers = editingGroup
    ? allApps.filter((app) => !editingGroup.containers.includes(app.name))
    : [];

  const isVirtualDefault = groups.length === 1 && groups[0].id === "default";

  const filtered = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.description.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">読み込み中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Operation area */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          グループを作成
        </Button>
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="グループを検索..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="ml-auto flex gap-1 border border-border rounded-md p-1">
          <Button
            variant={viewMode === "card" ? "default" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode("card")}
            title="カードビュー"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode("list")}
            title="リストビュー"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          グループが見つかりません
        </div>
      )}

      {/* Card view */}
      {viewMode === "card" && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((group) => {
            const hasError = group.containerSummary.error > 0;
            const isDefault = group.id === "default";
            return (
              <Card
                key={group.id}
                className={`flex flex-col transition-all hover:shadow-md ${
                  hasError ? "border-destructive" : "border-border"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg leading-tight">
                      {group.name}
                      {isDefault && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(自動)</span>
                      )}
                    </CardTitle>
                    {!isDefault && (
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openEditDialog(group)}
                        >
                          <Pencil className="h-3 w-3" />
                          編集
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive border-destructive/50 hover:text-destructive"
                          onClick={() => handleDeleteGroup(group.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          削除
                        </Button>
                      </div>
                    )}
                  </div>
                  <CardDescription className="text-sm line-clamp-2">
                    {group.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-3">
                  {hasError && (
                    <div className="flex items-center gap-1.5 text-destructive text-xs">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      エラーが発生しています
                    </div>
                  )}
                  <ContainerStatusBadges summary={group.containerSummary} />
                  {group.containers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">コンテナなし</p>
                  ) : (
                    <div className="space-y-1">
                      {group.containers.map((name) => {
                        const app = allApps.find((a) => a.name === name);
                        const isRunning = app?.status?.startsWith("Up");
                        return (
                          <div key={name} className="flex items-center gap-2 text-sm">
                            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${isRunning ? "bg-green-500" : "bg-zinc-500"}`} />
                            <span className="truncate">{name}</span>
                            <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">
                              {isRunning ? "稼働中" : "停止"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="pt-3 border-t border-border flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">
                    Updated {formatRelativeTime(group.updatedAt)}
                  </p>
                  {onGroupSelect && (
                    <Button size="sm" onClick={() => onGroupSelect(group)}>
                      開く
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* List view */}
      {viewMode === "list" && filtered.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>グループ名</TableHead>
                <TableHead className="hidden md:table-cell">説明</TableHead>
                <TableHead>コンテナ状況</TableHead>
                <TableHead className="hidden sm:table-cell">最終更新</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((group) => {
                const hasError = group.containerSummary.error > 0;
                const isDefault = group.id === "default";
                return (
                  <TableRow
                    key={group.id}
                    className={hasError ? "border-l-2 border-l-destructive" : ""}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {hasError && (
                          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                        )}
                        {group.name}
                        {isDefault && (
                          <span className="text-xs text-muted-foreground">(自動)</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-sm max-w-xs truncate">
                      {group.description}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1.5">
                        <ContainerStatusBadges summary={group.containerSummary} />
                        {group.containers.length > 0 && (
                          <div className="flex flex-col gap-0.5">
                            {group.containers.map((name) => {
                              const app = allApps.find((a) => a.name === name);
                              const isRunning = app?.status?.startsWith("Up");
                              return (
                                <div key={name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isRunning ? "bg-green-500" : "bg-zinc-500"}`} />
                                  {name}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                      {formatRelativeTime(group.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {onGroupSelect && (
                          <Button size="sm" onClick={() => onGroupSelect(group)}>
                            開く
                          </Button>
                        )}
                        {!isDefault && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(group)}>
                              <Pencil className="h-3.5 w-3.5" />
                              編集
                            </Button>
                            <Button variant="outline" size="sm" className="text-destructive border-destructive/50 hover:text-destructive" onClick={() => handleDeleteGroup(group.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              削除
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Virtual default notice */}
      {isVirtualDefault && (
        <p className="text-xs text-muted-foreground text-center">
          グループを作成すると、コンテナをグループに振り分けられます。
        </p>
      )}

      {/* Create Group Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>グループを作成</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setShowCreateDialog(false); setNewGroupName(""); setNewGroupDesc(""); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">グループ名 *</label>
                <Input
                  className="mt-1"
                  placeholder="例: Production Services"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium">説明</label>
                <Input
                  className="mt-1"
                  placeholder="グループの説明（任意）"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowCreateDialog(false); setNewGroupName(""); setNewGroupDesc(""); }}
              >
                キャンセル
              </Button>
              <Button
                onClick={handleCreateGroup}
                disabled={!newGroupName.trim() || createLoading}
              >
                作成
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Edit Group Dialog */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>グループを編集</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setEditingGroup(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Name & Description */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">グループ名 *</label>
                  <Input
                    className="mt-1"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">説明</label>
                  <Input
                    className="mt-1"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleUpdateGroup}
                  disabled={!editName.trim() || editLoading}
                >
                  名前・説明を保存
                </Button>
              </div>

              {/* Container list */}
              <div>
                <p className="text-sm font-medium mb-2">コンテナ一覧</p>
                {editingGroup.containers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">コンテナがありません</p>
                ) : (
                  <div className="space-y-1">
                    {editingGroup.containers.map((name) => {
                      const app = allApps.find((a) => a.name === name);
                      const isRunning = app?.status?.startsWith("Up");
                      return (
                        <div
                          key={name}
                          className="flex items-center justify-between px-3 py-2 rounded-md border border-border text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full flex-shrink-0 ${
                                isRunning ? "bg-green-500" : "bg-zinc-500"
                              }`}
                            />
                            <span>{name}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveContainer(editingGroup.id, name)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add container */}
              {availableContainers.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">コンテナを追加</p>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={selectedContainer}
                      onChange={(e) => setSelectedContainer(e.target.value)}
                    >
                      <option value="">コンテナを選択...</option>
                      {availableContainers.map((app) => (
                        <option key={app.name} value={app.name}>
                          {app.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!selectedContainer}
                      onClick={() => handleAddContainer(editingGroup.id, selectedContainer)}
                    >
                      追加
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button variant="outline" onClick={() => setEditingGroup(null)}>
                閉じる
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
