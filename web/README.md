# ServerPilot 官网

基于 Astro 构建的 ServerPilot 官网，简洁、高性能、易维护。

## 技术栈

- **框架**: Astro 5.0+
- **UI 库**: React 18
- **样式**: Tailwind CSS 3
- **内容**: MDX (Markdown + JSX)

## 快速开始

```bash
# 安装依赖
cd web
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview
```

## 项目结构

```
web/
├── src/
│   ├── layouts/          # 页面布局
│   │   └── BaseLayout.astro
│   ├── pages/            # 路由页面 (自动路由)
│   │   ├── index.astro       # 首页
│   │   ├── download.astro    # 下载页
│   │   ├── pricing.astro     # 定价页
│   │   └── docs/
│   │       └── index.astro   # 文档首页
│   ├── components/       # React 组件
│   ├── content/          # Markdown 文档内容
│   └── styles/           # 全局样式
├── public/               # 静态资源
└── astro.config.mjs      # Astro 配置
```

## 页面说明

### 已实现页面

- **首页** (`/`) - 产品介绍、核心特性、CTA
- **下载** (`/download`) - 开源版 vs 云版本对比 + 安装指南
- **定价** (`/pricing`) - 3 种方案对比 + FAQ
- **文档** (`/docs`) - 文档导航页（待补充具体文档）

### 待补充内容

1. **文档内容** - 在 `src/content/docs/` 下添加 Markdown 文档
2. **下载链接** - 替换假链接为真实的下载地址
3. **GitHub 链接** - 更新 BaseLayout.astro 中的 GitHub URL
4. **域名配置** - 更新 astro.config.mjs 中的 `site` 字段
5. **favicon** - 添加 `public/favicon.svg`

## 设计原则

- **简洁**: 避免过度设计，专注核心功能
- **性能**: 静态生成，首屏加载快
- **可维护**: 清晰的目录结构，易于扩展
- **响应式**: 移动端适配

## 社区方案

采用外链方式，避免自建论坛的维护成本：
- GitHub Discussions - 技术讨论
- GitHub Issues - Bug 反馈
- 可选：Discord/Telegram 群组

## 部署

支持部署到任何静态托管服务：

```bash
# 构建
pnpm build

# 输出目录: dist/
# 可直接部署到 Vercel / Netlify / Cloudflare Pages 等
```

## 开发规范

- 保持文件简洁 (<500 行)
- 使用 Tailwind 实用类优先
- 组件复用优于重复代码
- 提交前运行 `pnpm typecheck`
