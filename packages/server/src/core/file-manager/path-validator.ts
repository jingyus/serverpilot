// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 文件管理路径校验 — 白名单与危险路径禁止。
 *
 * 所有文件 API 的 path 必须通过校验，防止访问 /etc/shadow、/root 等敏感路径。
 *
 * @module core/file-manager/path-validator
 */

import { createContextLogger } from "../../utils/logger.js";

const logger = createContextLogger({ module: "file-manager-path" });

/** 默认允许的根路径前缀（可配置扩展） */
const DEFAULT_ALLOWED_ROOTS = [
  "/home",
  "/var",
  "/tmp",
  "/opt",
  "/usr/local",
  "/srv",
];

/** 禁止的路径片段（任意位置出现即拒绝） */
const FORBIDDEN_SEGMENTS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".config",
  "shadow",
  "passwd",
  "sudoers",
  "sudoers.d",
]);

/**
 * 解析并规范化路径为绝对路径（不访问文件系统，仅字符串处理）。
 * 移除多余斜杠与 .. 并保证以 / 开头。
 */
export function normalizePath(raw: string): string {
  if (!raw || typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const segments = trimmed
    .split(/\/+/)
    .filter((s) => s.length > 0 && s !== ".");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return "/" + resolved.join("/");
}

/**
 * 校验路径是否在允许的根路径之下，且不包含禁止片段。
 *
 * @param path - 已规范化的绝对路径
 * @param allowedRoots - 允许的根路径列表，默认 DEFAULT_ALLOWED_ROOTS
 * @returns 校验通过返回 true；否则 false
 */
export function isPathAllowed(
  path: string,
  allowedRoots: string[] = DEFAULT_ALLOWED_ROOTS,
): boolean {
  const normalized = normalizePath(path);
  // 根目录不允许直接列出
  if (normalized === "/") return false;

  const segments = normalized.split("/").filter(Boolean);
  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      logger.warn(
        { path: normalized, segment: seg },
        "Path rejected: forbidden segment",
      );
      return false;
    }
  }

  const allowed = allowedRoots.some((root) => {
    if (root === "/") return true;
    return normalized === root || normalized.startsWith(root + "/");
  });

  if (!allowed) {
    logger.warn(
      { path: normalized, allowedRoots },
      "Path rejected: not under allowed root",
    );
  }
  return allowed;
}

/**
 * 校验路径并返回规范化路径；若不允许则抛出 Error。
 */
export function validateAndNormalize(
  rawPath: string,
  allowedRoots?: string[],
): string {
  const normalized = normalizePath(rawPath);
  if (!isPathAllowed(normalized, allowedRoots)) {
    throw new Error(`Path not allowed: ${rawPath}`);
  }
  return normalized;
}
