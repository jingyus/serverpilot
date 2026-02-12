### [pending] quality-checker.ts 重复定义 RiskLevel — 与 shared 模块不同步风险

**ID**: chat-041
**优先级**: P2
**模块路径**: packages/server/src/ai/quality-checker.ts
**发现的问题**: 第 24-32 行定义了本地 `RiskLevel` 常量 `{ GREEN, YELLOW, RED, CRITICAL, FORBIDDEN }`，而 `@aiinstaller/shared/security` 已有完整的 RiskLevel 定义（5 个级别 + 类型）。两份定义需要手动保持同步。如果 shared 模块新增一个风险级别（如 `ORANGE`），`quality-checker.ts` 不会自动感知。
**改进方案**: 删除 `quality-checker.ts` 中的本地 `RiskLevel` 定义，改为从 `@aiinstaller/shared` 导入。检查值映射是否完全一致（shared 用 `'green'|'yellow'|'red'|'critical'|'forbidden'` 字符串），确保 quality-checker 的 switch/if 逻辑兼容。
**验收标准**: 1) quality-checker.ts 不再有本地 RiskLevel 定义 2) 从 shared 导入并正常工作 3) 类型检查通过 4) 现有测试不变
**影响范围**: `packages/server/src/ai/quality-checker.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
