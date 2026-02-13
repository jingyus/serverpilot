### [pending] 社区 Skill 示例 — 添加 2 个示范性社区 Skill

**ID**: skill-083
**优先级**: P3
**模块路径**: skills/community/
**当前状态**: skills/community/ 目录为空，GET /skills/available 端点已支持扫描但无内容可展示
**实现方案**: 创建 2 个社区示范 Skill:
1. `skills/community/disk-space-monitor/skill.yaml` — 磁盘空间监控，threshold 触发，超过阈值通知
2. `skills/community/ssl-cert-checker/skill.yaml` — SSL 证书到期检查，cron 触发 (每日)，到期前 N 天告警
每个 Skill 仅需 skill.yaml 文件 (prompt-centric 设计，无代码)
**验收标准**: Dashboard Available 标签页能展示 5 个可安装 Skill (3 official + 2 community)
**影响范围**: skills/community/disk-space-monitor/skill.yaml, skills/community/ssl-cert-checker/skill.yaml (2 个新文件)
**创建时间**: 2026-02-13
**完成时间**: -

---
