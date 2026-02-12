### [pending] Skill 执行分析 Dashboard — 成功率、耗时趋势、热门 Skill 统计

**ID**: skill-078
**优先级**: P2
**模块路径**: packages/server/src/api/routes/skills.ts, packages/dashboard/src/pages/Skills.tsx
**当前状态**: 功能缺失 — 当前 Dashboard Skills 页面只有 "Installed" 和 "Available" 两个 tab，没有执行统计视图。`skill_executions` 表已有完整的执行记录（status、duration、stepsExecuted），但无聚合查询 API 和可视化展示。
**实现方案**: 
1. 新增 API: `GET /api/v1/skills/stats` — 返回聚合统计:
   - 总执行次数、成功率、平均耗时
   - 按 Skill 分组的执行次数排名 (top 5)
   - 按日期分组的执行趋势 (最近 30 天)
   - 按触发类型分组的分布 (manual/cron/event/threshold)
2. `SkillRepository` 添加 `getStats(userId, dateRange?)` 聚合方法
3. Dashboard: 在 Skills 页面添加第三个 tab "Analytics"，展示统计图表
4. 使用简单的 CSS 进度条或文本统计（不引入重量级图表库）
**验收标准**: 
- `/api/v1/skills/stats` 返回结构化统计数据
- Dashboard 展示执行成功率、平均耗时、Top Skills
- RBAC: `skill:view` 权限即可查看统计
- 测试 ≥ 8 个（API 3 + repo 3 + dashboard 2）
**影响范围**: packages/server/src/api/routes/skills.ts, packages/server/src/db/repositories/skill-repository.ts, packages/dashboard/src/pages/Skills.tsx, packages/dashboard/src/stores/skills.ts, packages/dashboard/src/types/skill.ts
**创建时间**: (自动填充)
**完成时间**: -
