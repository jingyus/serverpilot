// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for edition-aware table creation in `createTables()`.
 *
 * Validates that:
 * - CE mode creates only core tables (no EE-exclusive tables)
 * - EE mode creates all tables including EE-exclusive ones
 * - CE → EE upgrade automatically creates missing EE tables
 * - `ensureEETables()` creates all EE tables idempotently
 * - `listTables()` returns correct table names
 * - Default (no options) creates all tables for backward compat
 *
 * @module db/connection-edition.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveFeatures } from "../config/edition.js";
import type { EditionInfo } from "../config/edition.js";
import {
  initDatabase,
  closeDatabase,
  createTables,
  ensureEETables,
  listTables,
} from "./connection.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CE_INFO: EditionInfo = {
  edition: "ce",
  isCE: true,
  isEE: false,
  isCloud: false,
};
const EE_INFO: EditionInfo = {
  edition: "ee",
  isCE: false,
  isEE: true,
  isCloud: false,
};
const CLOUD_INFO: EditionInfo = {
  edition: "ee",
  isCE: false,
  isEE: true,
  isCloud: true,
};

const CE_FEATURES = resolveFeatures(CE_INFO);
const EE_FEATURES = resolveFeatures(EE_INFO);
const CLOUD_FEATURES = resolveFeatures(CLOUD_INFO);

/** Tables that should always exist regardless of edition. */
const CORE_TABLES = [
  "tenants",
  "users",
  "servers",
  "agents",
  "profiles",
  "sessions",
  "session_messages",
  "operations",
  "snapshots",
  "tasks",
  "audit_logs",
  "knowledge_cache",
  "doc_sources",
  "doc_source_history",
  "user_settings",
  "installed_skills",
  "skill_executions",
  "skill_store",
  "skill_execution_logs",
];

/** Tables only created when corresponding EE features are enabled. */
const EE_ONLY_TABLES = [
  "alert_rules",
  "alerts",
  "metrics",
  "metrics_hourly",
  "metrics_daily",
  "oauth_accounts",
  "webhooks",
  "webhook_deliveries",
  "invitations",
];

/** All tables combined. */
const ALL_TABLES = [...CORE_TABLES, ...EE_ONLY_TABLES].sort();

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  initDatabase(":memory:");
});

afterEach(() => {
  closeDatabase();
});

// ---------------------------------------------------------------------------
// CE mode — only core tables
// ---------------------------------------------------------------------------

describe("CE mode table creation", () => {
  it("creates only core tables when features=CE", () => {
    createTables(undefined, { features: CE_FEATURES });

    const tables = listTables();
    for (const t of CORE_TABLES) {
      expect(tables, `missing core table: ${t}`).toContain(t);
    }
  });

  it("does NOT create EE-exclusive tables in CE mode", () => {
    createTables(undefined, { features: CE_FEATURES });

    const tables = listTables();
    for (const t of EE_ONLY_TABLES) {
      expect(tables, `EE table should not exist in CE: ${t}`).not.toContain(t);
    }
  });

  it("creates exactly the expected number of core tables", () => {
    createTables(undefined, { features: CE_FEATURES });

    const tables = listTables();
    expect(tables.length).toBe(CORE_TABLES.length);
  });
});

// ---------------------------------------------------------------------------
// EE mode — all tables
// ---------------------------------------------------------------------------

describe("EE mode table creation", () => {
  it("creates all tables when features=EE", () => {
    createTables(undefined, { features: EE_FEATURES });

    const tables = listTables();
    for (const t of ALL_TABLES) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
  });

  it("creates EE-exclusive tables in EE mode", () => {
    createTables(undefined, { features: EE_FEATURES });

    const tables = listTables();
    for (const t of EE_ONLY_TABLES) {
      expect(tables, `missing EE table: ${t}`).toContain(t);
    }
  });

  it("creates all tables in Cloud mode", () => {
    createTables(undefined, { features: CLOUD_FEATURES });

    const tables = listTables();
    expect(tables.sort()).toEqual(ALL_TABLES);
  });
});

// ---------------------------------------------------------------------------
// Default (no options) — backward compatibility
// ---------------------------------------------------------------------------

describe("backward compatibility (no options)", () => {
  it("creates ALL tables when called without options", () => {
    createTables();

    const tables = listTables();
    for (const t of ALL_TABLES) {
      expect(tables, `missing table: ${t}`).toContain(t);
    }
  });

  it("creates same number of tables as EE mode", () => {
    createTables();

    const tables = listTables();
    expect(tables.length).toBe(ALL_TABLES.length);
  });
});

// ---------------------------------------------------------------------------
// CE → EE upgrade path
// ---------------------------------------------------------------------------

