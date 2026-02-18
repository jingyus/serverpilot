# ServerPilot 官网改进任务队列

> 此队列专注于官网内容、体验、性能的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: 2026-02-15 15:28:13

## 📊 统计

- **总任务数**: 62
- **待完成** (pending): 14
- **进行中** (in_progress): 1
- **已完成** (completed): 47
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加发现的改进任务)
### [in_progress] README.md 技术栈描述与实际项目状态不一致 — 声称使用 React 和 content 目录

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

### [pending] 定价页基础版 "推荐" 标签指向无法购买的产品 — 与开源版形成认知矛盾

**ID**: web-049
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `pricing.astro` 第 65-67 行，基础版（¥99/月）使用 `border-2 border-primary-500` 高亮边框和 "推荐" 标签，但该方案显示为 "即将推出"（第 103-105 行），用户无法购买或注册。视觉上最突出的卡片用户无法操作，而当前唯一可用的开源版（第 31 行）仅有普通 `border` 边框，视觉权重最低。web-045 在 `download.astro` 中已修复了同样的问题（将推荐标签移到了开源版），但 `pricing.astro` 未同步修改，两个页面的推荐策略不一致：下载页推荐开源版，定价页推荐不可用的基础版。
**改进方案**: (1) 将 "推荐" 标签和高亮边框 (`border-2 border-primary-500`) 从基础版移到开源版；(2) 基础版改为普通 `border` 边框；(3) 与 download.astro 保持一致的推荐策略：当前阶段推荐可用的开源版。
**验收标准**: 定价页开源版有 "推荐" 标签和高亮边框；基础版视觉权重降低；推荐策略与下载页一致。
**影响范围**: `web/src/pages/pricing.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 首页特性 section 与 "开源 & 多 AI 支持" section 之间缺少视觉分隔

**ID**: web-050
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 130-169 行的 "核心特性" section 和第 172-211 行的 "开源 & 多 AI 支持" section 之间，只有后者使用了 `border-t`（第 173 行）做分隔。但 "核心特性" section 自身没有背景色（白色），"开源 & 多 AI 支持" section 也没有背景色，两个 section 之间的视觉分界仅靠一条细线。CTA section 使用了 `bg-primary-50`（第 214 行）形成明显的视觉区块。三个 section 的视觉节奏为：白底 → 细线 → 白底 → 蓝底，中间两个白底 section 区分度不够，尤其在滚动浏览时用户可能感知为同一个 section。
**改进方案**: 给 "核心特性" section（第 131 行）添加浅灰色背景 `bg-gray-50`，形成白底（Hero）→ 灰底（特性）→ 白底（开源 & AI）→ 蓝底（CTA）的交替节奏，增强页面的视觉层次感。同时移除 "开源 & 多 AI 支持" section 的 `border-t`，因为背景色变化已经提供了足够的分隔。
**验收标准**: 首页滚动浏览时，各 section 之间有明显的视觉区分；背景色交替使用白色和浅灰色。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] getting-started.astro 面包屑导航缺少 "首页" 入口 — 与其他页面不一致

**ID**: web-051
**优先级**: P2
**模块路径**: web/src/pages/docs/
**发现的问题**: `getting-started.astro` 第 22-25 行的面包屑导航只有两级：`文档 / 快速开始`，缺少 "首页" 链接。而 `download.astro` 第 21-24 行、`pricing.astro` 第 20-23 行、`docs/index.astro` 第 19-22 行的面包屑导航都以 "首页" 开头：`首页 / 下载`、`首页 / 定价`、`首页 / 文档`。同时 `getting-started.astro` 的 BreadcrumbList 结构化数据（第 9-16 行）是三级的：`首页 → 文档 → 快速开始`，视觉面包屑和结构化数据不一致。用户在 getting-started 页面上无法通过面包屑直接返回首页，只能点 "文档" 然后再找首页链接。
**改进方案**: 在 `getting-started.astro` 第 22 行面包屑前添加 "首页" 链接，使导航变为 `首页 / 文档 / 快速开始`，与其他页面和 BreadcrumbList 结构化数据保持一致。
**验收标准**: getting-started 页面面包屑显示三级：`首页 / 文档 / 快速开始`；与 BreadcrumbList JSON-LD 数据一致；样式与其他页面面包屑统一。
**影响范围**: `web/src/pages/docs/getting-started.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 404 页面缺少 meta 标签指示非索引 — 搜索引擎可能收录错误页面

**ID**: web-052
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `404.astro` 使用了 `BaseLayout`（第 12 行），但没有设置 `<meta name="robots" content="noindex">` 标签。虽然 Astro 在 static 模式下生成的 404 页面通常由 Web 服务器在 HTTP 404 状态码下返回，搜索引擎一般不会收录。但部分 CDN/托管平台（如 Cloudflare Pages、Vercel）在某些边界情况下可能以 200 状态码返回自定义 404 页面的内容（soft 404），导致搜索引擎误收录。此外，`BaseLayout` 的 `og:type` 硬编码为 `website`（第 42 行），404 页面的 OG 数据也会被社交平台抓取，显示 "页面未找到 - ServerPilot" 的预览卡片，并不理想。
**改进方案**: (1) 给 `BaseLayout` 添加一个可选的 `noindex` boolean prop；(2) 在 404 页面传入 `noindex={true}`；(3) `BaseLayout` 中条件渲染 `<meta name="robots" content="noindex, nofollow">`。这样既保持 BaseLayout 的通用性，又避免 404 页面被搜索引擎收录。
**验收标准**: 404 页面 HTML 中包含 `<meta name="robots" content="noindex, nofollow">`；其他页面不受影响。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/pages/404.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 首页 Hero 的 "查看文档" 按钮指向文档导航页而非最有价值的快速开始页

**ID**: web-053
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 61 行 Hero 区的 "查看文档" 按钮指向 `/docs`（文档导航页），该页面的 6 个卡片中只有 "快速开始" 是真正有内容的，其余 5 个都是 "即将推出"。用户点击 "查看文档" 后看到的主要是一个几乎空的导航页面，需要再点一次才能到达有实际内容的 `/docs/getting-started`。相比之下，底部 CTA 的 "阅读文档" 按钮（第 222 行）已经直接指向 `/docs/getting-started`，更符合用户预期。两处按钮的目标不一致：一个指向空导航页，一个指向内容页。
**改进方案**: 将 Hero 区 "查看文档" 按钮（第 61 行）的 `href` 从 `/docs` 改为 `/docs/getting-started`，让用户直接到达有实质内容的快速开始页面，减少一次无意义的跳转。文档导航页仍可通过导航栏的 "文档" 链接访问。
**验收标准**: Hero 区 "查看文档" 按钮指向 `/docs/getting-started`；用户从首页点击后直接看到安装指南内容。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 定价页 FAQ "如何从开源版迁移到云服务版" 描述已有功能但云服务尚未上线

