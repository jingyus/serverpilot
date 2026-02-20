// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 文件管理页 — 列表、面包屑、工具栏、上传/下载、新建、重命名、删除、权限。
 * 开源版与云版共用，通过 Agent 执行，无需 FTP。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  File,
  Upload,
  Download,
  FolderPlus,
  FilePlus,
  Home,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Edit2,
  Trash2,
  Shield,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServersStore } from "@/stores/servers";
import { useNotificationsStore } from "@/stores/notifications";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate } from "@/utils/format";
import * as filesApi from "@/api/files";
import type { FileItem as FileItemType } from "@/api/files";

/** 默认允许的根路径（与 Server 白名单一致，用于「根目录」按钮） */
const DEFAULT_ROOTS = ["/home", "/var", "/tmp", "/opt", "/srv"];

export function Files() {
  const { serverId: paramServerId } = useParams<{ serverId?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    servers,
    fetchServers,
    isLoading: serversLoading,
  } = useServersStore();
  const addNotification = useNotificationsStore((s) => s.add);

  const [serverId, setServerId] = useState<string>(paramServerId ?? "");
  const [path, setPath] = useState("/home");
  const [items, setItems] = useState<FileItemType[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // 弹窗状态
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newName, setNewName] = useState("");
  const [permissionsMode, setPermissionsMode] = useState("644");
  const [targetItem, setTargetItem] = useState<FileItemType | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentServer = servers.find((s) => s.id === serverId);
  const pathSegments = path.split("/").filter(Boolean);

  const loadList = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await filesApi.listFiles(serverId, path, 1, 100);
      setItems(result.items);
      setTotal(result.total);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [serverId, path]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (paramServerId && paramServerId !== serverId) {
      setServerId(paramServerId);
      setPath("/home");
      setPathHistory([]);
      setHistoryIndex(-1);
    }
  }, [paramServerId, serverId]);

  useEffect(() => {
    if (serverId) loadList();
  }, [serverId, path, loadList]);

  const goTo = (newPath: string) => {
    setPathHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(path);
      return next;
    });
    setHistoryIndex((prev) => prev + 1);
    setPath(newPath);
  };

  const goBack = () => {
    if (historyIndex < 0) return;
    setPath(pathHistory[historyIndex]);
    setHistoryIndex((prev) => prev - 1);
  };

  const goRoot = () => {
    goTo(DEFAULT_ROOTS[0]);
  };

  const goToSegment = (index: number) => {
    const newPath = "/" + pathSegments.slice(0, index + 1).join("/");
    goTo(newPath);
  };

  const handleCreateFolder = async () => {
    if (!serverId || !newName.trim()) return;
    const newPath = path.replace(/\/$/, "") + "/" + newName.trim();
    try {
      await filesApi.createDirectory(serverId, newPath);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.folderCreated"),
      });
      setNewFolderOpen(false);
      setNewName("");
      loadList();
    } catch (e) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (e as Error).message,
      });
    }
  };

  const handleCreateFile = async () => {
    if (!serverId || !newName.trim()) return;
    const newPath = path.replace(/\/$/, "") + "/" + newName.trim();
    try {
      await filesApi.createFile(serverId, newPath);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.fileCreated"),
      });
      setNewFileOpen(false);
      setNewName("");
      loadList();
    } catch (e) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (e as Error).message,
      });
    }
  };

  const handleRename = async () => {
    if (!serverId || !targetItem || !newName.trim()) return;
    const dir = path.replace(/\/$/, "");
    const fromPath = dir + "/" + targetItem.name;
    const toPath = dir + "/" + newName.trim();
    try {
      await filesApi.renameFile(serverId, fromPath, toPath);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.renamed"),
      });
      setRenameOpen(false);
      setTargetItem(null);
      setNewName("");
      loadList();
    } catch (e) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (e as Error).message,
      });
    }
  };

  const handleDelete = async (item: FileItemType) => {
    if (!serverId) return;
    const fullPath = path.replace(/\/$/, "") + "/" + item.name;
    if (!window.confirm(t("files.confirmDelete", { name: item.name }))) return;
    try {
      await filesApi.deletePath(serverId, fullPath);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.deleted"),
      });
      loadList();
    } catch (e) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (e as Error).message,
      });
    }
  };

  const handleDownload = async (item: FileItemType) => {
    if (!serverId || item.dir) return;
    const fullPath = path.replace(/\/$/, "") + "/" + item.name;
    try {
      const blob = await filesApi.downloadFile(serverId, fullPath);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.click();
      URL.revokeObjectURL(url);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.downloadStarted"),
      });
    } catch (e) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (e as Error).message,
      });
    }
  };

  const handleSetPermissions = async () => {
    if (!serverId || !targetItem) return;
    const fullPath = path.replace(/\/$/, "") + "/" + targetItem.name;
    try {
      await filesApi.setPermissions(serverId, fullPath, permissionsMode);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.permissionsUpdated"),
      });
      setPermissionsOpen(false);
      setTargetItem(null);
      loadList();
    } catch (e) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (e as Error).message,
      });
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !serverId) return;
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const targetPath = path.replace(/\/$/, "") + "/" + file.name;
      await filesApi.uploadFile(serverId, targetPath, base64);
      addNotification({
        type: "success",
        title: t("common.success"),
        message: t("files.uploaded"),
      });
      loadList();
    } catch (err) {
      addNotification({
        type: "error",
        title: t("error.somethingWentWrong"),
        message: (err as Error).message,
      });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const openRename = (item: FileItemType) => {
    setTargetItem(item);
    setNewName(item.name);
    setRenameOpen(true);
  };

  const openPermissions = (item: FileItemType) => {
    setTargetItem(item);
    setPermissionsMode(item.mode || "644");
    setPermissionsOpen(true);
  };

  if (serversLoading && servers.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {t("nav.files")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 服务器选择 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("files.selectServer")}
            </span>
            <select
              value={serverId}
              onChange={(e) => {
                const id = e.target.value;
                setServerId(id);
                if (id) navigate(`/files/${id}`, { replace: true });
                setPath("/home");
                setPathHistory([]);
                setHistoryIndex(-1);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">—</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.status === "online" ? "🟢" : "⚪"}
                </option>
              ))}
            </select>
            {currentServer && (
              <span className="text-sm text-muted-foreground">
                {currentServer.name}
              </span>
            )}
          </div>

          {!serverId && (
            <p className="text-sm text-muted-foreground">
              {t("files.selectServerHint")}
            </p>
          )}

          {serverId && (
            <>
              {/* 面包屑 */}
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <button
                  type="button"
                  onClick={goRoot}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Home className="h-4 w-4" />
                </button>
                {pathSegments.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => goToSegment(i)}
                      className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground"
                    >
                      {seg}
                    </button>
                  </span>
                ))}
              </div>

              {/* 工具栏 */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goBack}
                  disabled={historyIndex < 0}
                >
                  {t("common.back")}
                </Button>
                <Button variant="outline" size="sm" onClick={goRoot}>
                  <Home className="h-4 w-4 mr-1" />
                  {t("files.root")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Upload className="h-4 w-4 mr-1" />
                  )}
                  {t("files.upload")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewName("");
                    setNewFolderOpen(true);
                  }}
                >
                  <FolderPlus className="h-4 w-4 mr-1" />
                  {t("files.newFolder")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewName("");
                    setNewFileOpen(true);
                  }}
                >
                  <FilePlus className="h-4 w-4 mr-1" />
                  {t("files.newFile")}
                </Button>
                <Button variant="ghost" size="sm" onClick={loadList}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              {/* 文件列表表格 */}
              <div className="rounded-md border">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="w-8 px-2 py-2 text-left font-medium">
                          {t("files.name")}
                        </th>
                        <th className="w-20 px-2 py-2 text-right font-medium">
                          {t("files.size")}
                        </th>
                        <th className="w-24 px-2 py-2 text-left font-medium">
                          {t("files.mode")}
                        </th>
                        <th className="w-36 px-2 py-2 text-left font-medium">
                          {t("files.mtime")}
                        </th>
                        <th className="w-12 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.name}
                          className="border-b last:border-0 hover:bg-muted/50"
                          onDoubleClick={() => {
                            if (item.dir)
                              goTo(path.replace(/\/$/, "") + "/" + item.name);
                          }}
                        >
                          <td className="px-2 py-2">
                            <span className="flex items-center gap-2">
                              {item.dir ? (
                                <FolderOpen className="h-4 w-4 text-amber-500" />
                              ) : (
                                <File className="h-4 w-4 text-muted-foreground" />
                              )}
                              {item.name}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {item.dir ? "—" : formatBytes(item.size)}
                          </td>
                          <td className="px-2 py-2 font-mono text-muted-foreground">
                            {item.mode}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {formatDate(new Date(item.mtime * 1000))}
                          </td>
                          <td className="px-2 py-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => openRename(item)}
                                >
                                  <Edit2 className="h-4 w-4 mr-2" />
                                  {t("files.rename")}
                                </DropdownMenuItem>
                                {!item.dir && (
                                  <DropdownMenuItem
                                    onClick={() => handleDownload(item)}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    {t("files.download")}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => openPermissions(item)}
                                >
                                  <Shield className="h-4 w-4 mr-2" />
                                  {t("files.permissions")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => handleDelete(item)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {t("common.delete")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!loading && items.length === 0 && !error && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("files.emptyDir")}
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {t("files.summary", { total: items.length, path })}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 新建文件夹 */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("files.newFolder")}</DialogTitle>
            <DialogDescription>{t("files.newFolderDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("files.folderNamePlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newName.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建文件 */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("files.newFile")}</DialogTitle>
            <DialogDescription>{t("files.newFileDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("files.fileNamePlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreateFile} disabled={!newName.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("files.rename")}</DialogTitle>
            <DialogDescription>{t("files.renameDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={targetItem?.name}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 权限 */}
      <Dialog open={permissionsOpen} onOpenChange={setPermissionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("files.permissions")}</DialogTitle>
            <DialogDescription>{t("files.permissionsDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            value={permissionsMode}
            onChange={(e) => setPermissionsMode(e.target.value)}
            placeholder="644"
            className="font-mono"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionsOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSetPermissions}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
