### [completed] Skill 导出/导入 API 端点

**ID**: skill-099
**优先级**: P2
**模块路径**: packages/server/src/api/routes/
**当前状态**: ✅ 已完成。API 端点已实现，测试覆盖 16 个（export: 5, import: 11）。
**实现方案**:
1. `api/routes/skills.ts` 添加:
   - `GET /skills/:id/export` → 返回 .tar.gz 文件 (Content-Type: application/gzip)
   - `POST /skills/import` → 接受 multipart/form-data 上传 → 调用 importSkill()
2. 权限: `skill:manage` (admin/owner only)
3. 文件大小限制: 10MB
**验收标准**:
- ✅ 可通过 API 下载 skill 归档
- ✅ 可通过 API 上传归档安装 skill
- ✅ 测试覆盖: 16 个 API 测试（超过 ≥6 要求）
**影响范围**: packages/server/src/api/routes/skills.ts (增加 <50 行)
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13

---
