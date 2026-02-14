# ServerPilot 官网改进任务队列

> 此队列专注于官网内容、体验、性能的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: 2026-02-15 07:35:40

## 📊 统计

- **总任务数**: 12
- **待完成** (pending): 10
- **进行中** (in_progress): 1
- **已完成** (completed): 1
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加发现的改进任务)
### [completed] 添加 favicon.svg 静态资源 ✅

**ID**: web-001
**优先级**: P0
**模块路径**: web/public/
**发现的问题**: `BaseLayout.astro:19` 引用了 `/favicon.svg`，但 `web/public/` 目录下没有任何文件（Glob 搜索返回空）。浏览器会报 404 错误，且标签页没有图标显示。
**改进方案**: 在 `web/public/` 下创建 `favicon.svg`，使用简洁的 ServerPilot 品牌图标（例如一个抽象的飞行器/方向盘 + 服务器组合图标），颜色使用品牌色 `#0284c7`（primary-600）。
**验收标准**: 浏览器标签页显示 favicon 图标；`pnpm build` 构建后 `dist/favicon.svg` 存在且可访问。
**影响范围**: `web/public/favicon.svg`（新建）
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 04:48:51

---

### [in_progress] 替换所有 GitHub 占位符 URL 为真实仓库地址

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

### [pending] 修复下载页无效锚点链接和注册按钮

**ID**: web-003
**优先级**: P0
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 中有 3 个无效的锚点链接：第 50 行 `#download-linux`、第 53 行 `#download-macos`、第 112 行 `#cloud-signup`——页面内没有对应的 `id` 元素，点击后无任何效果。定价页 `pricing.astro:103` 的"免费试用 14 天"按钮 `href="#"` 也无实际功能。`pricing.astro:157` 的"联系销售"按钮 `href="#contact"` 同样指向不存在的锚点。
**改进方案**: (1) 下载按钮改为指向真实下载地址或 GitHub Releases 页面（如 `https://github.com/xxx/serverpilot/releases/latest`）；(2) 云服务注册按钮如果产品未上线，改为"即将推出"禁用状态按钮，添加 `cursor-not-allowed opacity-50` 样式并移除 href；(3) 联系销售改为 `mailto:` 链接或标注即将推出。
**验收标准**: 所有按钮要么指向有效目标，要么明确显示为"即将推出"状态，不会出现点击无反应的情况。
**影响范围**: `web/src/pages/download.astro`, `web/src/pages/pricing.astro`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] 修复文档导航页所有链接指向 # 占位符

**ID**: web-004
**优先级**: P0
**模块路径**: web/src/pages/docs/
**发现的问题**: `docs/index.astro` 中共有 18 个 `href="#"` 占位链接（第 22-25、37-41、53-57、69-73、85-89、101-105、116-118、123-127、131-135 行），覆盖全部 6 个文档类别和 9 个快速链接。用户点击任何文档链接都不会发生任何有意义的导航。文档页是产品的核心引导入口，全部链接无效严重影响用户体验。
**改进方案**: 创建一个快速开始文档页面 `web/src/pages/docs/getting-started.astro`，包含系统要求、安装指南、首次配置的基础内容（可从 `download.astro` 中的安装步骤和 `web/GETTING_STARTED.md` 提取内容）。将文档导航页中"快速开始"类别下的链接指向该页面。其余尚未编写的文档链接改为带"即将推出"标记的禁用状态。
**验收标准**: 至少 1 个文档链接可以正常跳转到有内容的页面；其余链接有明确的"即将推出"视觉标记，不再是无反应的 `#` 链接。
**影响范围**: `web/src/pages/docs/index.astro`, `web/src/pages/docs/getting-started.astro`（新建）
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] BaseLayout 导航栏缺少移动端汉堡菜单

