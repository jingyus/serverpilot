// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * System information API route.
 *
 * Provides public (no auth required) endpoints for clients to discover
 * the current edition, available features, and server version.
 *
 * @module api/routes/system
 */

import { createRequire } from "node:module";
import { Hono } from "hono";
import { getLimitsForEdition, toSerializableLimits } from "@aiinstaller/shared";
import type { SerializableEditionLimits } from "@aiinstaller/shared";
import { EDITION, FEATURES, CLOUD_ONLY } from "../../config/edition.js";
import type { FeatureFlags } from "../../config/edition.js";

// Read version from package.json (avoids circular dependency with index.ts)
const require = createRequire(import.meta.url);
const pkg = require("../../../package.json") as { version: string };
const SERVER_VERSION: string = pkg.version;

// ============================================================================
// Types
// ============================================================================

interface EditionResponse {
  edition: "ce" | "ee";
  features: FeatureFlags;
  version: string;
  limits: SerializableEditionLimits;
  cloudFeatures: {
    notificationHistory: boolean;
  };
}

// ============================================================================
// Route
// ============================================================================

const app = new Hono();

/**
 * GET /edition
 *
 * Returns the current edition, feature flags, and server version.
 * This endpoint is public — no authentication required.
 */
app.get("/edition", (c) => {
  const response: EditionResponse = {
    edition: EDITION.edition,
    features: FEATURES,
    version: SERVER_VERSION,
    limits: toSerializableLimits(getLimitsForEdition(EDITION.edition)),
    cloudFeatures: {
      notificationHistory: CLOUD_ONLY.notificationHistory,
    },
  };
  return c.json(response);
});

export const systemRoute = app;