describe("CE → EE upgrade", () => {
  it("creates missing EE tables when upgrading from CE to EE", () => {
    // Start with CE
    createTables(undefined, { features: CE_FEATURES });
    let tables = listTables();
    expect(tables).not.toContain("webhooks");
    expect(tables).not.toContain("invitations");

    // Upgrade to EE
    createTables(undefined, { features: EE_FEATURES });
    tables = listTables();
    for (const t of ALL_TABLES) {
      expect(tables, `missing table after upgrade: ${t}`).toContain(t);
    }
  });

  it("ensureEETables() creates all EE tables on a CE database", () => {
    // Start with CE
    createTables(undefined, { features: CE_FEATURES });
    let tables = listTables();
    for (const t of EE_ONLY_TABLES) {
      expect(tables).not.toContain(t);
    }

    // Run upgrade function
    ensureEETables();
    tables = listTables();
    for (const t of EE_ONLY_TABLES) {
      expect(tables, `missing EE table after ensureEETables: ${t}`).toContain(
        t,
      );
    }
  });

  it("ensureEETables() is idempotent on an EE database", () => {
    createTables(undefined, { features: EE_FEATURES });
    const tablesBefore = listTables().sort();

    ensureEETables();
    const tablesAfter = listTables().sort();

    expect(tablesAfter).toEqual(tablesBefore);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("calling createTables() twice does not error", () => {
    createTables(undefined, { features: EE_FEATURES });
    expect(() =>
      createTables(undefined, { features: EE_FEATURES }),
    ).not.toThrow();
  });

  it("calling createTables(CE) then createTables(EE) works correctly", () => {
    createTables(undefined, { features: CE_FEATURES });
    createTables(undefined, { features: EE_FEATURES });

    const tables = listTables();
    expect(tables.sort()).toEqual(ALL_TABLES);
  });

  it("calling createTables(EE) then createTables(CE) keeps all tables", () => {
    createTables(undefined, { features: EE_FEATURES });
    createTables(undefined, { features: CE_FEATURES });

    // Tables use IF NOT EXISTS, so EE tables persist
    const tables = listTables();
    expect(tables.sort()).toEqual(ALL_TABLES);
  });
});

// ---------------------------------------------------------------------------
// listTables()
// ---------------------------------------------------------------------------

describe("listTables()", () => {
  it("returns empty array before createTables", () => {
    const tables = listTables();
    expect(tables).toEqual([]);
  });

  it("returns sorted table names", () => {
    createTables();
    const tables = listTables();
    const sorted = [...tables].sort();
    expect(tables).toEqual(sorted);
  });

  it("does not include sqlite internal tables", () => {
    createTables();
    const tables = listTables();
    for (const t of tables) {
      expect(t).not.toMatch(/^sqlite_/);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature flag granularity
// ---------------------------------------------------------------------------

describe("granular feature flags", () => {
  it("alerts feature controls alert_rules and alerts tables", () => {
    const features = { ...CE_FEATURES, alerts: true };
    createTables(undefined, { features });

    const tables = listTables();
    expect(tables).toContain("alert_rules");
    expect(tables).toContain("alerts");
    expect(tables).not.toContain("webhooks");
  });

  it("metricsMonitoring feature controls metrics tables", () => {
    const features = { ...CE_FEATURES, metricsMonitoring: true };
    createTables(undefined, { features });

    const tables = listTables();
    expect(tables).toContain("metrics");
    expect(tables).toContain("metrics_hourly");
    expect(tables).toContain("metrics_daily");
    expect(tables).not.toContain("webhooks");
  });

  it("oauthLogin feature controls oauth_accounts table", () => {
    const features = { ...CE_FEATURES, oauthLogin: true };
    createTables(undefined, { features });

    const tables = listTables();
    expect(tables).toContain("oauth_accounts");
    expect(tables).not.toContain("webhooks");
  });

  it("webhooks feature controls webhooks and webhook_deliveries tables", () => {
    const features = { ...CE_FEATURES, webhooks: true };
    createTables(undefined, { features });

    const tables = listTables();
    expect(tables).toContain("webhooks");
    expect(tables).toContain("webhook_deliveries");
    expect(tables).not.toContain("invitations");
  });

  it("teamCollaboration feature controls invitations table", () => {
    const features = { ...CE_FEATURES, teamCollaboration: true };
    createTables(undefined, { features });

    const tables = listTables();
    expect(tables).toContain("invitations");
    expect(tables).not.toContain("webhooks");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("throws when database is not initialized", () => {
    closeDatabase();
    expect(() => createTables(undefined, { features: CE_FEATURES })).toThrow(
      "Database not initialized",
    );
  });

  it("ensureEETables throws when database is not initialized", () => {
    closeDatabase();
    expect(() => ensureEETables()).toThrow("Database not initialized");
  });

  it("listTables throws when database is not initialized", () => {
    closeDatabase();
    expect(() => listTables()).toThrow("Database not initialized");
  });
});