**ID**: web-005
**优先级**: P1
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:25` 中导航链接使用 `hidden md:flex`，在移动端（<768px）完全隐藏，但没有提供移动端的汉堡菜单替代方案。移动端用户无法访问"文档"、"下载"、"定价"、"GitHub"导航。右侧"开始使用"按钮（第 32 行）在移动端仍然显示，但其 `href="#"` 也是无效的。
**改进方案**: 添加一个简单的移动端汉堡菜单按钮（`md:hidden`），点击展开/折叠导航链接列表。使用纯 CSS（`<details>/<summary>` 或 checkbox hack）或最小化的 vanilla JS 实现，避免引入额外的客户端框架代码。同时修复"开始使用"按钮的 href 指向 `/download`。
**验收标准**: 移动端（<768px）可见汉堡菜单图标；点击后展开导航链接列表；导航链接可正常跳转。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/styles/global.css`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] 首页 Hero 区域缺少产品截图或演示

**ID**: web-006
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 首页 Hero 区域（第 7-18 行）只有标题、副标题和两个按钮，没有任何产品截图、终端演示或架构示意图。对于一个 DevOps 工具，用户无法直观理解产品的实际界面和工作方式。对比 Docker、Kubernetes 等优秀开源项目官网，都在首屏展示了产品界面或代码演示。
**改进方案**: 在 Hero 区域下方（CTA 按钮之后）添加一个模拟终端窗口，展示 ServerPilot AI 对话的示例交互（纯 HTML+CSS 实现，无需 JS）。内容类似：用户输入"帮我在 server-1 上安装 nginx" → AI 回复生成的操作步骤。使用 `bg-gray-900 text-green-400 font-mono` 终端风格。
**验收标准**: 首页 Hero 下方有一个终端样式的产品演示区块；内容展示了典型的 AI 对话交互；纯静态 HTML，不引入运行时 JS。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] BaseLayout header "开始使用"按钮 href 无效 + footer "关于"链接无效

**ID**: web-007
**优先级**: P1
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:32` 的"开始使用"按钮 `href="#"` 指向空锚点，点击无效果。Footer 中"关于我们"、"许可证"、"联系方式"三个链接（第 66-68 行）也都是 `href="#"`，同样无效。共 4 个无效链接影响用户导航。
**改进方案**: (1) "开始使用"按钮改为 `href="/download"`，与首页 CTA 一致。(2) "许可证"链接改为指向 GitHub 仓库的 LICENSE 文件 URL。(3) "关于我们"和"联系方式"如果暂无对应页面，暂时移除这两个链接项，避免死链接。保持 footer 简洁，只保留有实际内容的链接。
**验收标准**: Header "开始使用"按钮跳转到下载页；Footer 所有链接均指向有效目标或被移除；没有 `href="#"` 的占位链接。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] 首页缺少 meta description 和 Open Graph 标签

**ID**: web-008
**优先级**: P2
**模块路径**: web/src/pages/, web/src/layouts/
**发现的问题**: `index.astro:5` 调用 `<BaseLayout title="首页">` 时没有传 `description` 参数，使用了 `BaseLayout.astro:9` 的默认值 `'AI-Driven DevOps Platform'`（英文，与中文站点不一致）。所有页面都缺少 Open Graph 标签（og:title, og:description, og:image, og:type）和 Twitter Card 标签。社交媒体分享时无法显示预览卡片。
**改进方案**: (1) 为 `index.astro` 添加中文 `description` prop。(2) 在 `BaseLayout.astro` 的 `<head>` 中添加 Open Graph 和 Twitter Card meta 标签，使用 `title` 和 `description` 变量动态填充。(3) 将默认 description 改为中文。
**验收标准**: 每个页面有独立的 `<meta name="description">`；所有页面包含 og:title、og:description、og:type 标签；默认 description 为中文。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/pages/index.astro`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] Tailwind 主题色缺少 200/300/400/800/900 色阶

