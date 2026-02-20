// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 文件管理核心 — 路径校验与服务。
 *
 * @module core/file-manager
 */

export {
  normalizePath,
  isPathAllowed,
  validateAndNormalize,
} from "./path-validator.js";

export {
  MAX_UPLOAD_SIZE,
  listDirectory,
  readFileContent,
  downloadFile,
  writeFile,
  createDirectory,
  createFile,
  renamePath,
  deletePath,
  setPermissions,
} from "./file-manager-service.js";

export type {
  FileItem,
  ListResult,
  ReadResult,
} from "./file-manager-service.js";