**ID**: web-054
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `pricing.astro` 第 180-183 行 FAQ 回答 "我们提供完整的迁移工具和文档，技术团队会协助您完成数据迁移，确保业务平滑过渡"，使用现在时态描述迁移工具和技术支持。但云服务版标注为 "即将推出"，迁移工具和文档自然也不存在。web-043 修复了 "试用" 和 "支付方式" 的时态问题（改为将来时），但这条 FAQ 被遗漏了。对应的 FAQPage 结构化数据（第 218-224 行）同样使用现在时态，会通过 Google 搜索摘要传播这些不实信息。
**改进方案**: 将 FAQ 回答改为将来时态："云服务版上线后，我们将提供完整的迁移工具和文档...确保平滑过渡。"同步更新 JSON-LD 结构化数据中对应的 `acceptedAnswer.text`。
**验收标准**: FAQ 回答和结构化数据中关于迁移的描述使用将来时态；与其他 FAQ 的时态处理一致。
**影响范围**: `web/src/pages/pricing.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] BaseLayout footer "贡献指南" 链接指向可能不存在的 CONTRIBUTING.md 路径

**ID**: web-055
**优先级**: P2
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 第 168 行 Footer "贡献指南" 链接指向 `${GITHUB_REPO}/blob/master/CONTRIBUTING.md`。项目根目录确实存在 `CONTRIBUTING.md` 文件，但链接使用的分支名是 `master`。Git status 显示当前分支是 `feat/edition-split-20260215`，主分支名称也是 `master`，这没有问题。但 Footer "许可证" 链接（第 166 行）和版权声明（第 173 行）也都使用 `blob/master/LICENSE`。需要确认 `LICENSE` 文件是否存在于仓库 master 分支的根目录。此外，"更新日志" 指向 `${GITHUB_REPO}/releases`（第 167 行），如果 GitHub Releases 页面为空（项目未发布任何 Release），用户会看到空页面。
**改进方案**: (1) 确认 master 分支上 `LICENSE` 和 `CONTRIBUTING.md` 文件存在（通过 Glob 检查本地文件）。(2) 如果 GitHub Releases 为空，将 "更新日志" 链接暂时改为指向 `${GITHUB_REPO}/commits/master`（提交历史），等有正式 Release 后再改回。或在链接文字后添加一个小标注 "(GitHub)" 以设置用户预期。
**验收标准**: Footer 所有链接指向的目标文件确认存在；"更新日志" 链接在无 Release 时也有合理的内容展示。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 首页 Terminal Demo 中 sudo systemctl enable 命令缺少安全确认步骤 — 安全演示不完整

**ID**: web-056
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 93-106 行已添加了 `sudo apt install` 的安全确认步骤（web-037 完成），但第 117 行的 `sudo systemctl enable --now nginx` 命令同样是 sudo 操作，却没有安全确认提示直接显示为 `✓` 完成。根据产品的 5 级风险分类系统，`systemctl enable` 属于系统服务管理命令，至少应为 YELLOW 级别。Demo 选择性地只展示一次安全确认，给用户的印象是 "AI 只确认第一条 sudo 命令，后续 sudo 命令直接执行"，这与产品实际行为可能不一致。同时第 113 行 "生成 /etc/nginx/sites-available/app.conf" 是文件写入操作，属于 ORANGE 级别，也没有确认步骤。
**改进方案**: 在 `sudo systemctl enable --now nginx`（第 115-118 行）前也添加一个简化的安全确认标记，可以比第一次更简洁（例如只显示 `⚠ YELLOW · 已确认` 的单行版本），避免 Demo 变得过长。这样展示了 "每条高风险命令都需要确认" 的完整安全机制。或者移除当前第 117 行的 systemctl 步骤以简化 Demo，只保留安装和配置两步。
**验收标准**: Terminal Demo 中所有 sudo 操作都有相应的安全确认标记，或 Demo 简化为只展示有确认步骤的命令；Demo 不给用户留下 "部分 sudo 命令不需要确认" 的错误印象。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 文档导航页快速链接 "添加第一台服务器" 锚点文案与实际章节标题不匹配

**ID**: web-057
**优先级**: P3
**模块路径**: web/src/pages/docs/
**发现的问题**: `docs/index.astro` 第 149 行快速链接 "→ 添加第一台服务器" 指向 `/docs/getting-started#first-setup`。但 `getting-started.astro` 中 `#first-setup` 锚点对应的章节标题是 "3. 首次配置"（第 174 行），子章节是 "3.1 注册管理员账号" → "3.2 添加服务器" → "3.3 开始 AI 对话"。链接文案暗示用户会直接看到 "添加服务器" 的操作步骤，但实际上锚点跳转到的是 "首次配置" 大章节的开头（先讲注册管理员）。更准确的链接应该是指向 "注册管理员账号" 或修改文案为 "首次配置"。
**改进方案**: 将快速链接文案从 "添加第一台服务器" 改为 "首次配置"，与锚点 `#first-setup` 对应的实际章节标题一致。这样用户的预期与实际跳转目标匹配。
**验收标准**: 快速链接文案准确反映锚点目标内容；用户点击后看到的章节标题与链接文案一致。
**影响范围**: `web/src/pages/docs/index.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] download.astro "从源码构建 Docker 镜像" 引用的 docker-compose.build.yml 命令未验证可用性

**ID**: web-058
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 第 167 行的 "从源码构建 Docker 镜像" 方式引用了命令 `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`。Grep 搜索确认 `docker-compose.build.yml` 文件在项目根目录存在，但 git status 显示 `docker-compose.ce.yml` 和 `docker-compose.ee.yml` 已被删除（`D` 状态），说明 Docker 配置正在经历版本分拆重构。`docker-compose.build.yml` 的内容可能已经过时或与当前的 `docker-compose.yml` 不兼容。此外，这个长命令（`-f ... -f ... up -d --build`）没有包裹在 `<code>` 标签内，而是直接嵌入文本段落中，用户可能不清楚哪部分是可执行命令。
**改进方案**: (1) 将这条命令用 `<code>` 标签包裹，与页面其他代码引用的样式保持一致（当前已有 `bg-gray-100 px-1.5 py-0.5 rounded text-xs text-gray-800` 样式）。(2) 添加一句说明 "具体构建命令请参考仓库 README" 作为兜底，避免命令过时时用户直接报错。
**验收标准**: "从源码构建" 命令有 `<code>` 样式包裹；有适当的文档引用兜底说明。
**影响范围**: `web/src/pages/download.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 全站缺少 preconnect/dns-prefetch 优化 — 外部资源加载延迟

**ID**: web-059
**优先级**: P3
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 的 `<head>` 中（第 34-51 行）没有任何 `<link rel="preconnect">` 或 `<link rel="dns-prefetch">` 标签。网站引用了 `github.com` 的外链（导航栏、Footer 共 7+ 处），用户首次点击 GitHub 链接时需要进行 DNS 查询和 TLS 握手。对于静态站点而言，添加对频繁跳转的外部域名的 DNS 预解析可以减少约 100-300ms 的导航延迟。此外，如果后续添加 Google Analytics 或字体服务等外部资源，preconnect 的效果会更明显。
**改进方案**: 在 `BaseLayout.astro` 的 `<head>` 中添加 `<link rel="dns-prefetch" href="https://github.com">` 用于 GitHub 域名的 DNS 预解析。不需要 `preconnect` 因为 GitHub 链接是用户主动点击而非自动加载。
**验收标准**: `BaseLayout.astro` head 中包含 GitHub 域名的 `dns-prefetch`；不影响页面首屏渲染性能。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] global.css 中 btn-primary 和 btn-secondary 组件类缺少 focus 样式 — 键盘无障碍访问不完整

**ID**: web-060
**优先级**: P3
**模块路径**: web/src/styles/
**发现的问题**: `global.css` 第 21-28 行定义了 `.btn-primary` 和 `.btn-secondary` 组件类，只有 `hover` 状态样式，没有 `focus` 或 `focus-visible` 样式。使用键盘 Tab 导航到这些按钮时，没有可见的焦点指示器（浏览器默认的蓝色 outline 会被 Tailwind 的 CSS reset 移除）。这影响了键盘用户和使用屏幕阅读器的用户的无障碍访问体验。全站共有 20+ 个使用这两个类的按钮/链接（首页 4 个、下载页 4 个、定价页 4 个、导航栏 1 个、移动菜单 1 个、404 页面 1 个等）。
**改进方案**: 给 `.btn-primary` 和 `.btn-secondary` 添加 `focus-visible` 样式：`focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`，primary 使用 `focus-visible:outline-primary-600`，secondary 使用 `focus-visible:outline-gray-400`。使用 `focus-visible` 而非 `focus` 可以避免鼠标点击时也显示 outline。
**验收标准**: 键盘 Tab 导航到按钮时有可见的焦点 outline；鼠标点击不触发 outline（`focus-visible`）；样式与按钮颜色协调。
**影响范围**: `web/src/styles/global.css`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] CodeBlock 组件的复制按钮在移动端无法通过 hover 触发显示

**ID**: web-061
**优先级**: P3
**模块路径**: web/src/components/
**发现的问题**: `CodeBlock.astro` 第 18 行复制按钮使用 `opacity-0 group-hover:opacity-100` 来控制可见性——桌面端鼠标悬停时显示，移动端因为没有 hover 事件，复制按钮永远处于 `opacity-0` 不可见状态。`download.astro` 和 `getting-started.astro` 各有 5 个 CodeBlock 实例，移动端用户在这些页面上完全看不到复制按钮，只能手动长按选择文本。移动端是安装指南页面的重要访问场景（用户在手机上查看命令，再到电脑上执行）。
**改进方案**: 修改复制按钮的显示逻辑：移除 `opacity-0 group-hover:opacity-100`，改为始终可见但低调的样式——使用较低的默认透明度 `opacity-60`，hover 时变为 `opacity-100`。或者使用媒体查询方案：在移动端始终显示（`md:opacity-0 md:group-hover:opacity-100`），桌面端保持 hover 显示。
**验收标准**: 移动端用户可以看到并使用复制按钮；桌面端保持 hover 显示的交互模式；按钮在非 hover 状态不过于喧宾夺主。
**影响范围**: `web/src/components/CodeBlock.astro`
**创建时间**: 2026-02-15
**完成时间**: -

---

### [pending] 首页 AI 提供商卡片缺少 Ollama "本地部署" 的差异化视觉标识

