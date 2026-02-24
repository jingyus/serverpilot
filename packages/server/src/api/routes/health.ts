// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Health detail API route.
 *
 * Provides detailed health status for each subsystem:
 * - AI Provider (available / unavailable)
 * - Database (connected / unreachable)
 * - WebSocket server (running / stopped, active connections)
 * - RAG Pipeline (ready / not initialized)
 *
 * Aggregates an overall status: healthy / degraded / unhealthy.
 *
 * @module api/routes/health
 */

import { Hono } from "hono";
import {
  getActiveProvider,
  checkProviderHealth,
} from "../../ai/providers/provider-factory.js";
import { getRawDatabase } from "../../db/connection.js";
import { getInstallServer } from "../../core/agent/agent-connector.js";
import { getRagPipeline } from "../../knowledge/rag-pipeline.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { DEPLOYMENT, CLOUD_ONLY } from "../../config/edition.js";
import type { AuthContext } from "./types.js";

// ============================================================================
// Types
// ============================================================================

type SubsystemStatus = "healthy" | "unhealthy";
type OverallStatus = "healthy" | "degraded" | "unhealthy";

interface SubsystemHealth {
  status: SubsystemStatus;
  message?: string;
}

interface AIProviderHealth extends SubsystemHealth {
  provider?: string;
}

interface DatabaseHealth extends SubsystemHealth {
  type: string;
}

interface WebSocketHealth extends SubsystemHealth {
  connections: number;
  maxConnections: number;
}

interface RagHealth extends SubsystemHealth {
  indexedDocs: number;
}

interface HealthDetailResponse {
  status: OverallStatus;
  timestamp: number;
  deployment: {
    mode: "self-hosted" | "cloud";
    cloudFeatures: {
      notificationHistory: boolean;
    };
  };
  subsystems: {
    aiProvider: AIProviderHealth;
    database: DatabaseHealth;
    websocket: WebSocketHealth;
    rag: RagHealth;
  };
}

// ============================================================================
// Subsystem Checks
// ============================================================================

async function checkAIProvider(): Promise<AIProviderHealth> {
  const provider = getActiveProvider();
  if (!provider) {
    return { status: "unhealthy", message: "No AI provider configured" };
  }
  const health = await checkProviderHealth(provider);
  return {
    status: health.available ? "healthy" : "unhealthy",
    provider: health.provider,
    message: health.error,
  };
}

function checkDatabase(): DatabaseHealth {
  try {
    const sqlite = getRawDatabase();
    // Execute a lightweight query to verify the connection works
    sqlite.pragma("quick_check(1)");
    return { status: "healthy", type: "sqlite" };
  } catch {
    return {
      status: "unhealthy",
      type: "sqlite",
      message: "Database not initialized or unreachable",
    };
  }
}

function checkWebSocket(): WebSocketHealth {
  const server = getInstallServer();
  if (!server) {
    return {
      status: "unhealthy",
      connections: 0,
      maxConnections: 0,
      message: "WebSocket server not initialized",
    };
  }
  if (!server.isRunning()) {
    return {
      status: "unhealthy",
      connections: 0,
      maxConnections: server.getMaxConnections(),
      message: "WebSocket server not running",
    };
  }
  return {
    status: "healthy",
    connections: server.getClientCount(),
    maxConnections: server.getMaxConnections(),
  };
}

function checkRag(): RagHealth {
  const pipeline = getRagPipeline();
  if (!pipeline) {
    return {
      status: "unhealthy",
      indexedDocs: 0,
      message: "RAG pipeline not initialized",
    };
  }
  return {
    status: pipeline.isReady() ? "healthy" : "unhealthy",
    indexedDocs: pipeline.getIndexedDocCount(),
    message: pipeline.isReady()
      ? undefined
      : "RAG pipeline not ready (no indexed documents)",
  };
}

function aggregateStatus(
  subsystems: HealthDetailResponse["subsystems"],
): OverallStatus {
  const statuses = [
    subsystems.aiProvider.status,
    subsystems.database.status,
    subsystems.websocket.status,
    subsystems.rag.status,
  ];
  const unhealthyCount = statuses.filter((s) => s === "unhealthy").length;
  if (unhealthyCount === statuses.length) return "unhealthy";
  if (unhealthyCount > 0) return "degraded";
  return "healthy";
}

// ============================================================================
// Route
// ============================================================================

const app = new Hono<AuthContext>();

app.use("*", requireAuth, resolveRole);

app.get("/detail", requirePermission("settings:read"), async (c) => {
  const [aiProvider, websocket, rag] = await Promise.all([
    checkAIProvider(),
    Promise.resolve(checkWebSocket()),
    Promise.resolve(checkRag()),
  ]);
  const database = checkDatabase();

  const subsystems = { aiProvider, database, websocket, rag };
  const response: HealthDetailResponse = {
    status: aggregateStatus(subsystems),
    timestamp: Date.now(),
    deployment: {
      mode: DEPLOYMENT.isCloud ? "cloud" : "self-hosted",
      cloudFeatures: {
        notificationHistory: CLOUD_ONLY.notificationHistory,
      },
    },
    subsystems,
  };

  return c.json(response);
});

export const healthRoute = app;
