### [pending] Skill 开发者文档 — 创建 skills/DEVELOPMENT.md 指南

**ID**: skill-081
**优先级**: P3
**模块路径**: skills/
**当前状态**: 文件不存在 — 仅有 SKILL_SPEC.md (内部规范)，缺少面向用户的开发指南
**实现方案**: 创建 `skills/DEVELOPMENT.md`，内容包括:
1. "构建你的第一个 Skill" 教程 (从 skill.yaml 到测试执行)
2. 可用工具 API 参考 (shell, read_file, write_file, notify, http, store)
3. 触发类型详解 (manual/cron/event/threshold) + 配置示例
4. 模板变量指南 ({{server.name}}, {{input.*}}, {{skill.last_run}})
5. 安全模型 & 风险等级说明 (green/yellow/red/critical + risk_level_max)
6. Prompt 工程最佳实践
**验收标准**: 新用户阅读后能独立创建并测试自定义 Skill
**影响范围**: skills/DEVELOPMENT.md (1 个新文件)
**创建时间**: 2026-02-13
**完成时间**: -

---