**ID**: web-062
**优先级**: P3
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 181-187 行展示 4 个 AI 提供商卡片，使用完全相同的样式（`border rounded-lg p-5 text-center hover:border-primary-400`）。但 Ollama 与其他三个提供商有本质区别：Claude/OpenAI/DeepSeek 是云 API 服务（需要 API Key + 网络连接），而 Ollama 是本地部署方案（无需 API Key、完全离线、数据不出本地）。这个差异是产品的重要卖点（数据隐私），在特性描述第 142 行也强调了 "完全掌控数据隐私"。但卡片视觉上没有体现这一差异，用户无法快速感知 Ollama 的特殊定位。
**改进方案**: 给 Ollama 卡片的描述 "本地部署" 添加一个小标签或图标，例如在 "本地部署" 文字前加一个锁定图标（🔒 或 SVG），或给卡片添加一个 "隐私优先" 的小 badge。保持简洁，不过度设计。
**验收标准**: Ollama 卡片与云 API 提供商卡片有视觉区分；"本地部署/数据隐私" 的差异一目了然。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: -

### [completed] 首页 CTA 区块 "选择适合你的版本" 文案与定价页重复且缺乏差异化 ✅

**ID**: web-036
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 210-221 行的 CTA 区块标题 "选择适合你的版本"，描述 "开源版本免费使用，云服务版本提供托管服务和企业级支持" 与 `pricing.astro` 定价页内容高度重复。两个按钮 "下载开源版" 和 "查看云服务" 指向 `/download` 和 `/pricing`，但首页已经有 Hero 区的 "立即下载" 和 "查看文档" 两个 CTA 按钮（第 71-72 行）。首页两处 CTA 都指向下载页，意图重叠。更大的问题是云服务版 "即将推出"，将用户引导到定价页看到一个灰色不可点击的按钮，用户体验断裂。
**改进方案**: 将首页底部 CTA 区块改为更面向行动的文案，例如 "开始使用 ServerPilot"，强调开源免费 + 快速上手。将两个按钮改为 "快速安装" (→ /download) 和 "阅读文档" (→ /docs/getting-started)，与 Hero 区域形成"了解 → 深入 → 行动"的递进关系，而非重复。
**验收标准**: 首页底部 CTA 与 Hero CTA 文案不重复；按钮指向对用户最有价值的下一步操作；不再将用户引导到 "即将推出" 的死胡同。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:03:05

---

### [completed] 首页 Terminal Demo 的 AI 回复缺少安全确认步骤 — 产品核心差异未体现 ✅

**ID**: web-037
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 86-121 行的 Terminal Demo 展示了 AI 直接执行 `sudo apt install` 和 `sudo systemctl enable` 等高权限命令的过程，中间没有展示任何安全确认环节。这与首页特性描述 "所有命令按风险自动分为 5 个等级...高风险操作需人工确认后才会执行"（第 149-151 行）矛盾。Demo 给人的第一印象是 AI 会不经确认地执行 sudo 命令，反而可能引起安全顾虑，削弱了产品最大的差异化优势——安全可控。
**改进方案**: 在 Terminal Demo 的执行步骤中，在 `sudo apt install` 之前插入一个安全确认步骤，例如显示 `⚠ 中风险操作：需要确认` + `[确认执行]` 的模拟交互，然后才显示执行成功。这能直观展示产品的安全机制，比纯文字描述更有说服力。
**验收标准**: Terminal Demo 中包含至少一个安全风险提示/确认步骤；Demo 内容与特性描述中的安全机制一致；纯 HTML 实现，无 JS。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:05:15

---

### [completed] download.astro 的 "从源码构建" 区块与 getting-started 高度重复且指令可能过时 ✅

**ID**: web-038
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 第 165-172 行有一个 "从源码构建" 区块，展示了 `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` 命令。但项目 git status 显示 `docker-compose.ce.yml` 和 `docker-compose.ee.yml` 已被删除（`D` 状态），说明 Docker Compose 配置可能正在重构。同时第 174-176 行底部有链接指向 `/docs/getting-started`（开发环境快速开始），再加上上方的 Docker 快速安装步骤，下载页总共展示了三种安装方式（Docker 快速启动、源码构建、开发环境），层次不够清晰。`docker-compose.build.yml` 文件是否仍然存在也需要确认。
**改进方案**: (1) 确认 `docker-compose.build.yml` 是否仍在项目中，如果已被删除则更新命令。(2) 将 "从源码构建" 和底部 "开发环境" 引用合并为一个简洁的 "其他安装方式" 小节，用简短文字 + 链接代替重复的代码块。保持下载页聚焦于主推的 Docker 一键部署方式。
**验收标准**: 下载页安装命令与项目实际可用的 Docker Compose 文件一致；页面层次清晰，主推方式突出，其他方式简要提及。
**影响范围**: `web/src/pages/download.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:07:06

---

### [completed] pricing.astro 定价页 "联系咨询" 指向 GitHub Discussions — 企业客户体验不佳 ✅

**ID**: web-039
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `pricing.astro` 第 145 行企业版的 "联系咨询" 按钮指向 `https://github.com/jingjinbao/ServerPilot/discussions`。虽然 web-030 把 mailto 改成了 GitHub Discussions 以避免邮件无法送达的问题，但对于企业客户来说，被引导到一个开源项目的公开讨论区咨询商业方案是不专业的。企业客户通常期望私密的联系方式。同时，FAQ 中第 171-172 行提到 "支持支付宝、微信支付、银行转账"，但云服务版标注 "即将推出"（第 103-105 行），描述未上线功能的支付方式容易误导用户。
**改进方案**: (1) 企业版 "联系咨询" 按钮与云服务版基础版一样改为 "即将推出" 的禁用状态，或添加一句说明 "商业合作请通过 GitHub Discussions 联系"。(2) FAQ 中 "支持哪些支付方式" 的回答添加前缀 "云服务正式上线后，将支持..."，明确时态。
**验收标准**: 企业版联系方式对用户预期做了合理管理；FAQ 支付方式描述不会让用户误以为云服务已上线。
**影响范围**: `web/src/pages/pricing.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:08:46

---

### [completed] BaseLayout footer 版权声明缺少 AGPL-3.0 开源协议标识 ✅

**ID**: web-040
**优先级**: P2
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 第 172-174 行的 footer 底部只有 `© {new Date().getFullYear()} ServerPilot. All rights reserved.`。"All rights reserved" 与 AGPL-3.0 开源协议矛盾 — AGPL-3.0 明确授予用户复制、修改、分发的权利。首页 `index.astro` 第 192 行和下载页 `download.astro` 第 55 行都标注了 "AGPL-3.0 开源协议"，但全站 footer 的 "All rights reserved" 发出了相反的信号。项目 `LICENSING.md`（git status 显示已修改）也确认了 AGPL-3.0 for CE 的策略。
**改进方案**: 将 footer 版权声明改为 `© {year} ServerPilot. Licensed under AGPL-3.0.`，或更简洁的 `© {year} ServerPilot · AGPL-3.0`。移除 "All rights reserved" 以避免与开源协议的法律语义冲突。
**验收标准**: Footer 版权声明包含 AGPL-3.0 标识；不再使用 "All rights reserved"；与首页和下载页的协议标注一致。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:10:07

---

### [completed] getting-started.astro 文档页缺少页面内目录导航（TOC） ✅

**ID**: web-041
**优先级**: P2
**模块路径**: web/src/pages/docs/
**发现的问题**: `getting-started.astro` 是一个 248 行的长文档页面，包含 3 个主要章节（系统要求、安装指南、首次配置）和多个子章节（3.1-3.3）。用户需要滚动浏览整个页面才能找到需要的内容。虽然页面使用了 `id="requirements"`、`id="installation"`、`id="first-setup"` 等锚点（第 35、93、163 行），文档导航页 `docs/index.astro` 也有指向这些锚点的链接（第 39-41 行），但 getting-started 页面本身没有页内目录，用户从搜索引擎直接访问此页时无法快速定位。
**改进方案**: 在 getting-started 页面的 `<h1>` 和蓝色提示框之间添加一个简洁的页内目录（3 项：系统要求、安装指南、首次配置），使用锚点链接。纯 HTML 列表，无需 JS，保持文档页简洁。
**验收标准**: 页面顶部有 3 项目录列表，点击可跳转到对应章节；目录样式简洁，不喧宾夺主。
**影响范围**: `web/src/pages/docs/getting-started.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:11:37

---

### [completed] 首页结构化数据 WebSite schema 的 SearchAction 指向不存在的搜索功能 ✅

