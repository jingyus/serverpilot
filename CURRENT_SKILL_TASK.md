### [pending] 社区 Skill 安装 — 从 Git URL 克隆 + 安全扫描

**ID**: skill-011
**优先级**: P4
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 当前仅支持从本地目录安装 (`engine.ts:install()` 接受 `skillDir` 参数为本地路径)；`POST /api/v1/skills/install` 只接收 `{ name, source }`，无 Git URL 字段
**实现方案**:

1. **core/skill/git-installer.ts** (~120 行):
   - `installFromGitUrl(url: string, targetDir: string): Promise<string>` — 执行 `git clone --depth 1` 到 `skills/community/<name>/`
   - URL 验证: 仅允许 `https://` 协议 (拒绝 `git://`, `ssh://`)
   - 目录命名: 从 URL 提取仓库名 (如 `https://github.com/user/my-skill.git` → `skills/community/my-skill/`)
   - 克隆后验证: 检查 `skill.yaml` 是否存在 + Schema 验证
   - 失败回滚: 克隆失败或验证失败则删除目录
2. **安全扫描** (~50 行，集成到 git-installer.ts 或单独文件):
   - 检查 skill.yaml 中是否有 `risk_level_max: critical` 或 `forbidden` — 警告用户
   - 扫描 prompt 长度 (异常大的 prompt 可能是注入尝试)
   - 不执行任何从 Git 仓库引入的可执行文件
3. **更新 api/routes/skills.ts**:
   - `POST /api/v1/skills/install` 扩展 body: `{ name, source, gitUrl? }`
   - 当 `gitUrl` 存在时: 调用 `installFromGitUrl()` → 再调用 `engine.install()`
   - 权限: `skill:manage` (仅 admin/owner 可安装社区 Skill)
4. **git-installer.test.ts** (~100 行):
   - Mock `child_process.exec` (不实际 git clone)
   - 测试: 有效 URL 解析、无效 URL 拒绝、协议限制 (ssh 拒绝)
   - 测试: 克隆后验证成功/失败
   - 测试: 失败回滚清理目录

**验收标准**:
- 能通过 API 传入 Git HTTPS URL 安装社区 Skill
- 仅允许 HTTPS 协议 (拒绝 SSH/Git 协议)
- 克隆后自动验证 skill.yaml 合规性
- 失败时自动清理目录 (无残留)
- 测试 ≥ 8 个

**影响范围**:
- `packages/server/src/core/skill/git-installer.ts` (新建)
- `packages/server/src/core/skill/git-installer.test.ts` (新建)
- `packages/server/src/api/routes/skills.ts` (修改 — 扩展 install 端点)
- `packages/server/src/api/routes/schemas.ts` (修改 — 扩展 InstallSkillBody)

**创建时间**: (自动填充)
**完成时间**: -

---
