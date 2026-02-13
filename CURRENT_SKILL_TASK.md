### [done] Skill Archive 导入路径遍历防护 — 修复 zip-slip 安全漏洞

**ID**: skill-100
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `skill-archive.ts` 的 `extractTarGz()` 函数直接调用 `tar xzf -` 解压到目标目录，没有对解压后的文件路径做任何校验。恶意构造的 tar.gz 归档可以包含 `../../etc/passwd` 等路径遍历条目，在解压时写入任意位置 (zip-slip / tar-slip 攻击)。
**实现方案**: 
1. 在 `extractTarGz()` 中添加 `--strip-components=0` 并使用 `tar --list` 预扫描归档内容
2. 实现 `validateArchivePaths(entries: string[], targetDir: string)` 函数:
   - 使用 `path.resolve()` 解析每个条目的绝对路径
   - 验证 `resolvedPath.startsWith(targetDir)` — 任何路径逃逸则抛出错误
   - 拒绝包含 `..` 的路径、绝对路径 (`/etc/...`)、符号链接
3. 在实际解压前先调用 `validateArchivePaths()`，不通过则拒绝导入
4. 添加 `--no-same-owner --no-same-permissions` 标志到 tar 命令防止权限提升
**验收标准**: 
- 包含 `../` 路径的 tar.gz 归档被拒绝导入
- 包含绝对路径的 tar.gz 归档被拒绝导入
- 正常归档不受影响
- 测试覆盖: ≥6 个测试 (正常路径 + 路径遍历 + 绝对路径 + 符号链接 + 深层嵌套)
**影响范围**: packages/server/src/core/skill/skill-archive.ts, packages/server/src/core/skill/skill-archive.test.ts
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13

---
