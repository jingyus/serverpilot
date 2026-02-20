// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 文件管理服务 — 通过 Agent 执行 list/read/write/mkdir/rename/delete/chmod。
 *
 * 所有操作经 TaskExecutor 发往目标服务器的 Agent，不依赖 FTP。
 *
 * @module core/file-manager/file-manager-service
 */

import { createContextLogger } from "../../utils/logger.js";
import { findConnectedAgent } from "../agent/agent-connector.js";
import { getTaskExecutor } from "../task/executor.js";
import { validateAndNormalize } from "./path-validator.js";

const logger = createContextLogger({ module: "file-manager" });

/** 单文件上传大小上限（字节），超过建议走 SFTP */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

/** 列表项：名称、是否目录、大小、修改时间、权限、用户、组 */
export interface FileItem {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
  mode: string;
  uid: number;
  gid: number;
}

/** 列表结果（支持分页） */
export interface ListResult {
  items: FileItem[];
  total: number;
  path: string;
}

/** 读文件结果 */
export interface ReadResult {
  content: string;
  path: string;
}

/**
 * Shell 转义路径（单引号包裹，内部 ' 转为 '\''）。
 */
function shellEscapePath(path: string): string {
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

/**
 * 执行远程命令，无 Agent 或失败时抛出或返回错误信息。
 */
async function runCommand(
  serverId: string,
  userId: string,
  command: string,
  description: string,
  riskLevel: "green" | "yellow" | "red" = "green",
  timeoutMs = 30_000,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const clientId = findConnectedAgent(serverId);
  if (!clientId) {
    throw new Error("No agent connected for this server");
  }
  const executor = getTaskExecutor();
  const result = await executor.executeCommand({
    serverId,
    userId,
    clientId,
    command,
    description,
    riskLevel,
    type: "execute",
    timeoutMs,
  });
  return {
    success: result.success && result.exitCode === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error ?? "",
  };
}

/**
 * 列出目录内容（结构化）。使用 Python 输出 JSON，便于跨平台。
 */
export async function listDirectory(
  serverId: string,
  userId: string,
  rawPath: string,
  page = 1,
  pageSize = 100,
): Promise<ListResult> {
  const path = validateAndNormalize(rawPath);
  const pathEsc = shellEscapePath(path);
  // Python 脚本：扫描目录并输出 JSON
  const script = [
    "import os, json, sys",
    "p = sys.argv[1]",
    "if not os.path.isdir(p):",
    '  print(json.dumps({"error": "not a directory", "path": p}))',
    "  sys.exit(1)",
    "out = []",
    "for e in os.scandir(p):",
    "  s = e.stat()",
    '  out.append({"name": e.name, "dir": e.is_directory(), "size": s.st_size, "mtime": int(s.st_mtime), "mode": oct(s.st_mode)[-4:], "uid": s.st_uid, "gid": s.st_gid})',
    "print(json.dumps(out))",
  ].join("; ");
  const command = `python3 -c ${JSON.stringify(script)} ${pathEsc}`;
  const { success, stdout, stderr } = await runCommand(
    serverId,
    userId,
    command,
    `List directory: ${path}`,
  );

  if (!success) {
    try {
      const errJson = JSON.parse(stdout || stderr);
      if (errJson.error === "not a directory") {
        throw new Error("Path is not a directory");
      }
    } catch (_) {
      // ignore parse error
    }
    throw new Error(stderr || stdout || "List directory failed");
  }

  let items: FileItem[] = [];
  try {
    items = JSON.parse(stdout) as FileItem[];
  } catch {
    throw new Error("Invalid list output from agent");
  }

  const total = items.length;
  const start = (page - 1) * pageSize;
  const paginated = items.slice(start, start + pageSize);

  return { items: paginated, total, path };
}

/**
 * 读取文件内容（文本）。大文件只读前 512KB。
 */
export async function readFileContent(
  serverId: string,
  userId: string,
  rawPath: string,
  maxBytes = 512 * 1024,
): Promise<ReadResult> {
  const path = validateAndNormalize(rawPath);
  const pathEsc = shellEscapePath(path);
  // 使用 head -c 限制读取大小，避免大文件拖垮内存
  const command = `head -c ${maxBytes} ${pathEsc}`;
  const { success, stdout, stderr } = await runCommand(
    serverId,
    userId,
    command,
    `Read file: ${path}`,
  );
  if (!success) {
    throw new Error(stderr || stdout || "Read file failed");
  }
  return { content: stdout, path };
}

/**
 * 下载文件：经 base64 传输保证二进制正确，超过 maxBytes 截断。
 */
export async function downloadFile(
  serverId: string,
  userId: string,
  rawPath: string,
  maxBytes = 10 * 1024 * 1024,
): Promise<{ content: Buffer; truncated: boolean }> {
  const path = validateAndNormalize(rawPath);
  const pathEsc = shellEscapePath(path);
  const command = `head -c ${maxBytes} ${pathEsc} | base64`;
  const { success, stdout, stderr } = await runCommand(
    serverId,
    userId,
    command,
    `Download file: ${path}`,
    "green",
    60_000,
  );
  if (!success) {
    throw new Error(stderr || stdout || "Download failed");
  }
  const buf = Buffer.from(stdout.trim(), "base64");
  const truncated = buf.length >= maxBytes;
  return { content: buf, truncated };
}

/**
 * 上传/写入文件。小内容用 printf，大内容用 base64 -d。
 */
export async function writeFile(
  serverId: string,
  userId: string,
  rawPath: string,
  content: Buffer | string,
): Promise<void> {
  const path = validateAndNormalize(rawPath);
  if (content.length > MAX_UPLOAD_SIZE) {
    throw new Error(`File size exceeds limit (${MAX_UPLOAD_SIZE} bytes)`);
  }
  const pathEsc = shellEscapePath(path);
  const buf =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const isBinary =
    buf.length > 0 &&
    buf.some((b) => b < 32 && b !== 9 && b !== 10 && b !== 13);
  let command: string;
  if (!isBinary && buf.length < 32 * 1024) {
    const escaped = buf
      .toString("utf8")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "'\\''");
    command = `printf '%s' '${escaped}' > ${pathEsc}`;
  } else {
    const b64 = buf.toString("base64");
    command = `echo ${JSON.stringify(b64)} | base64 -d > ${pathEsc}`;
  }
  const { success, stderr } = await runCommand(
    serverId,
    userId,
    command,
    `Write file: ${path}`,
    "yellow",
    60_000,
  );
  if (!success) {
    throw new Error(stderr || "Write file failed");
  }
  logger.info({ serverId, userId, path }, "File written via file-manager");
}

