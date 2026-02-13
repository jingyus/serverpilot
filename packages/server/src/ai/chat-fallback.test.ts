// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { generateChatFallback } from './chat-fallback.js';

describe('generateChatFallback', () => {
  it('should return install template for "install nginx"', () => {
    const result = generateChatFallback('install nginx');
    expect(result).toContain('nginx');
    expect(result).toContain('apt');
    expect(result).toContain('yum');
    expect(result).toContain('brew');
    expect(result).toContain('AI 服务暂不可用');
  });

  it('should return install template for Chinese "安装 docker"', () => {
    const result = generateChatFallback('安装 docker');
    expect(result).toContain('docker');
    expect(result).toContain('apt');
  });

  it('should return restart template for "restart nginx"', () => {
    const result = generateChatFallback('restart nginx');
    expect(result).toContain('systemctl restart nginx');
    expect(result).toContain('journalctl');
  });

  it('should return restart template for Chinese "重启 mysql"', () => {
    const result = generateChatFallback('重启 mysql');
    expect(result).toContain('systemctl restart mysql');
  });

  it('should return status template for "check redis"', () => {
    const result = generateChatFallback('check redis');
    expect(result).toContain('systemctl status redis');
  });

  it('should return status template for Chinese "状态 postgresql"', () => {
    const result = generateChatFallback('状态 postgresql');
    expect(result).toContain('systemctl status postgresql');
  });

  it('should return generic error for unmatched messages', () => {
    const result = generateChatFallback('what is the weather?');
    expect(result).toContain('AI 服务暂不可用');
    expect(result).toContain('API Key');
    expect(result).toContain('AI Provider');
  });

  it('should return generic error for empty message', () => {
    const result = generateChatFallback('');
    expect(result).toContain('AI 服务暂不可用');
  });
});