**ID**: web-042
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 45-58 行定义了 `WebSite` schema，其中 `potentialAction` 声明了一个 `SearchAction`，URL 模板为 `${SITE_URL}/docs?q={search_term_string}`。但网站实际上不提供任何搜索功能 — `/docs` 页面（`docs/index.astro`）是静态导航页，没有搜索框、搜索参数处理或搜索结果页面。声明不存在的搜索功能属于误导性结构化数据，可能导致 Google 在搜索结果中显示站内搜索框但用户使用后无结果，影响用户体验和站点信誉。
**改进方案**: 从 `webSiteSchema` 中移除 `potentialAction` 搜索声明，只保留基础的 `WebSite` schema（name + url）。等实际实现搜索功能后再添加。
**验收标准**: `WebSite` 结构化数据中不包含 `SearchAction`；schema 数据与网站实际功能一致。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:12:58

---

### [completed] 定价页 FAQ "可以先试用再购买吗" 回答与产品现状矛盾 ✅

**ID**: web-043
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `pricing.astro` 第 163-166 行 FAQ 回答 "云服务版提供 14 天免费试用，无需信用卡。试用期间可以使用所有功能，满意后再选择付费计划。" 但云服务版在页面上明确标注为 "即将推出"（第 103-105 行）。FAQ 的回答用现在时态描述了一个尚未上线的功能，用户读到这里会尝试寻找试用入口，但找不到。同样，第 196-204 行的 FAQPage 结构化数据也会将这段话推送给 Google 搜索结果，在搜索摘要中显示 "14 天免费试用"，用户点进来后发现无法试用，造成信任损失。
**改进方案**: 将 FAQ 回答改为使用将来时态："云服务版正式上线后，将提供 14 天免费试用..."。同步更新 JSON-LD 结构化数据中对应的 `acceptedAnswer.text`。
**验收标准**: FAQ 回答和结构化数据中关于试用的描述使用将来时态，明确标注为上线后的计划；不会让用户产生 "现在就可以试用" 的错误预期。
**影响范围**: `web/src/pages/pricing.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:14:18

---

### [completed] 首页 SoftwareApplication schema 中 softwareVersion 硬编码为 "1.0" ✅

**ID**: web-044
**优先级**: P3
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 34 行 `"softwareVersion": "1.0"` 是硬编码值。`package.json` 中各个包的 version 也是 `"1.0.0"`，但如果项目版本更新（git tags、GitHub Releases），这个值需要手动同步。此外 `"priceCurrency": "CNY"`（第 25 行）对于一个 AGPL-3.0 免费开源项目来说不太合适，`"price": "0"` + `"priceCurrency": "CNY"` 暗示是中国市场限定，而实际上开源版面向全球用户。
**改进方案**: (1) 将 `priceCurrency` 改为 `"USD"` 或直接使用 `"isAccessibleForFree": true` 替代 offers 对象（Schema.org 更推荐此方式标注免费软件）。(2) 保留 `softwareVersion` 但添加注释提醒更新，或从 `package.json` 动态读取。
**验收标准**: 结构化数据中免费标注方式符合 Schema.org 最佳实践；不会给人 "仅限中国市场" 的错误印象。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:16:29

---

### [completed] download.astro 云服务版卡片显示 ¥99/月起 但无法操作 — 价格信息过早暴露 ✅

**ID**: web-045
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 第 82-83 行显示了云服务版定价 `¥99/月起`，带有 "推荐" 标签（第 72-74 行）和 "即将推出" 的禁用按钮（第 110-112 行）。在下载页展示一个无法购买的推荐产品，而可以使用的免费开源版反而没有 "推荐" 标签，造成了认知矛盾：最突出的选项用户无法操作，能操作的选项视觉权重较低。同时价格 ¥99 在产品未上线时展示可能造成定价锚定问题，后续如果调价会影响已有用户预期。
**改进方案**: (1) 将 "推荐" 标签移到开源版卡片（当前唯一可用的产品）。(2) 云服务版卡片的价格改为 "敬请期待" 或保留价格但降低视觉权重（移除 border-primary-500 高亮边框）。让用户的注意力集中在当前可以操作的开源版上。
**验收标准**: 下载页的视觉层次引导用户使用当前可用的开源版；云服务版不再是视觉焦点；用户不会被无法操作的 "推荐" 选项困惑。
**影响范围**: `web/src/pages/download.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:17:59

---

### [completed] astro.config.mjs 引入了 @astrojs/react 但全站无 React 组件 ✅

**ID**: web-046
**优先级**: P3
**模块路径**: web/
**发现的问题**: `astro.config.mjs` 第 9 行引入了 `react()` 集成，`package.json` 也安装了 `react`（^18.3.1）、`react-dom`（^18.3.1）、`@astrojs/react`（^3.6.2）、`@types/react`（^18.3.12）、`@types/react-dom`（^18.3.1）共 5 个包。但 `web/src/` 中没有任何 `.tsx` 或 `.jsx` 文件，所有组件都是 `.astro` 文件。React 依赖增加了约 150KB 的构建依赖和 `node_modules` 体积，且 `react()` 集成会注入 React hydration 运行时代码到页面中（即使没有 React 组件使用）。
**改进方案**: 从 `astro.config.mjs` 中移除 `react()` 集成，从 `package.json` 中移除 5 个 React 相关依赖包。如果将来需要 React 岛组件再重新添加。保持网站零 JS 运行时的性能优势。
**验收标准**: `astro.config.mjs` 不包含 React 集成；`package.json` 无 React 依赖；`pnpm build` 成功且所有页面正常渲染；构建产物中无 React 运行时代码。
**影响范围**: `web/astro.config.mjs`, `web/package.json`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:21:00

---

### [completed] CodeBlock 组件的复制按钮脚本在多实例页面重复注册事件监听器 ✅

**ID**: web-047
**优先级**: P3
**模块路径**: web/src/components/
**发现的问题**: `CodeBlock.astro` 第 25-42 行包含一个 `<script>` 标签，使用事件委托模式 `document.addEventListener('click', ...)` 监听全局点击。Astro 默认会对 `<script>` 标签进行去重处理（相同内容的 script 只渲染一次），所以在 `download.astro`（使用了 5 个 CodeBlock）和 `getting-started.astro`（使用了 5 个 CodeBlock）中不会实际重复注册。但 `<script>` 标签没有 `is:inline` 标记，Astro 会将其打包到独立的 JS 文件中。当前实现是正确的，但 `btn.textContent` 操作（第 34-38 行）在复制按钮已显示 "已复制" 时如果快速连续点击会产生竞态：第一次 setTimeout 回调恢复文字时可能覆盖第二次点击设置的 "已复制" 状态。
**改进方案**: 在复制按钮点击处理中添加防抖：如果按钮已显示 "已复制"，则忽略后续点击或重置 timeout。使用简单的 `clearTimeout` + 变量存储 timer ID 即可。
**验收标准**: 快速连续点击复制按钮不会出现 "已复制" 文字闪烁或状态错乱；复制功能保持正常。
**影响范围**: `web/src/components/CodeBlock.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:22:50

### [completed] 首页缺少 SoftwareApplication 结构化数据 ✅

**ID**: web-024
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 首页没有任何 Schema.org 结构化数据。`pricing.astro` 有 `FAQPage`，`docs/index.astro` 有 `BreadcrumbList`，但首页作为流量入口完全缺失。缺少 `SoftwareApplication` 或 `WebApplication` 结构化数据，Google 搜索结果无法显示应用信息（如价格 "免费"、操作系统、评分等），降低搜索可见性。
**改进方案**: 在 `index.astro` 底部添加 `<script type="application/ld+json">` 标签，包含 `SoftwareApplication` Schema.org 标记：applicationCategory 为 "DeveloperApplication"，operatingSystem 为 "Linux, macOS"，offers 标记为 Free，以及 Organization 信息。同时添加 `WebSite` schema 配合 sitelinks 搜索框。
**验收标准**: `index.astro` 包含有效的 JSON-LD `SoftwareApplication` 结构化数据；可通过 Google Rich Results Test 验证无错误。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:38:25

---

### [completed] getting-started.astro 缺少 BreadcrumbList 结构化数据 ✅

**ID**: web-025
**优先级**: P3
**模块路径**: web/src/pages/docs/
**发现的问题**: `docs/index.astro` 第 7-14 行有 `BreadcrumbList` 结构化数据，但 `docs/getting-started.astro` 第 10-13 行只有视觉面包屑导航（`文档 / 快速开始`），缺少对应的 Schema.org 结构化数据。两个文档页面的结构化数据标记不一致，且 getting-started 是有实际内容的页面，更应该有完整的 SEO 标记。
**改进方案**: 在 `getting-started.astro` 的 `<BaseLayout>` 内添加与 `docs/index.astro` 风格一致的 `BreadcrumbList` JSON-LD，包含三级路径：首页 → 文档 → 快速开始。
**验收标准**: `getting-started.astro` 包含有效的 BreadcrumbList JSON-LD，层级为 首页 → 文档 → 快速开始。
**影响范围**: `web/src/pages/docs/getting-started.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:39:55

---

### [completed] 定价页缺少面包屑导航 ✅