/**
 * 新建目录。
 */
export async function createDirectory(
  serverId: string,
  userId: string,
  rawPath: string,
): Promise<void> {
  const path = validateAndNormalize(rawPath);
  const pathEsc = shellEscapePath(path);
  const { success, stderr } = await runCommand(
    serverId,
    userId,
    `mkdir -p ${pathEsc}`,
    `Create directory: ${path}`,
    "yellow",
  );
  if (!success) {
    throw new Error(stderr || "Create directory failed");
  }
}

/**
 * 新建空文件。
 */
export async function createFile(
  serverId: string,
  userId: string,
  rawPath: string,
): Promise<void> {
  const path = validateAndNormalize(rawPath);
  const pathEsc = shellEscapePath(path);
  const { success, stderr } = await runCommand(
    serverId,
    userId,
    `touch ${pathEsc}`,
    `Create file: ${path}`,
    "yellow",
  );
  if (!success) {
    throw new Error(stderr || "Create file failed");
  }
}

/**
 * 重命名/移动。
 */
export async function renamePath(
  serverId: string,
  userId: string,
  rawFrom: string,
  rawTo: string,
): Promise<void> {
  const fromPath = validateAndNormalize(rawFrom);
  const toPath = validateAndNormalize(rawTo);
  const fromEsc = shellEscapePath(fromPath);
  const toEsc = shellEscapePath(toPath);
  const { success, stderr } = await runCommand(
    serverId,
    userId,
    `mv ${fromEsc} ${toEsc}`,
    `Rename: ${fromPath} -> ${toPath}`,
    "yellow",
  );
  if (!success) {
    throw new Error(stderr || "Rename failed");
  }
}

/**
 * 删除文件或目录（非回收站，直接 rm -rf）。
 */
export async function deletePath(
  serverId: string,
  userId: string,
  rawPath: string,
): Promise<void> {
  const path = validateAndNormalize(rawPath);
  const pathEsc = shellEscapePath(path);
  const { success, stderr } = await runCommand(
    serverId,
    userId,
    `rm -rf ${pathEsc}`,
    `Delete: ${path}`,
    "red",
  );
  if (!success) {
    throw new Error(stderr || "Delete failed");
  }
  logger.info({ serverId, userId, path }, "Path deleted via file-manager");
}

/**
 * 修改权限（chmod）。mode 如 "755"、"644"。
 */
export async function setPermissions(
  serverId: string,
  userId: string,
  rawPath: string,
  mode: string,
): Promise<void> {
  const path = validateAndNormalize(rawPath);
  if (!/^[0-7]{3,4}$/.test(mode)) {
    throw new Error("Invalid mode; use octal e.g. 755 or 644");
  }
  const pathEsc = shellEscapePath(path);
  const { success, stderr } = await runCommand(
    serverId,
    userId,
    `chmod ${mode} ${pathEsc}`,
    `Chmod ${mode}: ${path}`,
    "yellow",
  );
  if (!success) {
    throw new Error(stderr || "Chmod failed");
  }
}
