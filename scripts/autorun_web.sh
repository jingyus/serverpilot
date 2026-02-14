#!/bin/bash
#
# ServerPilot 官网质量自循环改进脚本
#
# 聚焦领域:
# - 内容质量（文档完整性、案例真实性、说明清晰度）
# - 用户体验（导航流畅、信息查找、响应式设计）
# - 性能优化（首屏加载、图片优化、静态资源）
# - SEO 优化（meta 标签、结构化数据、sitemap）
# - 可维护性（组件复用、代码简洁、文档注释）
#
# 设计原则:
# - 简洁: 避免过度设计，专注核心功能
# - 实用: 内容真实有用，不做空洞宣传
# - 性能: 静态生成，首屏加载快
# - 易维护: 清晰的目录结构，易于扩展

# ============================================================================
# 模块配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$PROJECT_DIR/web"

MODULE_NAME="官网 (Website)"
BRANCH_PREFIX="feat/web-improve"
COMMIT_PREFIX="feat(web)"
COMMIT_GENERATED="autorun_web.sh (Website Quality Improvement)"

LOG_FILE="$PROJECT_DIR/autorun_web.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_WEB_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_WEB_TASK.md"
TASK_QUEUE="$PROJECT_DIR/WEB_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/web_test.log"
TOKEN_LOG="$PROJECT_DIR/WEB_TOKEN_USAGE.log"

# ============================================================================
# 钩子: 模块专用环境检查
# ============================================================================

module_check_environment() {
    local web_files=(
        "web/package.json"
        "web/astro.config.mjs"
        "web/src/pages/index.astro"
        "web/src/pages/download.astro"
        "web/src/pages/pricing.astro"
        "web/src/pages/docs/index.astro"
        "web/src/layouts/BaseLayout.astro"
    )
    for f in "${web_files[@]}"; do
        if [ -f "$PROJECT_DIR/$f" ]; then
            log_success "网站核心文件: $f"
        else
            log_warning "网站核心文件缺失: $f"
        fi
    done

    # 检查 pnpm 和 Astro
    if command -v pnpm &> /dev/null; then
        log_success "pnpm: $(pnpm --version)"
    else
        log_error "pnpm 未安装"
        return 1
    fi

    # 检查依赖是否安装
    if [ -d "$WEB_DIR/node_modules" ]; then
        log_success "web 依赖已安装"
    else
        log_warning "web 依赖未安装，尝试安装..."
        cd "$WEB_DIR" && pnpm install
    fi
}

# ============================================================================
# 钩子: 验证任务文件路径（安全检查）
# ============================================================================

module_validate_task() {
    local task_content="$1"

    # 检查影响范围是否都在 web/ 下
    local impact_section=$(echo "$task_content" | sed -n '/\*\*影响范围\*\*/,/\*\*创建时间\*\*/p')

    # 查找影响范围中不在 web/ 下的文件路径
    local non_web_files=$(echo "$impact_section" | grep -v 'web/' | grep -E '\.(astro|tsx?|jsx?|css|md|json|mjs|html)' | grep -v '新建' | head -5)

    if [ -n "$non_web_files" ]; then
        log_error "❌ 任务影响范围包含 web/ 目录外的文件，已拒绝执行！"
        log_error "以下文件不在 web/ 目录内:"
        echo "$non_web_files" | while read -r file; do
            log_error "  - $file"
        done
        log_error ""
        log_error "官网开发脚本只能修改 web/ 目录下的文件。"
        log_error "虽然可以读取其他目录了解项目，但所有修改必须在 web/ 下。"
        return 1
    fi

    log_success "✅ 任务路径验证通过 - 所有修改都在 web/ 目录内"
    return 0
}

# ============================================================================
# 钩子: 任务队列初始内容
# ============================================================================

