// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Vector database backend selector module.
 *
 * Evaluates environment conditions (network, dependencies, configuration)
 * and recommends the best vector database backend for the knowledge base.
 *
 * Supported backends:
 * - **local**: In-memory TF-IDF (default, zero dependencies, already implemented)
 * - **qdrant**: Qdrant open-source vector database (recommended for production)
 * - **pinecone**: Pinecone cloud vector database (managed service)
 *
 * @module knowledge/vector-db-selector
 */

// ============================================================================
// Types
// ============================================================================

/** Supported vector database backends */
export type VectorDBBackend = 'local' | 'qdrant' | 'pinecone';

/** Environment check results used for backend selection */
export interface EnvironmentCheck {
  /** Whether QDRANT_URL environment variable is set */
  hasQdrantUrl: boolean;
  /** Whether PINECONE_API_KEY environment variable is set */
  hasPineconeApiKey: boolean;
  /** Whether PINECONE_ENVIRONMENT environment variable is set */
  hasPineconeEnvironment: boolean;
  /** Whether VECTOR_DB_BACKEND environment variable is set (explicit override) */
  explicitBackend: VectorDBBackend | null;
  /** Estimated number of documents in the knowledge base */
  documentCount: number;
}

/** Information about a vector database backend */
export interface BackendInfo {
  /** Backend identifier */
  id: VectorDBBackend;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Whether this backend requires external dependencies */
  requiresExternalDeps: boolean;
  /** Whether this backend requires network access */
  requiresNetwork: boolean;
  /** Required environment variables */
  requiredEnvVars: string[];
  /** Maximum recommended document count (0 = unlimited) */
  maxRecommendedDocs: number;
  /** Pros of using this backend */
  pros: string[];
  /** Cons of using this backend */
  cons: string[];
}

/** Result of the backend selection process */
export interface SelectionResult {
  /** The selected backend */
  selected: VectorDBBackend;
  /** Reason for selection */
  reason: string;
  /** Whether this was explicitly configured or auto-detected */
  isExplicit: boolean;
  /** All available backends with their availability status */
  available: Array<{
    backend: VectorDBBackend;
    isAvailable: boolean;
    unavailableReason?: string;
  }>;
  /** Recommendation for the user */
  recommendation: string;
}

// ============================================================================
// Backend Registry
// ============================================================================

/** Registry of all supported vector database backends */
export const BACKENDS: Record<VectorDBBackend, BackendInfo> = {
  local: {
    id: 'local',
    name: 'Local TF-IDF',
    description: 'In-memory TF-IDF vector database with cosine similarity search',
    requiresExternalDeps: false,
    requiresNetwork: false,
    requiredEnvVars: [],
    maxRecommendedDocs: 1000,
    pros: [
      'Zero dependencies - works out of the box',
      'No network required',
      'Fast for small knowledge bases',
      'No cost',
    ],
    cons: [
      'Not suitable for large document sets (>1000)',
      'No persistence across restarts',
      'TF-IDF is less accurate than neural embeddings',
    ],
  },
  qdrant: {
    id: 'qdrant',
    name: 'Qdrant',
    description: 'Open-source vector database with neural embedding support',
    requiresExternalDeps: true,
    requiresNetwork: true,
    requiredEnvVars: ['QDRANT_URL'],
    maxRecommendedDocs: 0, // unlimited
    pros: [
      'Open-source and self-hostable',
      'Supports neural embeddings for better accuracy',
      'Scales to millions of documents',
      'Persistent storage',
      'Rich filtering and payload support',
    ],
    cons: [
      'Requires running a Qdrant server',
      'Requires QDRANT_URL configuration',
      'More complex setup',
    ],
  },
  pinecone: {
    id: 'pinecone',
    name: 'Pinecone',
    description: 'Fully managed cloud vector database service',
    requiresExternalDeps: true,
    requiresNetwork: true,
    requiredEnvVars: ['PINECONE_API_KEY', 'PINECONE_ENVIRONMENT'],
    maxRecommendedDocs: 0, // unlimited
    pros: [
      'Fully managed - no infrastructure to maintain',
      'High availability and scalability',
      'Neural embedding support',
      'Persistent storage',
    ],
    cons: [
      'Requires API key and paid plan for production',
      'Requires network access',
      'Data stored in the cloud',
      'Vendor lock-in',
    ],
  },
};

// ============================================================================
// Environment Check
// ============================================================================

/**
 * Check the current environment for vector database configuration.
 *
 * Reads environment variables and optionally accepts a document count
 * to determine which backends are available.
 *
 * @param env - Environment variables (defaults to process.env)
 * @param documentCount - Estimated number of documents (default: 0)
 * @returns Environment check results
 */
export function checkEnvironment(
  env: Record<string, string | undefined> = process.env,
  documentCount = 0,
): EnvironmentCheck {
  const explicitBackendRaw = env.VECTOR_DB_BACKEND?.toLowerCase().trim() ?? '';
  let explicitBackend: VectorDBBackend | null = null;

  if (explicitBackendRaw === 'local' || explicitBackendRaw === 'qdrant' || explicitBackendRaw === 'pinecone') {
    explicitBackend = explicitBackendRaw;
  }

  return {
    hasQdrantUrl: Boolean(env.QDRANT_URL?.trim()),
    hasPineconeApiKey: Boolean(env.PINECONE_API_KEY?.trim()),
    hasPineconeEnvironment: Boolean(env.PINECONE_ENVIRONMENT?.trim()),
    explicitBackend,
    documentCount,
  };
}

// ============================================================================
// Backend Availability
// ============================================================================

