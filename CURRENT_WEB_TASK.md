### [pending] 替换所有 GitHub 占位符 URL 为真实仓库地址

**ID**: web-002
**优先级**: P0
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 中有 3 处 GitHub URL 使用 `yourusername` 占位符：第 30 行（导航栏）、第 58 行（社区-GitHub）、第 59 行（社区-讨论区）、第 60 行（问题反馈）。下载页 `download.astro:56` 也有同样的占位符 `https://github.com/yourusername/serverpilot`。用户点击后会跳转到不存在的页面。
**改进方案**: 将所有 `yourusername` 替换为实际的 GitHub 用户名/组织名。如果仓库尚未公开，改为统一的占位提示（如 `#github-coming-soon`）并添加 HTML 注释标记待替换位置，避免用户误点击跳转到 404。
**验收标准**: 所有 GitHub 链接指向有效地址或明确的占位符，不再出现 `yourusername` 文本。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/pages/download.astro`
**创建时间**: 2026-02-14
**完成时间**: -

---
