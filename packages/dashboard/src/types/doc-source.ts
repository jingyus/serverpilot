/** Types for documentation source management. */

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch?: string;
  paths?: string[];
  extensions?: string[];
  maxFiles?: number;
}

export interface WebsiteConfig {
  baseUrl: string;
  pages?: string[];
  maxDepth?: number;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface DocSource {
  id: string;
  name: string;
  software: string;
  type: 'github' | 'website';
  enabled: boolean;
  autoUpdate: boolean;
  updateFrequencyHours: number;
  lastFetchedAt: string | null;
  lastFetchStatus: 'success' | 'failed' | 'pending' | null;
  documentCount: number;
  createdAt: string;
}

export interface DocSourceDetail extends DocSource {
  githubConfig: GitHubConfig | null;
  websiteConfig: WebsiteConfig | null;
  lastFetchError: string | null;
  lastSha: string | null;
  lastHash: string | null;
}

export interface CreateDocSourceInput {
  name: string;
  software: string;
  type: 'github' | 'website';
  githubConfig?: GitHubConfig;
  websiteConfig?: WebsiteConfig;
  enabled?: boolean;
  autoUpdate?: boolean;
  updateFrequencyHours?: number;
}

export interface UpdateDocSourceInput {
  name?: string;
  enabled?: boolean;
  autoUpdate?: boolean;
  updateFrequencyHours?: number;
  githubConfig?: GitHubConfig;
  websiteConfig?: WebsiteConfig;
}

export interface DocSourceStatus {
  lastFetchedAt: string | null;
  lastFetchStatus: 'success' | 'failed' | 'pending' | null;
  lastFetchError: string | null;
  documentCount: number;
  shouldUpdate: boolean;
}

export interface FetchTask {
  id: string;
  status: 'completed' | 'failed';
  summary?: Record<string, unknown>;
}
