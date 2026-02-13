// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Template-based chat fallback when AI providers are completely unavailable.
 * Provides helpful command templates for common DevOps scenarios.
 * @module ai/chat-fallback
 */

const FALLBACK_TEMPLATES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/(?:install|安装)\s+(.+)/i, (m) => {
    const pkg = m[1].trim();
    return `⚠️ AI 服务暂不可用。以下是 **${pkg}** 的标准安装模板：\n\n` +
      `\`\`\`bash\n# Debian/Ubuntu\nsudo apt update && sudo apt install -y ${pkg}\n\n` +
      `# RHEL/CentOS\nsudo yum install -y ${pkg}\n\n` +
      `# macOS (Homebrew)\nbrew install ${pkg}\n\`\`\`\n\n` +
      '请确认包名并根据系统调整命令。如持续出现此问题，请检查 AI 配置。';
  }],
  [/(?:restart|重启|reload)\s+(.+)/i, (m) => {
    const svc = m[1].trim();
    return `⚠️ AI 服务暂不可用。以下是 **${svc}** 的标准重启模板：\n\n` +
      `\`\`\`bash\nsudo systemctl restart ${svc}\nsudo systemctl status ${svc}\n\`\`\`\n\n` +
      `若启动失败，查看日志：\n\`\`\`bash\nsudo journalctl -u ${svc} --no-pager -n 50\n\`\`\``;
  }],
  [/(?:status|状态|check)\s+(.+)/i, (m) => {
    const svc = m[1].trim();
    return `⚠️ AI 服务暂不可用。以下是 **${svc}** 的状态检查模板：\n\n` +
      `\`\`\`bash\nsudo systemctl status ${svc}\nsudo journalctl -u ${svc} --no-pager -n 20\n\`\`\``;
  }],
];

/**
 * Match user message against template patterns for common DevOps tasks.
 * Returns a template-based response when AI is unavailable, or a generic
 * error message with troubleshooting guidance.
 */
export function generateChatFallback(userMessage: string): string {
  for (const [pattern, build] of FALLBACK_TEMPLATES) {
    const match = userMessage.match(pattern);
    if (match) return build(match);
  }
  return '⚠️ AI 服务暂不可用。\n\n可能原因：\n- API Key 无效或未配置\n' +
    '- AI 服务网络连接异常\n- API 配额耗尽\n\n' +
    '请在 **设置 → AI Provider** 中检查配置，或切换至其他 Provider。';
}
