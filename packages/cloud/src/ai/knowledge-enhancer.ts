// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { getMCPClientManager } from '../mcp/client-manager.js';
import type { SearchDocsParams } from '../mcp/client-manager.js';

export interface KnowledgeEnhancerConfig {
  /**
   * 是否启用 Context7 搜索
   */
  enabled: boolean;

  /**
   * Context7 API Key
   */
  apiKey?: string;

  /**
   * 默认搜索源
   */
  defaultSources?: string[];

  /**
   * 最大搜索结果数
   */
  maxResults?: number;

  /**
   * 知识上下文的 token 预算（占总 token 的百分比）
   */
  tokenBudgetPercent?: number;
}

/**
 * AI 对话知识增强服务
 *
 * 在 AI 对话前,根据用户消息搜索相关文档并注入到 system prompt
 */
export class KnowledgeEnhancer {
  private config: Required<KnowledgeEnhancerConfig>;
  private connected = false;

  constructor(config: KnowledgeEnhancerConfig) {
    this.config = {
      enabled: config.enabled,
      apiKey: config.apiKey ?? '',
      defaultSources: config.defaultSources ?? [],
      maxResults: config.maxResults ?? 3,
      tokenBudgetPercent: config.tokenBudgetPercent ?? 0.1, // 10%
    };
  }

  /**
   * 初始化连接到 Context7
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled || !this.config.apiKey) {
      return;
    }

    if (this.connected) {
      return;
    }

    try {
      const manager = getMCPClientManager();
      await manager.connectContext7(this.config.apiKey);
      this.connected = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[KnowledgeEnhancer] Failed to connect to Context7: ${message}`);
      // Don't throw — graceful degradation
    }
  }

  /**
   * 根据用户消息搜索相关文档
   *
   * @param userMessage - 用户消息
   * @param modelContextWindow - 模型的上下文窗口大小(tokens)
   * @returns 相关文档内容
   */
  async searchRelevantDocs(
    userMessage: string,
    modelContextWindow: number
  ): Promise<string | null> {
    if (!this.config.enabled || !this.connected) {
      return null;
    }

    try {
      // 1. 检测意图 — 是否需要查询文档
      const needsDocs = this.detectDocsIntent(userMessage);
      if (!needsDocs) {
        return null;
      }

      // 2. 提取关键词和搜索源
      const { query, sources } = this.extractSearchParams(userMessage);

      // 3. 搜索文档
      const manager = getMCPClientManager();
      const results = await manager.searchDocs({
        query,
        sources: sources.length > 0 ? sources : this.config.defaultSources,
        maxResults: this.config.maxResults,
      });

      if (results.length === 0) {
        return null;
      }

      // 4. 构建知识上下文(限制 token 使用)
      const tokenBudget = Math.floor(modelContextWindow * this.config.tokenBudgetPercent);
      const knowledgeContext = this.buildKnowledgeContext(results, tokenBudget);

      return knowledgeContext;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[KnowledgeEnhancer] Search failed: ${message}`);
      return null; // Graceful degradation
    }
  }

  /**
   * 检测用户消息是否需要查询文档
   */
  private detectDocsIntent(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // 技术关键词
    const techKeywords = [
      'nginx', 'apache', 'docker', 'kubernetes', 'redis', 'mysql',
      'postgres', 'mongodb', 'python', 'node', 'java', 'go',
      'react', 'vue', 'angular', 'typescript', 'javascript',
    ];

    // 疑问词
    const questionWords = [
      'how', 'what', 'why', 'when', 'where', 'which',
      '如何', '怎么', '为什么', '什么', '哪里',
    ];

    // 配置/问题关键词
    const configKeywords = [
      'config', 'configure', 'setup', 'install', 'deploy',
      'error', 'issue', 'problem', 'fix', 'troubleshoot',
      '配置', '安装', '部署', '错误', '问题', '修复',
    ];

    const hasTechKeyword = techKeywords.some((kw) => lowerMessage.includes(kw));
    const hasQuestionWord = questionWords.some((kw) => lowerMessage.includes(kw));
    const hasConfigKeyword = configKeywords.some((kw) => lowerMessage.includes(kw));

    // 至少有技术关键词 + (疑问词 或 配置关键词)
    return hasTechKeyword && (hasQuestionWord || hasConfigKeyword);
  }

  /**
   * 从用户消息中提取搜索参数
   */
  private extractSearchParams(message: string): { query: string; sources: string[] } {
    // 简化实现: 直接使用用户消息作为查询
    // 实际生产环境可以使用 LLM 提取关键词

    const lowerMessage = message.toLowerCase();

    // 检测常见技术栈
    const sourceMap: Record<string, string[]> = {
      nginx: ['nginx'],
      apache: ['apache'],
      docker: ['docker'],
      kubernetes: ['kubernetes', 'k8s'],
      redis: ['redis'],
      mysql: ['mysql'],
      postgres: ['postgresql', 'postgres'],
      mongodb: ['mongodb', 'mongo'],
      python: ['python'],
      node: ['node', 'nodejs'],
    };

    const detectedSources: string[] = [];
    for (const [source, keywords] of Object.entries(sourceMap)) {
      if (keywords.some((kw) => lowerMessage.includes(kw))) {
        detectedSources.push(source);
      }
    }

    return {
      query: message,
      sources: detectedSources,
    };
  }

  /**
   * 构建知识上下文字符串(限制 token 使用)
   */
  private buildKnowledgeContext(results: string[], tokenBudget: number): string {
    // 粗略估算: 1 token ≈ 4 characters
    const charBudget = tokenBudget * 4;

    const header = '## 相关文档参考\n\n';
    let context = header;
    let currentLength = header.length;

    for (let i = 0; i < results.length; i++) {
      const section = `### 文档片段 ${i + 1}\n\n${results[i]}\n\n`;

      if (currentLength + section.length > charBudget) {
        // Exceeded budget — truncate last section
        const remaining = charBudget - currentLength;
        if (remaining > 100) {
          context += `### 文档片段 ${i + 1}\n\n${results[i].slice(0, remaining - 50)}...\n\n(已截断)\n`;
        }
        break;
      }

      context += section;
      currentLength += section.length;
    }

    return context;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      const manager = getMCPClientManager();
      await manager.disconnect('context7');
      this.connected = false;
    }
  }
}
