### [pending] SkillLoader — YAML 解析 + Schema 验证 + 变量模板引擎

**ID**: skill-002
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `core/skill/` 目录不存在 — 整个引擎为空白状态
**实现方案**:

1. **创建 `core/skill/` 目录**
2. **loader.ts** (~200 行):
   - `loadSkillFromDir(dirPath: string): Promise<SkillManifest>` — 读取 `skill.yaml`，YAML 解析，调用 shared 的 `validateSkillManifest()` 验证
   - `scanSkillDirectories(basePaths: string[]): Promise<ScannedSkill[]>` — 扫描 `skills/official/` 和自定义目录，返回所有可用 Skill
   - `resolvePromptTemplate(prompt: string, vars: TemplateVars): string` — 替换 `{{input.*}}`, `{{server.*}}`, `{{env.*}}` 变量
   - `checkRequirements(requires: SkillManifest['requires'], serverProfile?: ServerProfile): RequirementCheckResult` — OS/命令/Agent 版本检查
   - 使用 `js-yaml` 库解析 YAML（需添加依赖: `pnpm --filter @aiinstaller/server add js-yaml && pnpm --filter @aiinstaller/server add -D @types/js-yaml`）
3. **loader.test.ts** (~200 行):
   - 测试: 有效 YAML 解析 (使用 official 的 3 个 Skill)、无效 YAML 拒绝、缺少 kind/version 拒绝
   - 测试: 模板变量替换 (正常替换、未定义变量保留、嵌套变量)
   - 测试: 需求检查 (OS 匹配/不匹配、命令依赖)
   - 测试: 目录扫描 (空目录、多个 Skill、无效 Skill 跳过)

**验收标准**:
- 能成功加载 `skills/official/` 下的 3 个官方 Skill
- 模板变量 `{{input.backup_dir}}` 被正确替换为用户配置值
- 无效 YAML / 不合规 Schema 抛出明确错误消息
- 测试 ≥ 15 个

**影响范围**:
- `packages/server/src/core/skill/loader.ts` (新建)
- `packages/server/src/core/skill/loader.test.ts` (新建)
- `packages/server/package.json` (新增 js-yaml 依赖)

**创建时间**: 2026-02-12
**完成时间**: -

---
