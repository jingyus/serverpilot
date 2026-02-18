### [pending] README.md 技术栈描述与实际项目状态不一致 — 声称使用 React 和 content 目录

**ID**: web-048
**优先级**: P1
**模块路径**: web/
**发现的问题**: `README.md` 第 8 行声称技术栈包含 "React 18"，第 42 行将 `components/` 目录标注为 "React 组件"，第 43 行声称存在 `content/` 目录用于 "Markdown 文档内容"。但实际上：(1) React 依赖已在 web-046 中被移除，`astro.config.mjs` 不再包含 React 集成，所有组件均为 `.astro` 文件；(2) `src/content/` 目录根本不存在；(3) 项目结构中缺少 `404.astro`、`docs/getting-started.astro` 等已存在的页面文件。"待补充内容" 列表（第 58-65 行）中的 5 项已全部在之前的任务中完成（favicon、GitHub 链接、下载链接等），但仍标注为待办，给新贡献者传递错误信息。
**改进方案**: (1) 技术栈中移除 "React 18" 改为 "Astro 组件"；(2) 将 `components/` 标注改为 "Astro 组件"；(3) 移除 `content/` 目录的引用（项目未使用 content collections）；(4) 更新项目结构树，添加 `404.astro`、`docs/getting-started.astro`、`components/CheckIcon.astro`、`components/CodeBlock.astro`；(5) 删除或更新"待补充内容"列表，反映当前实际状态。
**验收标准**: README 技术栈描述与 `package.json` 和 `astro.config.mjs` 实际配置一致；项目结构树反映真实的文件目录；无过时的待办列表。
**影响范围**: `web/README.md`
**创建时间**: 2026-02-15
**完成时间**: -

---
