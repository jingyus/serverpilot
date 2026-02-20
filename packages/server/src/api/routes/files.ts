// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 文件管理 REST API — 列表、读、下载、上传、新建、重命名、删除、权限。
 *
 * 所有操作经 Agent 在目标服务器执行，开源版与云版共用同一套接口。
 *
 * @module api/routes/files
 */

import { z } from "zod";
import { Hono } from "hono";
import { getServerRepository } from "../../db/repositories/server-repository.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { ApiError } from "../middleware/error-handler.js";
import {
  listDirectory,
  readFileContent,
  downloadFile,
  writeFile,
  createDirectory,
  createFile,
  renamePath,
  deletePath,
  setPermissions,
  MAX_UPLOAD_SIZE,
} from "../../core/file-manager/index.js";
import type { ApiEnv } from "./types.js";

const files = new Hono<ApiEnv>();

files.use("*", requireAuth, resolveRole);

// ============================================================================
// 校验：用户对该 server 有权限
// ============================================================================

async function ensureServerAccess(
  c: { get: (k: string) => string },
  serverId: string,
): Promise<void> {
  const userId = c.get("userId");
  const repo = getServerRepository();
  const server = await repo.findById(serverId, userId);
  if (!server) {
    throw ApiError.notFound("Server");
  }
}

// ============================================================================
// Query/Body Schemas
// ============================================================================

const PathQuerySchema = z.object({
  path: z.string().min(1, "path is required"),
});
const ListQuerySchema = PathQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const UploadBodySchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1), // base64
});
const MkdirBodySchema = z.object({ path: z.string().min(1) });
const MkfileBodySchema = z.object({ path: z.string().min(1) });
const RenameBodySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
const PermissionsBodySchema = z.object({
  path: z.string().min(1),
  mode: z.string().regex(/^[0-7]{3,4}$/, "mode must be octal e.g. 755"),
});

// ============================================================================
// GET /servers/:serverId/files — 列表目录
// ============================================================================

files.get(
  "/",
  requirePermission("server:read"),
  validateQuery(ListQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path, page, pageSize } = c.get("validatedQuery") as z.infer<
      typeof ListQuerySchema
    >;
    try {
      const result = await listDirectory(
        serverId,
        userId,
        path,
        page,
        pageSize,
      );
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed") || msg.includes("not a directory")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// GET /servers/:serverId/files/content — 读文件内容（文本预览）
// ============================================================================

files.get(
  "/content",
  requirePermission("server:read"),
  validateQuery(PathQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path } = c.get("validatedQuery") as z.infer<typeof PathQuerySchema>;
    try {
      const result = await readFileContent(serverId, userId, path);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// GET /servers/:serverId/files/download — 下载文件
// ============================================================================

files.get(
  "/download",
  requirePermission("server:read"),
  validateQuery(PathQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path } = c.get("validatedQuery") as z.infer<typeof PathQuerySchema>;
    try {
      const { content, truncated } = await downloadFile(serverId, userId, path);
      const filename = path.split("/").filter(Boolean).pop() || "download";
      const headers = new Headers({
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Type": "application/octet-stream",
      });
      if (truncated) headers.set("X-Content-Truncated", "1");
      // Convert Buffer to Uint8Array for Response compatibility
      return new Response(new Uint8Array(content), { status: 200, headers });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// POST /servers/:serverId/files/upload — 上传/写文件（body: path + base64 content）
// ============================================================================

files.post(
  "/upload",
  requirePermission("server:update"),
  validateBody(UploadBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path, content } = c.get("validatedBody") as z.infer<
      typeof UploadBodySchema
    >;
    const buf = Buffer.from(content, "base64");
    if (buf.length > MAX_UPLOAD_SIZE) {
      throw ApiError.badRequest(`File size exceeds ${MAX_UPLOAD_SIZE} bytes`);
    }
    try {
      await writeFile(serverId, userId, path, buf);
      return c.json({ success: true, path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed") || msg.includes("exceeds limit")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// POST /servers/:serverId/files/mkdir — 新建目录
// ============================================================================

files.post(
  "/mkdir",
  requirePermission("server:update"),
  validateBody(MkdirBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path } = c.get("validatedBody") as z.infer<typeof MkdirBodySchema>;
    try {
      await createDirectory(serverId, userId, path);
      return c.json({ success: true, path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// POST /servers/:serverId/files/mkfile — 新建空文件
// ============================================================================

files.post(
  "/mkfile",
  requirePermission("server:update"),
  validateBody(MkfileBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path } = c.get("validatedBody") as z.infer<typeof MkfileBodySchema>;
    try {
      await createFile(serverId, userId, path);
      return c.json({ success: true, path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// PATCH /servers/:serverId/files/rename — 重命名/移动
// ============================================================================

files.patch(
  "/rename",
  requirePermission("server:update"),
  validateBody(RenameBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { from, to } = c.get("validatedBody") as z.infer<
      typeof RenameBodySchema
    >;
    try {
      await renamePath(serverId, userId, from, to);
      return c.json({ success: true, from, to });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// DELETE /servers/:serverId/files — 删除（query: path）
// ============================================================================

files.delete(
  "/",
  requirePermission("server:update"),
  validateQuery(PathQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path } = c.get("validatedQuery") as z.infer<typeof PathQuerySchema>;
    try {
      await deletePath(serverId, userId, path);
      return c.json({ success: true, path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

// ============================================================================
// PATCH /servers/:serverId/files/permissions — 修改权限
// ============================================================================

files.patch(
  "/permissions",
  requirePermission("server:update"),
  validateBody(PermissionsBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const serverId = c.req.param("serverId");
    await ensureServerAccess(c, serverId);
    const { path, mode } = c.get("validatedBody") as z.infer<
      typeof PermissionsBodySchema
    >;
    try {
      await setPermissions(serverId, userId, path, mode);
      return c.json({ success: true, path, mode });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No agent connected")) {
        throw ApiError.serverOffline();
      }
      if (msg.includes("Path not allowed") || msg.includes("Invalid mode")) {
        throw ApiError.badRequest(msg);
      }
      throw e;
    }
  },
);

export { files };
