### [pending] Skill 导出为可分发归档包

**ID**: skill-098
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: Skill 安装仅支持 Git URL 和本地目录。无法将已安装的 Skill 打包为可分发的归档文件 (.tar.gz)，阻碍 Skill 在非 Git 环境中的分享。
**实现方案**: 
1. 新建 `core/skill/skill-archive.ts` (~150 行):
   - `exportSkill(skillId: string): Promise<{ filename: string; buffer: Buffer }>` 
   - 读取 skill 目录 → 验证 manifest → tar.gz 打包 (使用 Node.js `zlib` + `tar` 或内置 API)
   - 排除: .git/, node_modules/, *.test.*, .DS_Store
   - 文件名格式: `{name}-{version}.tar.gz`
2. `importSkill(buffer: Buffer, userId: string): Promise<InstalledSkill>`
   - 解压到临时目录 → 验证 manifest → 移动到 `skills/community/{name}/` → 调用 engine.install()
3. 对应测试文件 `skill-archive.test.ts`
**验收标准**: 
- 可导出 skill 为 .tar.gz
- 可从 .tar.gz 导入安装 skill
- 导入时验证 manifest schema
- 测试覆盖: ≥8 个测试用例
**影响范围**: 新建 packages/server/src/core/skill/skill-archive.ts, skill-archive.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