**ID**: web-009
**优先级**: P2
**模块路径**: web/
**发现的问题**: `tailwind.config.mjs` 只定义了 primary 色的 50、100、500、600、700 五个色阶（第 7-13 行），缺少 200、300、400、800、900 色阶。如果后续开发中使用 `primary-200` 等类名会得到透明色（无效值）。同时定价页中的多处 SVG 使用 `text-green-500` 硬编码颜色（如 `download.astro` 中 12 处、`pricing.astro` 中 16 处），没有统一为语义化的颜色 token。
**改进方案**: 补全 primary 色的全部色阶（200-400, 800-900），保持与 sky 蓝色系一致。考虑添加 `success` 语义色 token 映射到 green-500，提高可维护性。
**验收标准**: `tailwind.config.mjs` 中 primary 色有完整的 50-900 色阶；使用任何 `primary-*` 类名都能正确渲染颜色。
**影响范围**: `web/tailwind.config.mjs`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] 下载页和定价页大量重复的 SVG 勾选图标代码

**ID**: web-010
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 中相同的绿色勾选 SVG 图标（`<svg class="w-5 h-5 text-green-500 ...">` + checkmark path）重复出现 9 次（第 23-45 行、第 79-107 行）。`pricing.astro` 中同样的 SVG 重复出现 16 次（第 24-46、72-100、120-154 行）。两个文件总计 25 次完全相同的 SVG 代码块，每块约 4 行，共约 100 行重复代码。
**改进方案**: 创建一个简单的 Astro 组件 `web/src/components/CheckIcon.astro`，封装勾选图标 SVG。在 `download.astro` 和 `pricing.astro` 中引用该组件替换内联 SVG。组件保持简单，不过度抽象。
**验收标准**: `CheckIcon.astro` 组件创建完成；`download.astro` 和 `pricing.astro` 中无重复的勾选 SVG 代码；页面渲染效果不变。
**影响范围**: `web/src/components/CheckIcon.astro`（新建）, `web/src/pages/download.astro`, `web/src/pages/pricing.astro`
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] 生成 sitemap.xml 提升搜索引擎收录

**ID**: web-011
**优先级**: P3
**模块路径**: web/
**发现的问题**: `astro.config.mjs` 已配置 `site: 'https://serverpilot.ai'`（第 13 行），但没有启用 Astro 内置的 sitemap 集成。当前构建产物中不会生成 `sitemap.xml`，搜索引擎无法有效发现和索引所有页面。`public/` 下也没有 `robots.txt` 文件。
**改进方案**: (1) 安装 `@astrojs/sitemap` 并在 `astro.config.mjs` 中添加到 integrations 数组。(2) 在 `web/public/` 下创建 `robots.txt`，指向 sitemap 路径并允许所有爬虫访问。
**验收标准**: `pnpm build` 后 `dist/sitemap-index.xml` 和 `dist/sitemap-0.xml` 存在，包含所有页面 URL；`dist/robots.txt` 存在且引用了 sitemap。
**影响范围**: `web/astro.config.mjs`, `web/package.json`, `web/public/robots.txt`（新建）
**创建时间**: 2026-02-14
**完成时间**: -

---

### [pending] 下载页安装命令使用虚构域名 releases.serverpilot.ai

**ID**: web-012
**优先级**: P0
**模块路径**: web/src/pages/
**发现的问题**: `download.astro:133` 中快速安装步骤的 wget 命令使用了虚构的 URL `https://releases.serverpilot.ai/latest/serverpilot-linux-amd64.tar.gz`。这个域名并不存在，用户复制执行会直接失败。同时第 143-145 行的 `tar` 解压和 `./install.sh` 步骤也是基于假设的包格式。
**改进方案**: 将安装命令改为基于 GitHub Releases 的真实安装方式（与项目实际的构建产物一致），或使用 npm/pnpm 安装方式（如 `npx serverpilot` 或 `pnpm dlx serverpilot`），与项目的 Node.js 技术栈保持一致。如果发布流程尚未确定，改为更通用的"克隆仓库并安装"方式。
**验收标准**: 安装命令可实际执行或明确标注为示例；命令与项目实际安装方式一致。
**影响范围**: `web/src/pages/download.astro`
**创建时间**: 2026-02-14
**完成时间**: -


---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`

## 设计原则

- **简洁**: 避免过度设计，专注核心功能
- **实用**: 内容真实有用，不做空洞宣传
- **性能**: 静态生成，首屏加载快
- **易维护**: 清晰的目录结构，易于扩展
