# ServerPilot Security White Paper

> **Version**: 1.0 | **Last Updated**: February 2026 | **Applies to**: ServerPilot v0.1.x

## Table of Contents

- [Executive Summary](#executive-summary)
- [Threat Model](#threat-model)
- [Five-Layer Defense-in-Depth Architecture](#five-layer-defense-in-depth-architecture)
  - [Layer 1: Command Classification](#layer-1-command-classification)
  - [Layer 2: Parameter Auditing](#layer-2-parameter-auditing)
  - [Layer 3: Pre-Operation Snapshots](#layer-3-pre-operation-snapshots)
  - [Layer 4: Emergency Kill Switch](#layer-4-emergency-kill-switch)
  - [Layer 5: Audit Trail](#layer-5-audit-trail)
- [Authentication and Authorization](#authentication-and-authorization)
  - [REST API Authentication (JWT)](#rest-api-authentication-jwt)
  - [WebSocket Device Authentication](#websocket-device-authentication)
  - [Ownership Verification](#ownership-verification)
- [Agent Permission Model](#agent-permission-model)
- [Data Security](#data-security)
  - [Password Storage](#password-storage)
  - [Token Management](#token-management)
  - [Database Security](#database-security)
  - [Input Validation](#input-validation)
- [Communication Security](#communication-security)
  - [WebSocket Hardening](#websocket-hardening)
  - [REST API Security](#rest-api-security)
- [Rate Limiting and Quotas](#rate-limiting-and-quotas)
- [Error Handling and Information Disclosure](#error-handling-and-information-disclosure)
- [Deployment Security Recommendations](#deployment-security-recommendations)
- [Security Reporting](#security-reporting)

---

## Executive Summary

ServerPilot is an AI-powered server management platform that executes commands on remote infrastructure based on natural language conversations. This architecture inherently carries risk — an AI misinterpreting user intent, a malicious prompt, or a compromised agent could lead to destructive operations on production servers.

To address these risks, ServerPilot implements a **five-layer defense-in-depth** strategy that ensures no single point of failure can lead to catastrophic outcomes. Every command passes through multiple independent validation layers before execution, dangerous operations require explicit confirmation, and all actions are logged for auditability.

**Key security principles:**

- **Deny by default** — Unknown commands are classified as RED (requires confirmation), not GREEN (auto-execute)
- **Least privilege** — The agent runs as a non-root user; only pre-approved operations receive elevated privileges
- **Defense in depth** — Five independent layers; compromise of one layer does not bypass the others
- **Full auditability** — Every operation is recorded with user, timestamp, risk level, and outcome
- **Fail-safe defaults** — On AI failure, the system falls back to preset templates rather than executing blindly

---

## Threat Model

ServerPilot considers the following threat categories:

| Threat | Mitigation |
|--------|-----------|
| AI generating destructive commands | Command classification + parameter auditing + user confirmation |
| Prompt injection via chat | AI output treated as untrusted; all commands validated independently |
| Unauthorized server access | JWT authentication + per-user ownership isolation |
| Compromised agent binary | Signature verification on updates + command classification on agent side |
| Malicious command parameters | Parameter auditing layer detects dangerous flags and protected paths |
| Credential theft | Scrypt password hashing + timing-safe comparison + token rotation |
| Man-in-the-middle attacks | WSS (TLS) for production deployments + device token authentication |
| Denial of service | Rate limiting + connection limits + quota enforcement |

---

## Five-Layer Defense-in-Depth Architecture

```
  User Request (natural language)
       │
       ▼
  ┌─────────────────────────────────────────────┐
  │  AI Provider (Claude / OpenAI / DeepSeek)   │
  │  Generates execution plan with commands      │
  └───────────────────┬─────────────────────────┘
                      │
       ┌──────────────┼──────────────────┐
       │              │                  │
       ▼              ▼                  ▼
  ┌─────────┐   ┌──────────┐    ┌──────────────┐
  │ Layer 1  │   │ Layer 2   │    │   Layer 3    │
  │ Command  │──▶│ Parameter │──▶│ Pre-Operation│
  │ Classify │   │ Auditing  │    │  Snapshot    │
  └─────────┘   └──────────┘    └──────────────┘
       │              │                  │
       └──────────────┼──────────────────┘
                      │
                      ▼
              ┌──────────────┐
              │  User        │
              │  Confirmation│  (YELLOW / RED / CRITICAL)
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐        ┌──────────────┐
              │  Command     │───────▶│   Layer 4    │
              │  Execution   │        │  Kill Switch │
              └──────┬───────┘        └──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │   Layer 5    │
              │  Audit Trail │
              └──────────────┘
```

### Layer 1: Command Classification

Every command is classified into one of five risk levels before execution. Classification is based on pattern matching against a comprehensive rule database.

#### Risk Levels

| Level | Color | Rules | Behavior | Examples |
|-------|-------|-------|----------|----------|
| **Safe** | GREEN | 255+ patterns | Auto-execute, no confirmation | `ls`, `ps`, `cat`, `grep`, `git status`, `docker ps` |
| **Caution** | YELLOW | 110+ patterns | Requires user confirmation | `apt install`, `npm install`, `docker pull`, `git clone` |
| **Dangerous** | RED | 139+ patterns | Confirmation + impact display | `chmod`, `chown`, `systemctl restart`, `docker exec` |
| **Destructive** | CRITICAL | 136+ patterns | Confirmation + password + pre-execution snapshot | `rm`, `DROP TABLE`, `docker rm`, `git reset --hard` |
| **Forbidden** | FORBIDDEN | 86+ patterns | Never executed, immediately rejected | `rm -rf /`, `mkfs`, `:(){ :|:& };:`, crypto miners |

**Total: 726+ classification rules**

#### Classification Logic

```
1. Normalize command (resolve aliases: sudo, doas, pkexec, su -c)
2. Check FORBIDDEN patterns → block immediately
3. Check CRITICAL patterns → require strongest confirmation
4. Check RED patterns → require confirmation with impact display
5. Check YELLOW patterns → require simple confirmation
6. Check GREEN patterns → auto-execute
7. Default (no match) → RED (deny by default)
```

The fail-safe default ensures that any unrecognized command requires explicit user approval before execution.

#### Forbidden Pattern Categories

- **Recursive deletion**: `rm -rf /`, `rm -rf /*`, `rm -rf ~`
- **Disk formatting**: `mkfs`, `dd if=/dev/zero`, `wipefs`
- **Fork bombs**: `:(){ :|:& };:` and variants
- **Malware patterns**: Cryptocurrency miners, reverse shells, keyloggers
- **System destruction**: `/dev/sda` writes, boot sector modifications

#### Custom Rules

Organizations can extend the built-in rules by loading custom classification rules from a JSON configuration file. This enables environment-specific policies (e.g., blocking database migrations on production servers).

### Layer 2: Parameter Auditing

Even after a command passes classification, its parameters are individually audited for dangerous flags and protected path access.

#### Dangerous Parameters (45+ flags)

The parameter auditor detects and warns on flags that bypass safety mechanisms:

| Category | Flags |
|----------|-------|
| **Force operations** | `--force`, `--force-yes`, `--force-delete`, `--force-remove`, `--force-overwrite` |
| **Data destruction** | `--purge`, `--hard`, `--delete`, `--wipe-data`, `--destroy` |
| **Safety bypass** | `--no-preserve-root`, `--no-backup`, `--no-confirm`, `--no-interaction` |
| **Skip protections** | `--skip-checks`, `--skip-validation`, `--skip-tests` |
| **Privilege escalation** | `--unsafe`, `--allow-root`, `--privileged` |

#### Protected Paths (40+ directories)

Operations targeting these paths generate blockers (must have extra confirmation) or warnings:

| Category | Protected Paths |
|----------|----------------|
| **System core** | `/etc`, `/boot`, `/usr`, `/bin`, `/sbin`, `/lib`, `/proc`, `/sys`, `/dev` |
| **User data** | `/root`, `/home` |
| **Databases** | `/var/lib/mysql`, `/var/lib/postgresql`, `/var/lib/mongodb` |
| **Containers** | `/var/lib/docker`, `/var/lib/kubelet`, `/var/lib/containerd` |
| **Cloud infrastructure** | `/var/lib/rancher`, `/var/lib/vault`, `/var/lib/consul`, `/var/lib/etcd` |

#### Audit Result Structure

Each parameter audit produces:

- **Blockers**: Conditions that require additional confirmation before proceeding
- **Warnings**: Advisory notices shown to the user but do not block execution
- **Risk modifiers**: Parameter combinations that escalate the risk level (e.g., `rm` + `--force` + `/etc` → escalates from RED to CRITICAL)

### Layer 3: Pre-Operation Snapshots

Before executing YELLOW-or-higher risk commands, the system automatically creates file snapshots of relevant configuration files.

#### How It Works

1. The snapshot service maps commands to relevant config files (e.g., `nginx -s reload` → `/etc/nginx/nginx.conf`)
2. File contents are captured and stored in the database before execution
3. Snapshots include metadata: server ID, operation ID, timestamp, expiration
4. Default TTL: 7 days

#### Covered Configuration Categories

| Service | Config Paths Monitored |
|---------|----------------------|
| Nginx | `/etc/nginx/nginx.conf`, `/etc/nginx/sites-enabled/*` |
| MySQL | `/etc/mysql/my.cnf`, `/etc/mysql/mysql.conf.d/*` |
| PostgreSQL | `/etc/postgresql/*/main/postgresql.conf` |
| Redis | `/etc/redis/redis.conf` |
| Docker | `/etc/docker/daemon.json` |
| Systemd | `/etc/systemd/system/*` |
| Cron | `/etc/crontab`, `/var/spool/cron/*` |
| SSH | `/etc/ssh/sshd_config` |

#### Rollback

If an operation fails, users can trigger a rollback that restores files from the snapshot. The rollback service verifies file integrity after restoration.

### Layer 4: Emergency Kill Switch

The system provides immediate halt capability for all running operations:

- **Scope**: Terminates all in-progress command executions on the target server
- **Activation**: Available via Dashboard UI and REST API
- **Behavior**: Sends interrupt signals to running processes, marks operations as cancelled
- **No confirmation required**: Emergency actions execute immediately

### Layer 5: Audit Trail

Every operation is recorded with comprehensive context for traceability and compliance.

#### Operation Record Fields

| Field | Description |
|-------|-------------|
| `id` | Unique operation identifier |
| `serverId` | Target server |
| `userId` | User who initiated the operation |
| `sessionId` | Chat session context |
| `type` | Operation type (install, config, restart, execute, backup) |
| `commands` | Exact commands executed |
| `output` | Command stdout/stderr |
| `status` | Outcome (pending, running, success, failed, rolled_back) |
| `riskLevel` | Classified risk level (green, yellow, red, critical) |
| `snapshotId` | Associated pre-operation snapshot |
| `duration` | Execution time |
| `inputTokens` | AI tokens consumed (input) |
| `outputTokens` | AI tokens consumed (output) |
| `createdAt` | Operation start timestamp |
| `completedAt` | Operation end timestamp |

#### Structured Logging

All server-side events are logged via Pino with structured context:

- `requestId`: Unique request identifier for REST API calls
- `sessionId`: WebSocket session tracking
- `clientId`: WebSocket connection identifier
- Specialized loggers: `logAIOperation()`, `logConnectionEvent()`, `logMessageRoute()`, `logError()`

---

## Authentication and Authorization

### REST API Authentication (JWT)

| Parameter | Value |
|-----------|-------|
| **Algorithm** | HS256 (HMAC SHA-256) |
| **Secret length** | 32+ characters (enforced) |
| **Access token TTL** | 15 minutes |
| **Refresh token TTL** | 7 days |
| **Token claims** | `sub` (user ID), `type` (access/refresh), `iss`, `aud`, `iat`, `exp` |

**Token flow:**

1. User authenticates via `POST /api/v1/auth/login` with email/password
2. Server returns `{ accessToken, refreshToken, user }`
3. Client sends `Authorization: Bearer <accessToken>` on subsequent requests
4. On 401, client calls `POST /api/v1/auth/refresh` with refresh token
5. Server issues new access + refresh token pair
6. Old refresh token is invalidated

The `requireAuth` middleware extracts and verifies the Bearer token on all protected routes, validating issuer, audience, type, and expiration.

### WebSocket Device Authentication

Agent connections authenticate via a device token handshake:

1. Agent sends `auth.request` with `{ deviceId, deviceToken, platform }`
2. Server validates the device token
3. Server checks if the device is banned
4. Server validates remaining quota
5. Server responds with `auth.response` including quota info and plan type
6. Authentication timeout: **10 seconds** (handshake must complete within this window)

New devices are auto-registered with platform information. Device tokens are 64-character random hex strings (`sp_` prefix + 32 random bytes).

### Ownership Verification

All data access is scoped to the authenticated user:

- Repository queries include `AND servers.userId = :userId` conditions
- Server, operation, session, task, and alert-rule queries are all ownership-verified
- Cross-user data access returns empty results (not error messages, to avoid information leakage)

---

## Agent Permission Model

The ServerPilot agent runs on managed servers with a constrained security boundary:

### Execution Context

- **User**: Runs as a dedicated non-root `serverpilot` user
- **Privilege escalation**: Managed through `/etc/sudoers.d/serverpilot` with only pre-approved operations
- **No root shell**: The agent never spawns a root shell; individual commands are elevated via `sudo` when pre-approved

### Multi-Layer Validation on Agent Side

The agent independently validates commands before execution (defense in depth — not relying solely on server-side validation):

1. **Command classification** — Local pattern matching against 726+ rules
2. **Parameter auditing** — Dangerous flag and protected path detection
3. **Sandbox execution** — Confirmation prompts for non-GREEN commands (unless `--yes` flag)
4. **Dry-run mode** — `--dry-run` flag shows what would be executed without actually running
5. **Snapshot requests** — Agent captures file states before destructive operations and sends them to the server for storage

### Agent Update Security

Agent binary updates include signature verification:

- SHA256 hash verification of downloaded binaries
- Update source validation (only from configured server)
- Rollback to previous version on verification failure

---

## Data Security

### Password Storage

| Parameter | Value |
|-----------|-------|
| **Algorithm** | Scrypt (NIST-recommended) |
| **Cost factor (N)** | 16,384 |
| **Block size (r)** | 8 |
| **Parallelization (p)** | 1 |
| **Salt length** | 32 bytes (256 bits), random per password |
| **Derived key length** | 64 bytes |
| **Storage format** | `scrypt:N:r:p:salt:hash` (hex-encoded) |
| **Comparison** | `crypto.timingSafeEqual()` (prevents timing attacks) |

### Token Management

| Token Type | Generation | Storage | Lifetime |
|-----------|-----------|---------|----------|
| JWT access token | HS256 signed | Client memory/localStorage | 15 minutes |
| JWT refresh token | HS256 signed | Client localStorage | 7 days |
| Device token | `sp_` + 32 random bytes (hex) | Agent filesystem + server DB | Long-lived |
| Agent key | Random bytes, stored as hash | Server DB (hashed) | Until rotation |

- Refresh tokens are rotated on each use
- AI provider API keys are stored in user settings (encrypted at rest in future versions)

### Database Security

| Measure | Implementation |
|---------|---------------|
| **ORM** | Drizzle ORM — all queries use parameterized prepared statements |
| **No raw SQL** | SQL injection prevented by design |
| **Foreign keys** | `PRAGMA foreign_keys = ON` enforced |
| **WAL mode** | Write-Ahead Logging for safe concurrent reads |
| **Column constraints** | Type-safe columns with NOT NULL, UNIQUE, and CHECK constraints |
| **Indexes** | Defined for all query patterns (userId, serverId, status) |

### Input Validation

All external inputs are validated using Zod schemas at API boundaries:

- **REST API**: `validateBody(schema)` and `validateQuery(schema)` middleware
- **WebSocket**: `safeParseMessage()` validates all incoming messages against discriminated union schemas
- **Protocol**: 20 message types, each with a dedicated Zod schema
- **Validation failures**: Return 400 Bad Request with field-level error details (no internal state exposure)

The shared protocol package (`@aiinstaller/shared`) serves as the single source of truth for all schema definitions, ensuring consistent validation between server and agent.

---

## Communication Security

### WebSocket Hardening

| Measure | Configuration |
|---------|--------------|
| **Connection limit** | Max 100 concurrent connections (configurable) |
| **Authentication required** | All connections must complete auth handshake |
| **Auth timeout** | 10 seconds to complete authentication |
| **Heartbeat interval** | 30 seconds (ping/pong) |
| **Pong timeout** | 10 seconds (connection dropped if exceeded) |
| **Message validation** | All messages validated against Zod schemas |
| **TLS** | WSS in production (reverse proxy terminated) |
| **Session tracking** | Each client tracked with deviceId, sessionId, authenticatedAt |

### REST API Security

| Measure | Implementation |
|---------|---------------|
| **CORS** | Configurable origins, methods, headers |
| **Request ID** | Every request tagged with unique ID for tracing |
| **Content-Type** | JSON-only request/response |
| **Error responses** | Standardized format, no stack traces in production |
| **Protected routes** | All routes require JWT except `/auth/login`, `/auth/register`, `/health` |

---

## Rate Limiting and Quotas

| Quota | Free Tier Limit |
|-------|----------------|
| Installations per month | 5 |
| AI calls per installation | 20 |

- Quotas are enforced per device at the WebSocket authentication layer
- Quota information is returned in the authentication response
- AI operations check remaining quota before making provider API calls
- Token usage (input + output) is tracked per operation for cost monitoring

---

## Error Handling and Information Disclosure

ServerPilot follows the principle of minimal information disclosure:

| Error Type | Client Response | Server Log |
|-----------|----------------|------------|
| Validation error | 400 + field-level details | Full validation context |
| Auth failure | 401 + generic message | Token details + reason |
| Forbidden | 403 + generic message | User ID + resource attempted |
| Not found | 404 + route info | Full request context |
| Server error | 500 + generic "Internal Server Error" | Full stack trace + context |

- Stack traces are **never** sent to clients
- Error codes are machine-readable (`VALIDATION_ERROR`, `UNAUTHORIZED`, `RATE_LIMITED`, etc.)
- Database query errors are caught and wrapped (no SQL details in responses)

---

## Deployment Security Recommendations

For production deployments, we recommend:

1. **TLS termination** — Deploy the server behind a reverse proxy (Nginx, Caddy) with TLS
2. **JWT secret** — Use a cryptographically random 32+ character secret; never use defaults
3. **Network isolation** — Restrict server port access to known agent IPs where possible
4. **Database encryption** — Use filesystem-level encryption for the SQLite database file
5. **Log rotation** — Configure log rotation to prevent disk exhaustion
6. **Regular updates** — Keep ServerPilot and its dependencies updated
7. **Monitor audit logs** — Review operation history for unexpected commands or risk levels
8. **Backup database** — Regular backups of the SQLite database file
9. **Firewall rules** — Only expose necessary ports (default: 3000 for API/WS)
10. **Agent review** — Periodically review agent permissions in `/etc/sudoers.d/serverpilot`

---

## Security Reporting

We take security seriously. If you discover a vulnerability:

1. **DO NOT** open a public GitHub issue
2. Email: **security@serverpilot.dev**
3. Include: description, reproduction steps, impact assessment
4. Response timeline:
   - **Acknowledgment**: 48 hours
   - **Assessment**: 5 business days
   - **Resolution**: 14 days (critical), 30 days (non-critical)

See [SECURITY.md](/SECURITY.md) in the repository root for the full security policy.