module_init_queue_header() {
    cat << 'EOF'
# ServerPilot 官网改进任务队列

> 此队列专注于官网内容、体验、性能的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: -

## 📊 统计

- **总任务数**: 0
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加发现的改进任务)

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`

## 设计原则

- **简洁**: 避免过度设计，专注核心功能
- **实用**: 内容真实有用，不做空洞宣传
- **性能**: 静态生成，首屏加载快
- **易维护**: 清晰的目录结构，易于扩展
EOF
}

# ============================================================================
# 钩子: 启动信息 & 进度额外行
# ============================================================================

module_banner_info() {
    log_info "聚焦领域: 内容质量 | 用户体验 | 性能优化 | SEO | 可维护性"
    log_info "设计原则: 简洁 | 实用 | 高性能 | 易维护"
}

# ============================================================================
# 钩子: 模块测试
# ============================================================================

module_run_tests() {
    log_info "运行网站质量检查..."

    cd "$WEB_DIR" || return 1

    # 1. TypeScript 类型检查
    log_info "TypeScript 类型检查..."
    if pnpm typecheck > "$TEST_LOG" 2>&1; then
        log_success "TypeScript 类型检查通过"
    else
        log_error "TypeScript 类型检查失败"
        tail -30 "$TEST_LOG"
        return 1
    fi

    # 2. 构建测试
    log_info "构建网站..."
    if pnpm build >> "$TEST_LOG" 2>&1; then
        log_success "网站构建成功"
    else
        log_error "网站构建失败"
        tail -30 "$TEST_LOG"
        return 1
    fi

    # 3. 内容检查（检查是否有假链接占位符）
    log_info "检查内容质量..."
    local has_placeholders=false

    if grep -r "#download-" "$WEB_DIR/src/pages/" > /dev/null 2>&1; then
        log_warning "发现下载占位符链接 (#download-*)"
        has_placeholders=true
    fi

    if grep -r "#cloud-signup" "$WEB_DIR/src/pages/" > /dev/null 2>&1; then
        log_warning "发现云服务占位符链接 (#cloud-signup)"
        has_placeholders=true
    fi

    if grep -r "yourusername" "$WEB_DIR/src/" > /dev/null 2>&1; then
        log_warning "发现占位符 GitHub 用户名 (yourusername)"
        has_placeholders=true
    fi

    if [ "$has_placeholders" = true ]; then
        log_info "占位符链接是正常的（等待实际内容填充）"
    fi

    # 4. 检查构建产物大小
    if [ -d "$WEB_DIR/dist" ]; then
        local dist_size=$(du -sh "$WEB_DIR/dist" | cut -f1)
        log_info "构建产物大小: $dist_size"

        # 检查是否有过大的文件
        local large_files=$(find "$WEB_DIR/dist" -type f -size +500k)
        if [ -n "$large_files" ]; then
            log_warning "发现大文件 (>500KB):"
            echo "$large_files" | while read -r file; do
                local size=$(du -h "$file" | cut -f1)
                log_warning "  - $file ($size)"
            done
        fi
    fi

    log_success "网站质量检查通过"
    return 0
}

# ============================================================================
# 钩子: Prompts
# ============================================================================

build_discover_prompt() {
    cat << 'PROMPT_EOF'
你是 ServerPilot 项目的官网质量工程师。你的任务是**深度审查**官网的内容和代码，**自主发现问题**，并生成改进任务。

## 你的职责

你不是在执行别人给你的任务，而是**自主发现问题和改进机会**。像一个资深前端工程师和内容设计师 review 网站一样，找出真正需要改进的地方。

## 必须扫描的文件（按优先级）

### 核心页面
1. `web/src/pages/index.astro` — 首页
2. `web/src/pages/download.astro` — 下载页
3. `web/src/pages/pricing.astro` — 定价页
4. `web/src/pages/docs/index.astro` — 文档导航页

### 布局和组件
5. `web/src/layouts/BaseLayout.astro` — 基础布局
6. `web/src/components/` — 所有组件（如果有）
7. `web/src/styles/global.css` — 全局样式

### 配置和文档
8. `web/astro.config.mjs` — Astro 配置
9. `web/tailwind.config.mjs` — Tailwind 配置
10. `web/README.md` — 项目文档
11. `web/package.json` — 依赖配置

### 内容目录
12. `web/src/content/` — Markdown 文档内容
13. `web/public/` — 静态资源

## 改进维度（按优先级排序）

### P0 — 核心内容缺失
- **文档内容空缺**: 文档导航页只有导航，缺少实际的 Markdown 文档内容
- **下载链接占位符**: 下载页的链接是假的 (#download-linux 等)，需要明确占位符策略或生成真实链接
- **GitHub 链接占位符**: BaseLayout 中的 GitHub URL 是 yourusername 占位符
- **favicon 缺失**: public/favicon.svg 不存在
- **关键信息缺失**: 联系方式、实际案例、用户评价等

### P1 — 用户体验问题
- **移动端适配**: 响应式设计是否完善？小屏幕下导航是否友好？
- **导航体验**: 页面间跳转是否流畅？面包屑导航是否清晰？
- **信息架构**: 内容组织是否合理？用户能否快速找到所需信息？
- **CTA 按钮**: 行动号召按钮是否明确？位置是否合理？
- **加载体验**: 是否有骨架屏？图片懒加载？

### P2 — 性能优化
- **首屏性能**: Lighthouse 分数如何？Core Web Vitals 指标？
- **图片优化**: 是否使用 WebP/AVIF？图片尺寸是否合适？
- **代码分割**: CSS/JS 是否分割？是否有未使用的代码？
- **字体加载**: 字体是否优化？是否使用 font-display: swap？

### P3 — SEO 和可发现性
- **meta 标签**: 每个页面是否有独特的 title 和 description？
- **Open Graph**: 社交媒体分享卡片是否配置？
- **结构化数据**: Schema.org 数据是否添加？
- **sitemap**: 是否生成 sitemap.xml？
- **robots.txt**: 是否配置正确？

### P4 — 可维护性和代码质量
- **组件复用**: 是否有重复代码可以抽取为组件？
- **代码简洁**: 单文件是否超过 500 行？
- **类型安全**: TypeScript 类型是否完整？
- **注释文档**: 复杂逻辑是否有注释？
- **测试**: 是否需要添加组件测试？

## 发现问题的方法

1. **内容审查**: 仔细阅读每个页面，检查内容是否完整、准确、有用
2. **用户视角**: 假设你是新用户，能否快速理解产品并完成下载/注册？
3. **设计一致性**: 颜色、字体、间距是否一致？是否符合设计系统？
4. **代码审查**: 阅读源代码，检查实现质量和可维护性
5. **性能分析**: 检查构建产物大小、未优化的资源
6. **对比最佳实践**: 参考优秀的开源项目官网（Docker, Kubernetes, Next.js）

## 设计原则约束

在生成任务时，必须遵守以下设计原则：

- **简洁优先**: 避免过度设计，不要添加复杂的动画、特效、交互
- **实用优先**: 内容要真实有用，不要写空洞的营销话术
- **性能优先**: 保持静态生成，不要引入不必要的 JS 运行时
- **易维护优先**: 组件要简单清晰，不要过度抽象

例如：
- ❌ 不要: 添加复杂的 3D 动画背景
- ✅ 可以: 添加简单的渐变背景
- ❌ 不要: 创建一个通用的 "Card" 组件系统
- ✅ 可以: 在单个页面内复用简单的卡片样式
- ❌ 不要: 添加用户行为追踪和分析
- ✅ 可以: 添加简单的访问统计（如果需要）

## 输出格式 (严格！！！)

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容。

\`\`\`tasks
### [pending] 任务标题（简明描述改进内容）

**ID**: web-XXX
**优先级**: P0/P1/P2/P3/P4
**模块路径**: web/src/xxx/
**发现的问题**: 具体描述你在代码/内容中发现的问题（引用具体文件和行号）
**改进方案**: 详细说明应该如何改进
**验收标准**: 改进完成后应该达到什么效果
**影响范围**: 这个改进会影响哪些文件
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] 另一个任务...
\`\`\`

## 重要约束

- **输出格式**: 只输出 \`\`\`tasks 代码块，不要输出表格、分析报告或其他内容
- **⚠️ 代码修改限制（强制！）**:
  - **可以读取**项目其他目录的文件（README.md, docs/, packages/ 等）以了解项目背景
  - **只能修改/新建** `web/` 目录下的文件，禁止修改其他目录
  - **影响范围必须全部在 web/ 目录内**
- **任务文件路径格式**: 修改的文件必须以 `web/` 开头，例如 `web/src/pages/index.astro`
- **必须引用具体文件**，不要泛泛而谈
- **任务粒度适中**，每个任务 1-2 小时可完成
- **不要重复已完成的任务**，先检查 WEB_TASK_QUEUE.md 中已完成的任务
- **优先 P0 问题**，只有当 P0 问题都解决后才生成 P1/P2/P3/P4
- 单文件不超过 500 行（硬限制 800 行）
- **影响范围限制**: 每个任务最多修改 3-4 个文件（且都在 web/ 下）
- **遵守设计原则**: 简洁、实用、高性能、易维护

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

build_execute_prompt() {
    local task_content="$1"

    cat << EOF
你是 ServerPilot 项目的官网质量工程师，正在执行一个具体的改进任务。

## 项目信息

- **框架**: Astro 5.0+ (静态站点生成器)
- **UI 库**: React 18 (部分组件)
- **样式**: Tailwind CSS 3
- **内容**: MDX (Markdown + JSX)
- **包管理**: pnpm

## 技术栈约束

- **静态优先**: 使用 Astro 的静态生成，避免客户端 JS
- **组件范围**: React 组件仅用于必要的交互（如表单、下拉菜单）
- **样式方式**: 优先使用 Tailwind 实用类，避免自定义 CSS
- **图片处理**: 使用 Astro 的 Image 组件进行优化

## 当前任务

$task_content

## 开发约束

- **聚焦**: 只实现当前任务，不要扩散到其他功能
- **简洁优先**: 避免过度设计，保持代码简单
- **性能优先**: 不引入不必要的 JS，优先静态生成
- **易维护优先**: 代码清晰易懂，不过度抽象
- **单文件不超过 500 行** (硬限制 800 行)
- **⚠️ 代码修改限制（强制！）**:
  - 可以读取项目其他目录的文件（了解项目背景、复用内容等）
  - 只能修改/新建 web/ 目录下的文件
  - 所有代码、样式、配置的修改必须在 web/ 下
  - 如果任务需要修改 web/ 外的文件，立即停止并报告错误

## 测试验证

完成后运行:
\`\`\`bash
cd web
pnpm typecheck    # TypeScript 类型检查
pnpm build        # 构建测试
pnpm preview      # 本地预览
\`\`\`

开始实现...
EOF
}

build_fix_prompt() {
    local test_output="$1"

    cat << EOF
网站改进后测试失败，请分析并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的原因
2. 定位问题代码（一定在最近的改动中）
3. 修复代码而不是削弱检查
4. 确保修复不引入新问题

## 关键注意

- Astro 构建错误通常是导入路径或语法问题
- TypeScript 类型错误需要修复类型定义，不要用 any
- 构建产物过大需要优化资源，不是放宽限制
- 保持设计原则: 简洁、实用、高性能、易维护

开始修复...
EOF
}

# ============================================================================
# 加载公共模块并运行
# ============================================================================

source "$SCRIPT_DIR/autorun-common.sh"
autorun_main "$@"