**ID**: web-026
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `docs/index.astro` 第 19-23 行和 `docs/getting-started.astro` 第 10-13 行都有面包屑导航，但 `pricing.astro` 和 `download.astro` 没有。从 SEO 和用户体验角度，所有内容页面应有一致的面包屑导航。特别是定价页，用户可能通过搜索引擎直接访问，面包屑可以帮助理解站点结构。
**改进方案**: 在 `pricing.astro` 的 `<section>` 内顶部添加面包屑导航（首页 / 定价），样式与文档页一致。同时添加 `BreadcrumbList` 结构化数据。`download.astro` 同理。
**验收标准**: `pricing.astro` 和 `download.astro` 都有面包屑导航和对应的 BreadcrumbList JSON-LD；样式与文档页一致。
**影响范围**: `web/src/pages/pricing.astro`, `web/src/pages/download.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:41:56

---

### [completed] Footer "关于" 栏目内容单薄 — 仅有一个许可证链接 ✅

**ID**: web-027
**优先级**: P2
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 第 144-149 行的 Footer "关于" 栏目只有一个"许可证"链接，相比"产品"栏目（3 个链接）和"社区"栏目（3 个链接）显得非常空洞。4 列网格布局中最后一列内容过少，视觉上不平衡。作为开源项目，应提供更多"关于"信息帮助用户了解项目背景。
**改进方案**: 在"关于"栏目中添加 2-3 个有意义的链接：(1) 保留"许可证"；(2) 添加"更新日志"指向 GitHub Releases 页面 `${GITHUB_REPO}/releases`；(3) 添加"贡献指南"指向 `${GITHUB_REPO}/blob/master/CONTRIBUTING.md`（若存在）或 README。这些都是真实可用的链接。
**验收标准**: Footer "关于"栏目有 2-3 个链接；所有链接指向有效 URL；四列布局视觉平衡。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:43:16

---

### [completed] 移动端汉堡菜单缺少 ESC 键关闭和点击外部区域关闭 ✅

**ID**: web-028
**优先级**: P2
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 第 102-115 行的移动端菜单 JS 只处理了按钮点击事件。当菜单展开后：(1) 按 ESC 键无法关闭菜单，不符合 WAI-ARIA 模式对话框的预期行为；(2) 点击菜单外部区域（如主内容区）无法关闭菜单，用户只能再次点击汉堡按钮才能关闭；(3) 导航到其他页面时菜单状态不会重置（不过 Astro MPA 会重新加载页面，此问题不严重）。
**改进方案**: 在现有 JS 中添加两个事件监听：(1) `keydown` 监听 ESC 键关闭菜单；(2) 点击菜单链接后自动关闭菜单（因为有些锚点链接不会触发页面跳转）。保持代码简洁，不过度复杂化。
**验收标准**: 按 ESC 键可关闭展开的移动端菜单；点击菜单内的导航链接后菜单自动收起；菜单关闭时 `aria-expanded` 正确设置为 `false`。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:44:47

---

### [completed] 首页 Terminal Demo 中文示例对国际用户不友好 — 缺少语言标识 ✅

**ID**: web-029
**优先级**: P3
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 33-67 行的 Terminal Demo 全部使用中文对话内容，但产品支持国际用户。`<html lang="zh-CN">` 声明为中文站点虽然合理，但如果后续考虑多语言支持，当前 Demo 内容和执行步骤中的混合中英文（如 `sudo apt update`、`sudo systemctl enable --now nginx` 等英文命令与中文 AI 回复混排）在终端模拟中的排版可能导致 `overflow-x-auto` 被触发时中文对话被截断。当前 `max-w-3xl`（48rem = 768px）在中等屏幕可能空间不足。
**改进方案**: 给 Terminal Demo 的外层容器 `div.mt-16.max-w-3xl` 在中小屏幕上改为 `max-w-full`（使用 `lg:max-w-3xl`），确保终端内容在中等屏幕上不会因容器太窄而频繁横向滚动。
**验收标准**: Terminal Demo 在 768px-1024px 屏幕宽度下内容不溢出或溢出最小化；响应式表现良好。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:46:17

---

### [completed] 定价页企业版 "联系销售" 邮箱地址可能无效 ✅

**ID**: web-030
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `pricing.astro` 第 128 行 `<a href="mailto:sales@serverpilot.ai">联系销售</a>` 使用了 `sales@serverpilot.ai` 邮箱。虽然域名 `serverpilot.ai` 在 `astro.config.mjs` 中配置为站点域名，但该邮箱可能尚未设置。用户点击后邮件客户端会打开，但如果邮箱不存在，发出的邮件会被退回，导致潜在客户流失。这是一个用户信任问题。
**改进方案**: 将 "联系销售" 按钮改为与云服务版类似的"即将推出"禁用状态（`<span class="btn-secondary opacity-50 cursor-not-allowed">联系销售（即将开放）</span>`），或者改为指向 GitHub Discussions 的链接（`${GITHUB_REPO}/discussions`），让用户通过社区渠道联系。等邮箱实际配置后再改回 `mailto:`。
**验收标准**: "联系销售"按钮指向可用的联系渠道（GitHub Discussions）或明确标注为即将开放；用户不会发送到可能不存在的邮箱。
**影响范围**: `web/src/pages/pricing.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:47:48

---

### [completed] 全站缺少 404 页面 ✅

**ID**: web-031
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `web/src/pages/` 目录下没有 `404.astro` 页面。Astro 支持自定义 404 页面（`src/pages/404.astro`），当用户访问不存在的 URL 时会自动使用。目前用户访问错误路径（如文档页中"即将推出"的链接被搜索引擎收录后）会看到浏览器或托管平台的默认 404 页面，体验不佳且无法引导用户回到正确路径。
**改进方案**: 创建 `web/src/pages/404.astro`，使用 `BaseLayout` 布局，内容包含：(1) 友好的提示文字（"页面未找到"）；(2) 返回首页按钮；(3) 常用链接列表（文档、下载、定价）。保持简洁，不超过 50 行。
**验收标准**: `web/src/pages/404.astro` 存在；使用 BaseLayout 保持全站一致的导航和 Footer；包含返回首页链接和常用页面链接。
**影响范围**: `web/src/pages/404.astro`（新建）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:49:08

---

### [completed] BaseLayout header 使用 sticky 定位但 backdrop-blur 在 Safari 上性能较差 ✅

**ID**: web-032
**优先级**: P3
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 第 54 行 `<header class="border-b sticky top-0 bg-white/80 backdrop-blur-sm z-50">` 使用了 `backdrop-blur-sm` 实现毛玻璃效果。在 iOS Safari 和低端设备上，`backdrop-filter: blur()` 会导致滚动时掉帧，特别是页面内容复杂时。此外 `bg-white/80`（80% 透明度）+ `backdrop-blur` 的组合在某些浏览器上可能不一致。
**改进方案**: 保持当前实现不变（现代浏览器兼容性已足够好），但添加 `@supports` 回退：对不支持 `backdrop-filter` 的浏览器使用纯白背景 `bg-white`。在 `global.css` 中添加一条 `@supports not (backdrop-filter: blur(4px))` 规则。
**验收标准**: 支持 `backdrop-filter` 的浏览器显示毛玻璃效果；不支持的浏览器显示纯白背景；不出现透视穿透的视觉问题。
**影响范围**: `web/src/styles/global.css`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:51:19

---

### [completed] download.astro 安装命令代码块缺少复制按钮 ✅

