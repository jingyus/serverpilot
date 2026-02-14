# ServerPilot 官网快速开始

## 开发流程

### 方式一：手动开发

```bash
# 1. 安装依赖
cd web
pnpm install

# 2. 启动开发服务器
pnpm dev
# 访问 http://localhost:4321

# 3. 修改代码
# 编辑 src/pages/ 下的文件，浏览器会自动刷新

# 4. 构建生产版本
pnpm build

# 5. 预览生产构建
pnpm preview
```

### 方式二：AI 自动化迭代

使用 AI 自动发现问题并改进网站：

```bash
# 在项目根目录运行
./scripts/autorun_web.sh

# AI 会自动:
# 1. 扫描网站代码和内容
# 2. 发现需要改进的地方
# 3. 生成任务队列
# 4. 逐个实现任务
# 5. 运行测试验证
```

查看任务进度：
- `WEB_TASK_QUEUE.md` - 任务队列
- `AUTORUN_WEB_STATE.md` - 运行状态
- `CURRENT_WEB_TASK.md` - 当前任务

**⚠️ 工作范围限制**：
- AI 可以**读取**项目其他目录（README、docs、packages 等）以了解项目背景
- 但**只能修改/新建** `web/` 目录下的文件
- 所有代码、样式、配置的修改必须在 `web/` 下
- 脚本内置路径验证机制，违规修改会被自动拒绝

## 目录结构

```
web/
├── src/
│   ├── pages/              # 路由页面（Astro 自动路由）
│   │   ├── index.astro           # 首页 /
│   │   ├── download.astro        # 下载页 /download
│   │   ├── pricing.astro         # 定价页 /pricing
│   │   └── docs/
│   │       └── index.astro       # 文档导航 /docs
│   │
│   ├── layouts/            # 页面布局
│   │   └── BaseLayout.astro      # 基础布局（Header + Footer）
│   │
│   ├── components/         # React 组件（按需创建）
│   ├── content/            # Markdown 文档内容
│   └── styles/             # 全局样式
│
├── public/                 # 静态资源（图片、favicon 等）
├── astro.config.mjs        # Astro 配置
├── tailwind.config.mjs     # Tailwind 配置
└── package.json            # 依赖配置
```

## 添加新页面

### 1. 创建 Astro 页面

```astro
---
// src/pages/about.astro
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="关于我们">
  <section class="container mx-auto px-6 py-20">
    <h1 class="text-4xl font-bold mb-6">关于 ServerPilot</h1>
    <p class="text-gray-600">关于我们的故事...</p>
  </section>
</BaseLayout>
```

保存后自动生成路由 `/about`

### 2. 添加导航链接

编辑 `src/layouts/BaseLayout.astro`:

```astro
<nav>
  <!-- ... 其他链接 -->
  <a href="/about">关于</a>
</nav>
```

## 添加文档内容

### 1. 创建 Markdown 文件

```markdown
<!-- src/content/docs/installation.md -->
---
title: 安装指南
description: 如何安装 ServerPilot
---

# 安装 ServerPilot

## 系统要求

- Linux / macOS
- Node.js 22+
- ...
```

### 2. 创建文档页面

```astro
---
// src/pages/docs/installation.astro
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getEntry } from 'astro:content';

const entry = await getEntry('docs', 'installation');
const { Content } = await entry.render();
---

<BaseLayout title={entry.data.title}>
  <article class="prose mx-auto px-6 py-20">
    <Content />
  </article>
</BaseLayout>
```

## 优化建议

### 性能优化

- 使用 Astro Image 组件优化图片
- 启用预渲染和静态生成
- 最小化客户端 JavaScript

### SEO 优化

- 每个页面设置唯一的 title 和 description
- 添加 Open Graph 标签
- 生成 sitemap.xml

### 内容优化

- 文档内容要详细、准确
- 提供实际的代码示例
- 添加截图和演示视频

## 部署

### Vercel（推荐）

```bash
# 安装 Vercel CLI
pnpm install -g vercel

# 部署
cd web
vercel
```

### Netlify

```bash
# 在 Netlify 网站上连接 Git 仓库
# 构建配置:
# - Build command: cd web && pnpm build
# - Publish directory: web/dist
```

### 自托管

```bash
# 构建
cd web
pnpm build

# 将 dist/ 目录部署到任何静态服务器
# 如 Nginx, Apache, Caddy 等
```

## 常见问题

### Q: 修改代码后页面没更新？

A: 检查 Astro 开发服务器是否正常运行，尝试刷新浏览器或重启服务器。

### Q: 构建失败？

A: 运行 `pnpm typecheck` 检查 TypeScript 错误，修复后重新构建。

### Q: 如何添加交互式组件？

A: 创建 React 组件并使用 `client:load` 指令启用客户端 JS：

```astro
---
import MyComponent from '../components/MyComponent';
---

<MyComponent client:load />
```

### Q: 如何配置域名？

A: 编辑 `astro.config.mjs` 中的 `site` 字段：

```js
export default defineConfig({
  site: 'https://your-domain.com',
  // ...
});
```

## 设计原则

开发时请遵守以下原则：

- ✅ **简洁**: 避免过度设计，专注核心功能
- ✅ **实用**: 内容真实有用，不做空洞宣传
- ✅ **性能**: 静态生成，首屏加载快
- ✅ **易维护**: 清晰的目录结构，易于扩展

## 获取帮助

- 查看 [Astro 文档](https://docs.astro.build)
- 查看 [Tailwind CSS 文档](https://tailwindcss.com/docs)
- 阅读项目 README.md
