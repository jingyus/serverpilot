// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SearchDocsParams {
  query: string;
  sources?: string[];
  maxResults?: number;
}

/**
 * MCP Client Manager — 管理多个 MCP Server 连接
 *
 * 支持的 MCP Servers:
 * - Context7: 文档搜索（官方文档、StackOverflow、GitHub）
 * - GitHub: 代码仓库、Issue、PR
 * - Jira: 工单管理
 */
export class MCPClientManager {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();

  /**
   * 连接到 Context7 MCP Server
   *
   * @param apiKey - Context7 API Key
   */
  async connectContext7(apiKey: string): Promise<void> {
    if (this.clients.has('context7')) {
      // Already connected
      return;
    }

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@context7/mcp-server', apiKey],
    });

    const client = new Client(
      {
        name: 'serverpilot-cloud',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);

    this.clients.set('context7', client);
    this.transports.set('context7', transport);
  }

  /**
   * 搜索文档（调用 Context7 的 search tool）
   *
   * @param params - 搜索参数
   * @returns 搜索结果数组
   *
   * @example
   * ```ts
   * const results = await manager.searchDocs({
   *   query: 'nginx reverse proxy websocket',
   *   sources: ['nginx', 'docker'],
   *   maxResults: 5
   * });
   * ```
   */
  async searchDocs(params: SearchDocsParams): Promise<string[]> {
    const client = this.clients.get('context7');
    if (!client) {
      throw new Error('Context7 not connected. Call connectContext7() first.');
    }

    try {
      const result = await client.callTool({
        name: 'search',
        arguments: {
          query: params.query,
          sources: params.sources,
          max_results: params.maxResults ?? 5,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.extractTextContent(result as any);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Context7 search failed: ${message}`);
    }
  }

  /**
   * 获取指定 URL 的文档内容
   *
   * @param url - 文档 URL
   * @returns 文档内容
   */
  async fetchDocument(url: string): Promise<string> {
    const client = this.clients.get('context7');
    if (!client) {
      throw new Error('Context7 not connected. Call connectContext7() first.');
    }

    try {
      const result = await client.callTool({
        name: 'fetch',
        arguments: { url },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = this.extractTextContent(result as any);
      return content.join('\n\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Context7 fetch failed: ${message}`);
    }
  }

  /**
   * 断开指定 MCP Server 连接
   */
  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    const transport = this.transports.get(serverName);

    if (client) {
      await client.close();
      this.clients.delete(serverName);
    }

    if (transport) {
      await transport.close();
      this.transports.delete(serverName);
    }
  }

  /**
   * 断开所有 MCP Server 连接
   */
  async disconnectAll(): Promise<void> {
    const serverNames = Array.from(this.clients.keys());
    await Promise.all(serverNames.map((name) => this.disconnect(name)));
  }

  /**
   * 检查指定 MCP Server 是否已连接
   */
  isConnected(serverName: string): boolean {
    return this.clients.has(serverName);
  }

  /**
   * 获取所有已连接的 MCP Server 名称
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 从 CallToolResult 中提取文本内容
   */
  private extractTextContent(result: CallToolResult): string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResult = result as any;

    // Handle both old format (content field) and new format (content inside result)
    const content = anyResult.content || anyResult.toolResult?.content || anyResult.result?.content;

    if (!content || !Array.isArray(content)) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => (item.text ? String(item.text) : ''))
      .filter((text: string) => text.length > 0);
  }
}

// Singleton instance
let mcpClientManager: MCPClientManager | null = null;

/**
 * 获取 MCP Client Manager 单例
 */
export function getMCPClientManager(): MCPClientManager {
  if (!mcpClientManager) {
    mcpClientManager = new MCPClientManager();
  }
  return mcpClientManager;
}

/**
 * 重置 MCP Client Manager（用于测试）
 */
export async function _resetMCPClientManager(): Promise<void> {
  if (mcpClientManager) {
    await mcpClientManager.disconnectAll();
    mcpClientManager = null;
  }
}