**ID**: web-033
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 第 116-141 行和 `getting-started.astro` 第 88-138 行中有多个代码命令块（`bg-gray-900 text-gray-100 p-4 rounded-md font-mono`），用户需要手动选中文本才能复制命令。对于安装指南类页面，一键复制功能是标准体验（参考 Docker、Next.js 官网的代码块都有复制按钮）。特别是 `download.astro` 中的多行命令（如 `git clone ... && cd ...`）手动选择容易遗漏。
**改进方案**: 创建一个简单的 `CodeBlock.astro` 组件，包含代码内容和一个复制按钮（右上角）。点击按钮后使用 `navigator.clipboard.writeText()` 复制代码内容，按钮文字短暂变为"已复制"反馈。使用最小化 JS（`<script>` tag，非 React 组件），保持 Astro 零 JS 运行时的优势。
**验收标准**: 所有代码命令块右上角有复制按钮；点击后文本被复制到剪贴板；有"已复制"的视觉反馈（1-2 秒后恢复）。
**影响范围**: `web/src/components/CodeBlock.astro`（新建）, `web/src/pages/download.astro`, `web/src/pages/docs/getting-started.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:55:30

---

### [completed] 首页 Hero 区域 CTA 按钮 "立即下载" 在移动端位于首屏之外 ✅

**ID**: web-034
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 第 21-24 行的 CTA 按钮 `div.flex.gap-4.justify-center` 在 h1（text-5xl md:text-6xl, ~3rem-3.75rem）和 p（text-xl, ~1.25rem）之后，再加上 `py-20`（5rem）的上内边距和 header 的高度（约 64px），在 375px 宽的 iPhone SE 等小屏设备上，CTA 按钮可能刚好被推到首屏底部边缘或视口之外。用户需要滚动才能看到主要的行动按钮。
**改进方案**: 将 Hero 区域的上下内边距在移动端适当减小：改 `py-20` 为 `py-12 md:py-20`（移动端 3rem，桌面端 5rem），同时将 `mb-12` 改为 `mb-8 md:mb-12`，确保 CTA 按钮在小屏首屏可见。
**验收标准**: 在 375px 宽度设备上，CTA 按钮（"立即下载"和"查看文档"）完全在首屏视口内可见。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:57:00

---

### [completed] 文档导航页 "快速开始" 卡片有 hover 效果但其他卡片没有 ✅

**ID**: web-035
**优先级**: P3
**模块路径**: web/src/pages/docs/
**发现的问题**: `docs/index.astro` 第 30 行 "快速开始" 卡片有 `hover:shadow-lg transition-shadow` 效果，且链接可点击（指向 `/docs/getting-started`）。但其余 5 个卡片（核心概念、使用指南、API 参考、部署运维、故障排查，第 46-138 行）只有 `border rounded-lg p-6`，没有 hover 效果。这种不一致的交互暗示会让用户困惑 — 有 hover 的卡片可点击，没 hover 的不可点击，但视觉上它们看起来非常相似。
**改进方案**: 为 5 个"即将推出"的卡片统一添加视觉区分：(1) 添加 `opacity-75` 或 `bg-gray-50` 背景色，与可点击的"快速开始"卡片形成更明显的视觉差异；(2) 图标使用灰色（当前已是 `text-gray-400`，保持即可）。这样用户一眼就能区分可用和未上线的内容。
**验收标准**: "即将推出"的卡片与"快速开始"卡片有明显的视觉区分（如背景色或透明度差异）；用户可以快速识别哪些内容可用。
**影响范围**: `web/src/pages/docs/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:58:31

### [completed] BaseLayout 中 5 处 GitHub 链接仍使用 yourusername 占位符 ✅

**ID**: web-013
**优先级**: P0
**模块路径**: web/src/layouts/
**发现的问题**: 尽管 web-002 标记为已完成，但 `BaseLayout.astro` 中仍有 5 处 `yourusername` 占位符未替换：第 41 行（导航栏 GitHub 链接）、第 64 行（移动端菜单 GitHub 链接）、第 106 行（Footer GitHub）、第 107 行（Footer 讨论区）、第 108 行（Footer 问题反馈）、第 114 行（Footer 许可证）。下载页 `download.astro` 已修正为 `jingjinbao/ServerPilot`，但 BaseLayout 和 getting-started.astro:85 仍是 `yourusername`，导致两处使用不同的 GitHub 用户名，且 `yourusername` 链接点击后跳转到 404。
**改进方案**: 将 `BaseLayout.astro` 和 `getting-started.astro` 中所有 `yourusername/serverpilot` 统一替换为 `jingjinbao/ServerPilot`（与 download.astro 一致）。建议在一个变量或常量中定义 GitHub 仓库 URL，避免散落在多处。
**验收标准**: 全站所有 GitHub 链接统一指向 `https://github.com/jingjinbao/ServerPilot`；不再出现 `yourusername` 文本；导航栏、移动端菜单、Footer 的 GitHub 链接均可正常访问。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/pages/docs/getting-started.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:11:39

---

### [completed] og-image.png 不存在导致社交分享无预览图 ✅

**ID**: web-014
**优先级**: P0
**模块路径**: web/public/
**发现的问题**: `BaseLayout.astro:11` 引用了 `/og-image.png` 作为 Open Graph 图片（`<meta property="og:image">`），但 `web/public/` 目录下只有 `favicon.svg` 和 `robots.txt`，没有 `og-image.png` 文件。在社交媒体（微信、Twitter、Slack）分享链接时会缺少预览图片，降低分享效果和点击率。
**改进方案**: 创建一个 1200x630 的 OG 预览图（PNG 格式），内容包含 ServerPilot 品牌名、slogan "AI 驱动的 DevOps 平台"，使用品牌色 `#0284c7` 背景。可以用简单的 SVG 转 PNG 方案，或直接创建一个静态图片。
**验收标准**: `web/public/og-image.png` 存在且为有效的 PNG 图片；尺寸为 1200x630 或接近此比例；`pnpm build` 后 `dist/og-image.png` 可访问。
**影响范围**: `web/public/og-image.png`（新建）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:14:29

---

### [completed] getting-started 文档页 8 处重复内联 SVG 勾选图标未使用 CheckIcon 组件 ✅

**ID**: web-015
**优先级**: P1
**模块路径**: web/src/pages/docs/
**发现的问题**: `getting-started.astro` 第 30-65 行中有 8 个完全相同的 SVG 勾选图标（4 行 SVG 代码 × 8 处 = 32 行重复代码），每个都是 `<svg class="w-4 h-4 text-success mr-2 mt-0.5 flex-shrink-0" ...>` + checkmark path。项目已有 `CheckIcon.astro` 组件（web-010 已创建），但此页面未使用，且使用了不同的 class（`w-4 h-4` vs CheckIcon 的 `w-5 h-5`）。
**改进方案**: 在 `getting-started.astro` 中 import `CheckIcon` 组件，替换所有 8 处内联 SVG。如果需要不同尺寸，给 `CheckIcon` 组件添加一个可选的 `size` prop（如 `class` 覆盖），或统一使用相同尺寸。
**验收标准**: `getting-started.astro` 中无内联勾选 SVG 重复代码；使用 `CheckIcon` 组件替换；页面渲染效果不变。
**影响范围**: `web/src/pages/docs/getting-started.astro`, `web/src/components/CheckIcon.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:16:50

---

### [completed] BaseLayout 引用的站点 URL 与 Astro 配置不一致 ✅

**ID**: web-016
**优先级**: P1
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:11` 中 `ogImage` 的 fallback URL 使用 `https://serverpilot.dev`，但 `astro.config.mjs:14` 中 `site` 配置为 `https://serverpilot.ai`。两个域名不一致，当 `Astro.site` 未定义时（如开发环境），OG 图片 URL 会指向错误的域名 `serverpilot.dev`。
**改进方案**: 将 `BaseLayout.astro:11` 的 fallback 域名从 `https://serverpilot.dev` 改为 `https://serverpilot.ai`，与 `astro.config.mjs` 中的 `site` 配置保持一致。
**验收标准**: `BaseLayout.astro` 中 fallback URL 为 `https://serverpilot.ai`；OG image URL 在任何环境下都指向正确域名。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:18:10

---

### [completed] 下载页与文档页安装步骤内容不一致 ✅

**ID**: web-017
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: 下载页 `download.astro:112-143` 展示了 3 步安装流程（克隆仓库 → `./init.sh` 或 `docker compose up -d` → 浏览器访问 3001 端口），而文档页 `getting-started.astro:77-137` 展示了另一个安装流程（克隆仓库 → `pnpm install` → 配置 `.env` → `pnpm dev` → 浏览器访问 5173 端口）。两处的 Dashboard 端口也不同（3001 vs 5173），用户会困惑应该用哪种方式安装。下载页强调 Docker 方式，文档页强调源码开发方式，但没有明确区分场景。
**改进方案**: (1) 下载页保留 Docker 快速部署方式（面向使用者），作为"生产部署"路径。(2) 文档页 getting-started 保留源码开发方式（面向开发者/贡献者），在标题中明确标注"开发环境"。(3) 两处都添加简短说明指向另一种安装方式（互相引用）。(4) 统一端口说明：Docker 部署用 3001，开发模式用 5173。
**验收标准**: 两处安装说明各有明确的适用场景标注；有交叉引用链接；端口信息准确无歧义。
**影响范围**: `web/src/pages/download.astro`, `web/src/pages/docs/getting-started.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:20:51

---

### [completed] 导航栏缺少当前页面高亮指示 ✅

**ID**: web-018
**优先级**: P1
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:36-41` 中的导航链接全部使用相同的样式 `hover:text-primary-600 transition-colors`，没有对当前所在页面的链接做高亮处理。用户在浏览不同页面时，无法通过导航栏识别自己当前所在位置。Astro 提供 `Astro.url.pathname` 可以方便地实现此功能。
**改进方案**: 在 `BaseLayout.astro` 的 frontmatter 中获取 `Astro.url.pathname`，对导航链接进行条件样式渲染：当前页面的链接添加 `text-primary-600 font-semibold` 样式和 `aria-current="page"` 属性。移动端菜单（第 60-64 行）也需要同步处理。
**验收标准**: 当前页面对应的导航链接有视觉高亮（不同颜色或加粗）；高亮效果在桌面端和移动端菜单均生效；有 `aria-current="page"` 无障碍标记。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:23:11

