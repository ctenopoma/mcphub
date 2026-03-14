"use client";

import { useState } from "react";
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
  MoreVertical,
  Plus,
  Search,
} from "lucide-react";

interface ContainerSummary {
  total: number;
  running: number;
  stopped: number;
  error: number;
}

interface ProjectGroup {
  id: string;
  name: string;
  description: string;
  containerSummary: ContainerSummary;
  createdAt: string;
  updatedAt: string;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
}

const MOCK_GROUPS: ProjectGroup[] = [
  {
    id: "1",
    name: "Production Services",
    description: "本番環境で稼働中の主要なMCPサービス群",
    containerSummary: { total: 6, running: 3, stopped: 2, error: 1 },
    createdAt: "2026-01-10T09:00:00Z",
    updatedAt: "2026-03-14T10:30:00Z",
    cpuUsagePercent: 45,
    memoryUsagePercent: 62,
  },
  {
    id: "2",
    name: "Development Sandbox",
    description: "開発・テスト用の一時的なコンテナ環境",
    containerSummary: { total: 4, running: 4, stopped: 0, error: 0 },
    createdAt: "2026-01-15T14:00:00Z",
    updatedAt: "2026-03-13T18:45:00Z",
    cpuUsagePercent: 12,
    memoryUsagePercent: 38,
  },
  {
    id: "3",
    name: "Analytics Pipeline",
    description: "データ収集・分析用パイプラインのMCPコンテナ",
    containerSummary: { total: 3, running: 3, stopped: 0, error: 0 },
    createdAt: "2026-02-01T11:00:00Z",
    updatedAt: "2026-03-14T08:00:00Z",
  },
  {
    id: "4",
    name: "Legacy Apps",
    description: "移行待ちのレガシーアプリケーション",
    containerSummary: { total: 5, running: 0, stopped: 5, error: 0 },
    createdAt: "2025-11-20T10:00:00Z",
    updatedAt: "2026-02-28T16:00:00Z",
  },
  {
    id: "5",
    name: "Experimental",
    description: "新機能プロトタイプ・実験用コンテナ",
    containerSummary: { total: 2, running: 1, stopped: 1, error: 0 },
    createdAt: "2026-03-01T09:30:00Z",
    updatedAt: "2026-03-14T11:00:00Z",
    cpuUsagePercent: 8,
    memoryUsagePercent: 25,
  },
];

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

export default function ProjectGroupsDashboard() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filtered = MOCK_GROUPS.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Click-outside overlay for kebab menus */}
      {openMenuId && (
        <div
          className="fixed inset-0 z-[5]"
          onClick={() => setOpenMenuId(null)}
        />
      )}

      {/* Operation area */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button>
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
                    </CardTitle>
                    <div className="relative flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setOpenMenuId(
                            openMenuId === group.id ? null : group.id
                          )
                        }
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                      {openMenuId === group.id && (
                        <div className="absolute right-0 top-8 z-10 w-40 rounded-md border border-border bg-popover shadow-md text-popover-foreground">
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-t-md"
                            onClick={() => setOpenMenuId(null)}
                          >
                            詳細を表示
                          </button>
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                            onClick={() => setOpenMenuId(null)}
                          >
                            設定
                          </button>
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent text-destructive rounded-b-md"
                            onClick={() => setOpenMenuId(null)}
                          >
                            削除
                          </button>
                        </div>
                      )}
                    </div>
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
                  <p className="text-xs text-muted-foreground">
                    合計 {group.containerSummary.total} コンテナ
                  </p>
                  {(group.cpuUsagePercent !== undefined ||
                    group.memoryUsagePercent !== undefined) && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {group.cpuUsagePercent !== undefined && (
                        <div className="rounded-md bg-muted px-2 py-1.5">
                          <p className="text-xs text-muted-foreground">CPU</p>
                          <p className="text-sm font-semibold">
                            {group.cpuUsagePercent}%
                          </p>
                        </div>
                      )}
                      {group.memoryUsagePercent !== undefined && (
                        <div className="rounded-md bg-muted px-2 py-1.5">
                          <p className="text-xs text-muted-foreground">
                            Memory
                          </p>
                          <p className="text-sm font-semibold">
                            {group.memoryUsagePercent}%
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Updated {formatRelativeTime(group.updatedAt)}
                  </p>
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
                return (
                  <TableRow
                    key={group.id}
                    className={
                      hasError ? "border-l-2 border-l-destructive" : ""
                    }
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {hasError && (
                          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                        )}
                        {group.name}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-sm max-w-xs truncate">
                      {group.description}
                    </TableCell>
                    <TableCell>
                      <ContainerStatusBadges summary={group.containerSummary} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                      {formatRelativeTime(group.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm">
                          詳細
                        </Button>
                        <Button variant="ghost" size="sm">
                          設定
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
