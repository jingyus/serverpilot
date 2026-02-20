// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 文件管理 API — 列表、读、上传、下载、新建、重命名、删除、权限。
 */

import { API_BASE_URL } from "@/utils/constants";
import { getToken, getTenantId } from "@/api/auth";
import { apiRequest } from "@/api/client";

/** 列表单项（与 Server 返回一致） */
export interface FileItem {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
  mode: string;
  uid: number;
  gid: number;
}

export interface ListResult {
  items: FileItem[];
  total: number;
  path: string;
}

export interface ReadResult {
  content: string;
  path: string;
}

/** 带鉴权的 fetch，用于下载等非 JSON 响应 */
function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const tenantId = getTenantId();
  if (tenantId) headers.set("X-Tenant-ID", tenantId);
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

/** 列表目录 */
export function listFiles(
  serverId: string,
  path: string,
  page = 1,
  pageSize = 100,
): Promise<ListResult> {
  const params = new URLSearchParams({
    path,
    page: String(page),
    pageSize: String(pageSize),
  });
  return apiRequest<ListResult>(
    `/servers/${serverId}/files?${params.toString()}`,
  );
}

/** 读文件内容（文本预览） */
export function readFileContent(
  serverId: string,
  path: string,
): Promise<ReadResult> {
  return apiRequest<ReadResult>(
    `/servers/${serverId}/files/content?path=${encodeURIComponent(path)}`,
  );
}

/** 下载文件：返回 blob，由调用方触发保存 */
export async function downloadFile(
  serverId: string,
  path: string,
): Promise<Blob> {
  const res = await authFetch(
    `/servers/${serverId}/files/download?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ??
        res.statusText,
    );
  }
  return res.blob();
}

/** 上传文件（base64 内容） */
export function uploadFile(
  serverId: string,
  path: string,
  contentBase64: string,
): Promise<{ success: boolean; path: string }> {
  return apiRequest(`/servers/${serverId}/files/upload`, {
    method: "POST",
    body: JSON.stringify({ path, content: contentBase64 }),
  });
}

/** 新建目录 */
export function createDirectory(
  serverId: string,
  path: string,
): Promise<{ success: boolean; path: string }> {
  return apiRequest(`/servers/${serverId}/files/mkdir`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

/** 新建空文件 */
export function createFile(
  serverId: string,
  path: string,
): Promise<{ success: boolean; path: string }> {
  return apiRequest(`/servers/${serverId}/files/mkfile`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

/** 重命名/移动 */
export function renameFile(
  serverId: string,
  from: string,
  to: string,
): Promise<{ success: boolean; from: string; to: string }> {
  return apiRequest(`/servers/${serverId}/files/rename`, {
    method: "PATCH",
    body: JSON.stringify({ from, to }),
  });
}

/** 删除 */
export function deletePath(
  serverId: string,
  path: string,
): Promise<{ success: boolean; path: string }> {
  return apiRequest(
    `/servers/${serverId}/files?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

/** 修改权限 */
export function setPermissions(
  serverId: string,
  path: string,
  mode: string,
): Promise<{ success: boolean; path: string; mode: string }> {
  return apiRequest(`/servers/${serverId}/files/permissions`, {
    method: "PATCH",
    body: JSON.stringify({ path, mode }),
  });
}