---

### [completed] 首页缺少开源项目信任要素（Star 数、License 标识等） ✅

**ID**: web-019
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 首页没有展示任何开源项目的信任要素。对于开源 DevOps 工具，用户通常期望看到：GitHub Star 数量/链接、开源协议（AGPL-3.0）、支持的 AI 提供商列表等。当前首页只有泛泛的特性描述（第 70-103 行），缺少具体的技术指标和社区证明。对比 Docker、K8s 等优秀开源项目官网，都在首页展示了社区规模和技术细节。
**改进方案**: 在首页 Features 区域下方添加一个简洁的"技术亮点"小节，展示：(1) 支持的 AI 提供商（Claude、OpenAI、DeepSeek、Ollama 的文字列表或小 logo）(2) 开源协议 AGPL-3.0 标识 (3) GitHub 仓库链接按钮。保持静态 HTML，不引入 JS 动态获取 Star 数。
**验收标准**: 首页展示支持的 AI 提供商名称；有开源协议标识；有 GitHub 仓库链接；纯静态实现。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:25:12

---

### [completed] Twitter Card 缺少 og:image 配置且无 twitter:image ✅

**ID**: web-020
**优先级**: P2
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:28-30` 配置了 Twitter Card 的 `title` 和 `description`，但缺少 `twitter:image` 标签。虽然 `og:image` 已配置（第 26 行），但部分 Twitter 客户端不会 fallback 到 OG 标签。此外，`og:url` 标签也缺失，会影响某些社交平台的规范化 URL 显示。
**改进方案**: 在 `BaseLayout.astro` 的 `<head>` 中添加 `<meta name="twitter:image" content={ogImage} />` 和 `<meta property="og:url" content={Astro.url.href} />`。同时添加 `<link rel="canonical" href={Astro.url.href} />` 用于 SEO 规范化。
**验收标准**: HTML head 中包含 `twitter:image`、`og:url` 和 `canonical` 标签；值动态反映当前页面 URL。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:26:33

---

### [completed] 定价页 FAQ 缺少结构化数据（Schema.org FAQPage） ✅

**ID**: web-021
**优先级**: P3
**模块路径**: web/src/pages/
**发现的问题**: `pricing.astro:134-165` 有一个完整的 FAQ 区域（4 个问题），但没有使用 Schema.org `FAQPage` 结构化数据标记。Google 搜索结果不会显示 FAQ 富文本摘要（Rich Snippet），减少了搜索可见性和点击率。
**改进方案**: 在 `pricing.astro` 底部添加一个 `<script type="application/ld+json">` 标签，包含 `FAQPage` Schema.org 标记，将 4 个 FAQ 问答对映射到结构化数据中。
**验收标准**: `pricing.astro` 页面源码中包含有效的 JSON-LD FAQPage 结构化数据；可通过 Google Rich Results Test 工具验证。
**影响范围**: `web/src/pages/pricing.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:28:13

---

### [completed] 文档页缺少面包屑导航和返回链接 ✅

**ID**: web-022
**优先级**: P2
**模块路径**: web/src/pages/docs/
**发现的问题**: `docs/index.astro` 文档导航页没有面包屑导航（只有一个 `h1` 标题），而 `getting-started.astro:9-13` 有面包屑导航。从文档导航页进入子页后可以返回，但文档导航页本身没有提供返回首页的路径。对于文档类网站，一致的面包屑导航有助于用户定位和 SEO。
**改进方案**: 在 `docs/index.astro` 顶部添加简单的面包屑导航（首页 / 文档），与 `getting-started.astro` 的面包屑风格一致。同时为文档导航页的 `<head>` 添加 `BreadcrumbList` Schema.org 结构化数据。
**验收标准**: 文档导航页有面包屑导航显示"首页 / 文档"；样式与 getting-started 页面一致。
**影响范围**: `web/src/pages/docs/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:29:53

---

### [completed] 首页三个特性区块缺少差异化设计和详细描述 ✅

**ID**: web-023
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `index.astro:70-103` 的三个特性卡片（AI 智能对话、安全可控、高效执行）各只有一句描述（不超过 20 个字），信息量不足以说服潜在用户。描述过于抽象，如"5 层安全防护"没有解释具体含义。对比其他 DevOps 工具官网，通常会提供 2-3 句描述加具体示例。
**改进方案**: 为每个特性卡片补充 1-2 句具体描述，解释实际能力。例如：AI 智能对话 → 补充"支持 Claude/OpenAI/DeepSeek 等多种模型"；安全可控 → 补充"命令分为 5 级风险，高风险操作需人工确认"；高效执行 → 补充"失败时自动诊断原因并建议修复方案"。
**验收标准**: 每个特性卡片有 2-3 句描述；描述包含具体的技术特性而非纯营销话术。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:31:34

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

### [completed] 替换所有 GitHub 占位符 URL 为真实仓库地址 ✅

**ID**: web-002
**优先级**: P0
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro` 中有 3 处 GitHub URL 使用 `yourusername` 占位符：第 30 行（导航栏）、第 58 行（社区-GitHub）、第 59 行（社区-讨论区）、第 60 行（问题反馈）。下载页 `download.astro:56` 也有同样的占位符 `https://github.com/yourusername/serverpilot`。用户点击后会跳转到不存在的页面。
**改进方案**: 将所有 `yourusername` 替换为实际的 GitHub 用户名/组织名。如果仓库尚未公开，改为统一的占位提示（如 `#github-coming-soon`）并添加 HTML 注释标记待替换位置，避免用户误点击跳转到 404。
**验收标准**: 所有 GitHub 链接指向有效地址或明确的占位符，不再出现 `yourusername` 文本。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/pages/download.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:41:38

---

### [completed] 修复下载页无效锚点链接和注册按钮 ✅

**ID**: web-003
**优先级**: P0
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 中有 3 个无效的锚点链接：第 50 行 `#download-linux`、第 53 行 `#download-macos`、第 112 行 `#cloud-signup`——页面内没有对应的 `id` 元素，点击后无任何效果。定价页 `pricing.astro:103` 的"免费试用 14 天"按钮 `href="#"` 也无实际功能。`pricing.astro:157` 的"联系销售"按钮 `href="#contact"` 同样指向不存在的锚点。
**改进方案**: (1) 下载按钮改为指向真实下载地址或 GitHub Releases 页面（如 `https://github.com/xxx/serverpilot/releases/latest`）；(2) 云服务注册按钮如果产品未上线，改为"即将推出"禁用状态按钮，添加 `cursor-not-allowed opacity-50` 样式并移除 href；(3) 联系销售改为 `mailto:` 链接或标注即将推出。
**验收标准**: 所有按钮要么指向有效目标，要么明确显示为"即将推出"状态，不会出现点击无反应的情况。
**影响范围**: `web/src/pages/download.astro`, `web/src/pages/pricing.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:45:49

---

### [completed] 修复文档导航页所有链接指向 # 占位符 ✅

**ID**: web-004
**优先级**: P0
**模块路径**: web/src/pages/docs/
**发现的问题**: `docs/index.astro` 中共有 18 个 `href="#"` 占位链接（第 22-25、37-41、53-57、69-73、85-89、101-105、116-118、123-127、131-135 行），覆盖全部 6 个文档类别和 9 个快速链接。用户点击任何文档链接都不会发生任何有意义的导航。文档页是产品的核心引导入口，全部链接无效严重影响用户体验。
**改进方案**: 创建一个快速开始文档页面 `web/src/pages/docs/getting-started.astro`，包含系统要求、安装指南、首次配置的基础内容（可从 `download.astro` 中的安装步骤和 `web/GETTING_STARTED.md` 提取内容）。将文档导航页中"快速开始"类别下的链接指向该页面。其余尚未编写的文档链接改为带"即将推出"标记的禁用状态。
**验收标准**: 至少 1 个文档链接可以正常跳转到有内容的页面；其余链接有明确的"即将推出"视觉标记，不再是无反应的 `#` 链接。
**影响范围**: `web/src/pages/docs/index.astro`, `web/src/pages/docs/getting-started.astro`（新建）
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:48:00

---

### [completed] BaseLayout 导航栏缺少移动端汉堡菜单 ✅

