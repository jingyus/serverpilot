/**
 * Knowledge base types
 */

export type KnowledgeSource = 'builtin' | 'auto_learn' | 'scrape' | 'community';

export interface KnowledgeEntry {
  commands: string[];
  verification?: string;
  notes?: string[];
  platform?: string;
}

export interface Knowledge {
  id: string;
  software: string;
  platform: string;
  content: KnowledgeEntry;
  source: KnowledgeSource;
  successCount: number;
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  query: string;
  count: number;
  results: Knowledge[];
}