/**
 * Check if a specific backend is available given the environment.
 *
 * @param backend - Backend to check
 * @param envCheck - Environment check results
 * @returns Whether the backend is available and why not if unavailable
 */
export function isBackendAvailable(
  backend: VectorDBBackend,
  envCheck: EnvironmentCheck,
): { available: boolean; reason?: string } {
  const info = BACKENDS[backend];

  switch (backend) {
    case 'local':
      return { available: true };

    case 'qdrant':
      if (!envCheck.hasQdrantUrl) {
        return {
          available: false,
          reason: `Missing required environment variable: ${info.requiredEnvVars.join(', ')}`,
        };
      }
      return { available: true };

    case 'pinecone':
      if (!envCheck.hasPineconeApiKey || !envCheck.hasPineconeEnvironment) {
        const missing = [];
        if (!envCheck.hasPineconeApiKey) missing.push('PINECONE_API_KEY');
        if (!envCheck.hasPineconeEnvironment) missing.push('PINECONE_ENVIRONMENT');
        return {
          available: false,
          reason: `Missing required environment variable(s): ${missing.join(', ')}`,
        };
      }
      return { available: true };

    default:
      return { available: false, reason: `Unknown backend: ${backend as string}` };
  }
}

// ============================================================================
// Backend Selection
// ============================================================================

/**
 * Select the best vector database backend based on environment conditions.
 *
 * Selection priority:
 * 1. Explicit `VECTOR_DB_BACKEND` env var (if the backend is available)
 * 2. Qdrant (if QDRANT_URL is configured)
 * 3. Pinecone (if API key and environment are configured)
 * 4. Local TF-IDF (always available as fallback)
 *
 * @param env - Environment variables (defaults to process.env)
 * @param documentCount - Estimated document count (default: 0)
 * @returns Selection result with reasoning
 */
export function selectVectorDBBackend(
  env: Record<string, string | undefined> = process.env,
  documentCount = 0,
): SelectionResult {
  const envCheck = checkEnvironment(env, documentCount);

  // Check availability of all backends
  const available = (['local', 'qdrant', 'pinecone'] as VectorDBBackend[]).map((backend) => {
    const check = isBackendAvailable(backend, envCheck);
    return {
      backend,
      isAvailable: check.available,
      unavailableReason: check.reason,
    };
  });

  // 1. Explicit override
  if (envCheck.explicitBackend) {
    const explicit = available.find((a) => a.backend === envCheck.explicitBackend);
    if (explicit?.isAvailable) {
      return {
        selected: envCheck.explicitBackend,
        reason: `Explicitly configured via VECTOR_DB_BACKEND=${envCheck.explicitBackend}`,
        isExplicit: true,
        available,
        recommendation: buildRecommendation(envCheck.explicitBackend, envCheck),
      };
    }
    // Explicit backend not available - warn and fall through
  }

  // 2. Auto-detect: prefer Qdrant if configured
  if (envCheck.hasQdrantUrl) {
    return {
      selected: 'qdrant',
      reason: 'QDRANT_URL is configured; Qdrant is recommended for production use',
      isExplicit: false,
      available,
      recommendation: buildRecommendation('qdrant', envCheck),
    };
  }

  // 3. Auto-detect: use Pinecone if configured
  if (envCheck.hasPineconeApiKey && envCheck.hasPineconeEnvironment) {
    return {
      selected: 'pinecone',
      reason: 'Pinecone API key and environment are configured',
      isExplicit: false,
      available,
      recommendation: buildRecommendation('pinecone', envCheck),
    };
  }

  // 4. Default to local
  return {
    selected: 'local',
    reason: 'No external vector database configured; using local TF-IDF',
    isExplicit: false,
    available,
    recommendation: buildRecommendation('local', envCheck),
  };
}

// ============================================================================
// Recommendation Builder
// ============================================================================

/**
 * Build a recommendation message for the user.
 *
 * @param selected - The selected backend
 * @param envCheck - Environment check results
 * @returns Recommendation string
 */
function buildRecommendation(selected: VectorDBBackend, envCheck: EnvironmentCheck): string {
  const info = BACKENDS[selected];

  if (selected === 'local' && envCheck.documentCount > info.maxRecommendedDocs) {
    return (
      `Using local TF-IDF vector database. You have ${envCheck.documentCount} documents, ` +
      `which exceeds the recommended limit of ${info.maxRecommendedDocs}. ` +
      `Consider setting up Qdrant for better performance: set QDRANT_URL in your environment.`
    );
  }

  if (selected === 'local') {
    return (
      `Using local TF-IDF vector database. This works well for small knowledge bases. ` +
      `For production use with larger document sets, consider Qdrant (set QDRANT_URL) ` +
      `or Pinecone (set PINECONE_API_KEY and PINECONE_ENVIRONMENT).`
    );
  }

  if (selected === 'qdrant') {
    return `Using Qdrant vector database at ${envCheck.hasQdrantUrl ? 'configured URL' : 'default URL'}. This is the recommended setup for production.`;
  }

  if (selected === 'pinecone') {
    return `Using Pinecone cloud vector database. Ensure your API key has sufficient quota for your usage.`;
  }

  return `Using ${info.name} as the vector database backend.`;
}

/**
 * Get detailed information about all supported backends.
 *
 * @returns Array of all backend information objects
 */
export function getAllBackendInfo(): BackendInfo[] {
  return Object.values(BACKENDS);
}

/**
 * Get information about a specific backend.
 *
 * @param backend - Backend identifier
 * @returns Backend information or undefined if not found
 */
export function getBackendInfo(backend: VectorDBBackend): BackendInfo | undefined {
  return BACKENDS[backend];
}