**ID**: web-005
**优先级**: P1
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:25` 中导航链接使用 `hidden md:flex`，在移动端（<768px）完全隐藏，但没有提供移动端的汉堡菜单替代方案。移动端用户无法访问"文档"、"下载"、"定价"、"GitHub"导航。右侧"开始使用"按钮（第 32 行）在移动端仍然显示，但其 `href="#"` 也是无效的。
**改进方案**: 添加一个简单的移动端汉堡菜单按钮（`md:hidden`），点击展开/折叠导航链接列表。使用纯 CSS（`<details>/<summary>` 或 checkbox hack）或最小化的 vanilla JS 实现，避免引入额外的客户端框架代码。同时修复"开始使用"按钮的 href 指向 `/download`。
**验收标准**: 移动端（<768px）可见汉堡菜单图标；点击后展开导航链接列表；导航链接可正常跳转。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/styles/global.css`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:49:50

---

### [completed] 首页 Hero 区域缺少产品截图或演示 ✅

**ID**: web-006
**优先级**: P1
**模块路径**: web/src/pages/
**发现的问题**: `index.astro` 首页 Hero 区域（第 7-18 行）只有标题、副标题和两个按钮，没有任何产品截图、终端演示或架构示意图。对于一个 DevOps 工具，用户无法直观理解产品的实际界面和工作方式。对比 Docker、Kubernetes 等优秀开源项目官网，都在首屏展示了产品界面或代码演示。
**改进方案**: 在 Hero 区域下方（CTA 按钮之后）添加一个模拟终端窗口，展示 ServerPilot AI 对话的示例交互（纯 HTML+CSS 实现，无需 JS）。内容类似：用户输入"帮我在 server-1 上安装 nginx" → AI 回复生成的操作步骤。使用 `bg-gray-900 text-green-400 font-mono` 终端风格。
**验收标准**: 首页 Hero 下方有一个终端样式的产品演示区块；内容展示了典型的 AI 对话交互；纯静态 HTML，不引入运行时 JS。
**影响范围**: `web/src/pages/index.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:51:11

---

### [completed] BaseLayout header "开始使用"按钮 href 无效 + footer "关于"链接无效 ✅

**ID**: web-007
**优先级**: P1
**模块路径**: web/src/layouts/
**发现的问题**: `BaseLayout.astro:32` 的"开始使用"按钮 `href="#"` 指向空锚点，点击无效果。Footer 中"关于我们"、"许可证"、"联系方式"三个链接（第 66-68 行）也都是 `href="#"`，同样无效。共 4 个无效链接影响用户导航。
**改进方案**: (1) "开始使用"按钮改为 `href="/download"`，与首页 CTA 一致。(2) "许可证"链接改为指向 GitHub 仓库的 LICENSE 文件 URL。(3) "关于我们"和"联系方式"如果暂无对应页面，暂时移除这两个链接项，避免死链接。保持 footer 简洁，只保留有实际内容的链接。
**验收标准**: Header "开始使用"按钮跳转到下载页；Footer 所有链接均指向有效目标或被移除；没有 `href="#"` 的占位链接。
**影响范围**: `web/src/layouts/BaseLayout.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:53:11

---

### [completed] 首页缺少 meta description 和 Open Graph 标签 ✅

**ID**: web-008
**优先级**: P2
**模块路径**: web/src/pages/, web/src/layouts/
**发现的问题**: `index.astro:5` 调用 `<BaseLayout title="首页">` 时没有传 `description` 参数，使用了 `BaseLayout.astro:9` 的默认值 `'AI-Driven DevOps Platform'`（英文，与中文站点不一致）。所有页面都缺少 Open Graph 标签（og:title, og:description, og:image, og:type）和 Twitter Card 标签。社交媒体分享时无法显示预览卡片。
**改进方案**: (1) 为 `index.astro` 添加中文 `description` prop。(2) 在 `BaseLayout.astro` 的 `<head>` 中添加 Open Graph 和 Twitter Card meta 标签，使用 `title` 和 `description` 变量动态填充。(3) 将默认 description 改为中文。
**验收标准**: 每个页面有独立的 `<meta name="description">`；所有页面包含 og:title、og:description、og:type 标签；默认 description 为中文。
**影响范围**: `web/src/layouts/BaseLayout.astro`, `web/src/pages/index.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:55:22

---

### [completed] Tailwind 主题色缺少 200/300/400/800/900 色阶 ✅

**ID**: web-009
**优先级**: P2
**模块路径**: web/
**发现的问题**: `tailwind.config.mjs` 只定义了 primary 色的 50、100、500、600、700 五个色阶（第 7-13 行），缺少 200、300、400、800、900 色阶。如果后续开发中使用 `primary-200` 等类名会得到透明色（无效值）。同时定价页中的多处 SVG 使用 `text-green-500` 硬编码颜色（如 `download.astro` 中 12 处、`pricing.astro` 中 16 处），没有统一为语义化的颜色 token。
**改进方案**: 补全 primary 色的全部色阶（200-400, 800-900），保持与 sky 蓝色系一致。考虑添加 `success` 语义色 token 映射到 green-500，提高可维护性。
**验收标准**: `tailwind.config.mjs` 中 primary 色有完整的 50-900 色阶；使用任何 `primary-*` 类名都能正确渲染颜色。
**影响范围**: `web/tailwind.config.mjs`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 13:58:03

---

### [completed] 下载页和定价页大量重复的 SVG 勾选图标代码 ✅

**ID**: web-010
**优先级**: P2
**模块路径**: web/src/pages/
**发现的问题**: `download.astro` 中相同的绿色勾选 SVG 图标（`<svg class="w-5 h-5 text-green-500 ...">` + checkmark path）重复出现 9 次（第 23-45 行、第 79-107 行）。`pricing.astro` 中同样的 SVG 重复出现 16 次（第 24-46、72-100、120-154 行）。两个文件总计 25 次完全相同的 SVG 代码块，每块约 4 行，共约 100 行重复代码。
**改进方案**: 创建一个简单的 Astro 组件 `web/src/components/CheckIcon.astro`，封装勾选图标 SVG。在 `download.astro` 和 `pricing.astro` 中引用该组件替换内联 SVG。组件保持简单，不过度抽象。
**验收标准**: `CheckIcon.astro` 组件创建完成；`download.astro` 和 `pricing.astro` 中无重复的勾选 SVG 代码；页面渲染效果不变。
**影响范围**: `web/src/components/CheckIcon.astro`（新建）, `web/src/pages/download.astro`, `web/src/pages/pricing.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 14:00:13

---

### [completed] 生成 sitemap.xml 提升搜索引擎收录 ✅

**ID**: web-011
**优先级**: P3
**模块路径**: web/
**发现的问题**: `astro.config.mjs` 已配置 `site: 'https://serverpilot.ai'`（第 13 行），但没有启用 Astro 内置的 sitemap 集成。当前构建产物中不会生成 `sitemap.xml`，搜索引擎无法有效发现和索引所有页面。`public/` 下也没有 `robots.txt` 文件。
**改进方案**: (1) 安装 `@astrojs/sitemap` 并在 `astro.config.mjs` 中添加到 integrations 数组。(2) 在 `web/public/` 下创建 `robots.txt`，指向 sitemap 路径并允许所有爬虫访问。
**验收标准**: `pnpm build` 后 `dist/sitemap-index.xml` 和 `dist/sitemap-0.xml` 存在，包含所有页面 URL；`dist/robots.txt` 存在且引用了 sitemap。
**影响范围**: `web/astro.config.mjs`, `web/package.json`, `web/public/robots.txt`（新建）
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 14:02:14

---

### [completed] 下载页安装命令使用虚构域名 releases.serverpilot.ai ✅

**ID**: web-012
**优先级**: P0
**模块路径**: web/src/pages/
**发现的问题**: `download.astro:133` 中快速安装步骤的 wget 命令使用了虚构的 URL `https://releases.serverpilot.ai/latest/serverpilot-linux-amd64.tar.gz`。这个域名并不存在，用户复制执行会直接失败。同时第 143-145 行的 `tar` 解压和 `./install.sh` 步骤也是基于假设的包格式。
**改进方案**: 将安装命令改为基于 GitHub Releases 的真实安装方式（与项目实际的构建产物一致），或使用 npm/pnpm 安装方式（如 `npx serverpilot` 或 `pnpm dlx serverpilot`），与项目的 Node.js 技术栈保持一致。如果发布流程尚未确定，改为更通用的"克隆仓库并安装"方式。
**验收标准**: 安装命令可实际执行或明确标注为示例；命令与项目实际安装方式一致。
**影响范围**: `web/src/pages/download.astro`
**创建时间**: 2026-02-14
**完成时间**: 2026-02-15 14:05:14


---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`

## 设计原则

- **简洁**: 避免过度设计，专注核心功能
- **实用**: 内容真实有用，不做空洞宣传
- **性能**: 静态生成，首屏加载快
- **易维护**: 清晰的目录结构，易于扩展
