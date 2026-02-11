# ServerPilot API Reference

> **Version**: 0.1.0 | **Base URL**: `http://localhost:3000` | **License**: MIT
>
> Interactive API explorer: [Swagger UI](/api-docs)
> Machine-readable spec: [OpenAPI JSON](/api-docs/openapi.json)

---

## Authentication

All protected endpoints require a **Bearer JWT** token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

Obtain tokens via `POST /api/v1/auth/login` or `POST /api/v1/auth/register`.
Refresh expired tokens via `POST /api/v1/auth/refresh`.

---

## Rate Limiting

All `/api/v1/*` endpoints are rate-limited:
- **Authenticated**: 100 requests/minute
- **Anonymous**: 20 requests/minute
- **Login/Register**: 5 requests/minute
- **Chat**: 30 requests/minute

Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`

---

## API Groups

| # | Group | Endpoints | Description |
|---|-------|-----------|-------------|
| 1 | [Auth](#1-auth) | 6 | Registration, login, token refresh, GitHub OAuth |
| 2 | [Servers](#2-servers) | 5 | Server CRUD operations |
| 3 | [Server Profile](#3-server-profile) | 9 | Profile notes, preferences, and history |
| 4 | [Snapshots](#4-snapshots) | 4 | Snapshot management and rollback |
| 5 | [Chat](#5-chat) | 6 | AI chat, plan execution, session management |
| 6 | [Tasks](#6-tasks) | 6 | Scheduled task CRUD and execution |
| 7 | [Alerts](#7-alerts) | 3 | Alert listing and resolution |
| 8 | [Alert Rules](#8-alert-rules) | 5 | Alert threshold rule management |
| 9 | [Operations](#9-operations) | 5 | Operation history, stats, and status |
| 10 | [Agent](#10-agent) | 2 | Agent version checking and binary downloads |
| 11 | [Knowledge](#11-knowledge) | 7 | Documentation scraping and search |
| 12 | [Doc Sources](#12-doc-sources) | 7 | Documentation source management |
| 13 | [Settings](#13-settings) | 6 | User settings and AI provider config |
| 14 | [Metrics](#14-metrics) | 4 | Monitoring metrics and real-time SSE stream |
| 15 | [Audit Log](#15-audit-log) | 2 | Security audit trail and CSV export |
| 16 | [Webhooks](#16-webhooks) | 7 | Webhook CRUD, testing, and delivery history |
| 17 | [Members](#17-members) | 3 | Tenant member role management |
| 18 | [Team](#18-team) | 8 | Team invitations and member management |
| 19 | [System](#19-system) | 1 | Health check |

**Total: 96 endpoint operations**

---

## 1. Auth

User authentication and token management. Includes local email/password and GitHub OAuth.

### POST /api/v1/auth/register

Create a new user account.

**Request Body:**
```json
{
  "email": "admin@example.com",
  "password": "securepassword123",
  "name": "Admin User"
}
```

**Response (201):**
```json
{
  "user": { "id": "550e8400-...", "email": "admin@example.com", "name": "Admin User" },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJl..."
}
```

### POST /api/v1/auth/login

Authenticate with email and password.

**Request Body:**
```json
{ "email": "admin@example.com", "password": "securepassword123" }
```

**Response (200):** Same as register response.

### POST /api/v1/auth/refresh

Exchange a valid refresh token for new token pair.

**Request Body:**
```json
{ "refreshToken": "dGhpcyBpcyBhIHJlZnJl..." }
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJl..."
}
```

### POST /api/v1/auth/logout

Stateless logout acknowledgement. Discard tokens client-side.

**Response (200):**
```json
{ "message": "Logged out successfully" }
```

### GET /api/v1/auth/github

Redirect to GitHub OAuth authorization page. Requires `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` env vars.

**Response (302):** Redirect to GitHub.

### GET /api/v1/auth/github/callback

Handle GitHub OAuth callback. Creates or links user account and redirects to dashboard with tokens in URL hash fragment.

**Response (302):** Redirect to `/login#oauth_callback?accessToken=...&refreshToken=...&user=...`

---

## 2. Servers

Server CRUD operations. **Auth required.**

### GET /api/v1/servers

List all servers for the authenticated user.

**Response (200):**
```json
{
  "servers": [
    {
      "id": "550e8400-...",
      "name": "production-web-01",
      "status": "online",
      "tags": ["web", "production"],
      "os": "Ubuntu 22.04",
      "arch": "x64",
      "hostname": "web-01.example.com",
      "lastSeenAt": "2026-02-11T10:30:00Z",
      "createdAt": "2026-01-15T08:00:00Z",
      "updatedAt": "2026-02-11T10:30:00Z"
    }
  ]
}
```

### POST /api/v1/servers

Create a new server. Returns an agent token for agent registration.

**Request Body:**
```json
{ "name": "production-web-01", "tags": ["web", "production"] }
```

**Response (201):**
```json
{
  "server": { "id": "550e8400-...", "name": "production-web-01", "agentToken": "agt_a1b2c3d4..." }
}
```

### GET /api/v1/servers/{id}

Get server details by UUID.

### PATCH /api/v1/servers/{id}

Update server name, tags, or group.

### DELETE /api/v1/servers/{id}

Delete a server.

---

## 3. Server Profile

Server profile management including notes, preferences, and operation history. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/servers/{id}/profile` | Get server profile |
| GET | `/api/v1/servers/{id}/metrics` | Get monitoring metrics (`?range=1h\|24h\|7d`) |
| GET | `/api/v1/servers/{id}/operations` | Get server operation history |
| POST | `/api/v1/servers/{id}/profile/notes` | Add a note (body: `{ "note": "..." }`) |
| DELETE | `/api/v1/servers/{id}/profile/notes` | Remove note by index (body: `{ "index": 0 }`) |
| PATCH | `/api/v1/servers/{id}/profile/preferences` | Update preferences |
| POST | `/api/v1/servers/{id}/profile/history` | Record operation in history |
| GET | `/api/v1/servers/{id}/profile/history` | Get paginated history |
| PUT | `/api/v1/servers/{id}/profile/summary` | Set history summary |
| GET | `/api/v1/servers/{id}/profile/summary` | Get history summary |

---

## 4. Snapshots

Snapshot management and rollback. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/servers/{serverId}/snapshots` | List snapshots (paginated) |
| GET | `/api/v1/servers/{serverId}/snapshots/{snapshotId}` | Get snapshot details |
| DELETE | `/api/v1/servers/{serverId}/snapshots/{snapshotId}` | Delete snapshot |
| POST | `/api/v1/servers/{serverId}/snapshots/{snapshotId}/rollback` | Rollback to snapshot |

**Rollback Request Body:**
```json
{
  "clientId": "ws-abc123",
  "reason": "Config change broke nginx",
  "timeoutMs": 30000
}
```

---

## 5. Chat

AI-powered chat with SSE streaming for plan generation and execution. **Auth required.**

### POST /api/v1/chat/{serverId}

Send a message to AI. Returns SSE stream with events: `message`, `plan`, `complete`.

**Request Body:**
```json
{ "message": "Install Redis on this server", "sessionId": "optional-session-id" }
```

**Response:** `text/event-stream`

### POST /api/v1/chat/{serverId}/execute

Execute a confirmed plan. SSE events: `step_start`, `output`, `step_complete`, `complete`.

**Request Body:**
```json
{ "planId": "plan-456", "sessionId": "session-123" }
```

### POST /api/v1/chat/{serverId}/execute/cancel

Cancel an ongoing plan execution.

**Request Body:**
```json
{ "planId": "plan-456", "sessionId": "session-123" }
```

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/chat/{serverId}/sessions` | List chat sessions |
| GET | `/api/v1/chat/{serverId}/sessions/{sessionId}` | Get session with messages |
| DELETE | `/api/v1/chat/{serverId}/sessions/{sessionId}` | Delete session |

---

## 6. Tasks

Scheduled task management. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/tasks` | List tasks (`?serverId=&status=active\|paused`) |
| POST | `/api/v1/tasks` | Create task |
| GET | `/api/v1/tasks/{id}` | Get task details |
| PATCH | `/api/v1/tasks/{id}` | Update task |
| DELETE | `/api/v1/tasks/{id}` | Delete task |
| POST | `/api/v1/tasks/{id}/run` | Execute task immediately |

**Create Task Request:**
```json
{
  "serverId": "550e8400-...",
  "name": "Daily backup",
  "cron": "0 2 * * *",
  "command": "tar -czf /backups/daily.tar.gz /data",
  "description": "Compress data directory nightly"
}
```

**Run Response:**
```json
{
  "success": true,
  "exitCode": 0,
  "stdout": "Backup completed successfully",
  "stderr": "",
  "duration": 5200
}
```

---

## 7. Alerts

Alert listing and resolution. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/alerts` | List alerts (`?serverId=&resolved=true\|false`) |
| GET | `/api/v1/alerts/{id}` | Get alert details |
| PATCH | `/api/v1/alerts/{id}/resolve` | Mark alert as resolved |

---

## 8. Alert Rules

Alert threshold rule management. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| POST | `/api/v1/alert-rules` | Create alert rule |
| GET | `/api/v1/alert-rules` | List rules |
| GET | `/api/v1/alert-rules/{id}` | Get rule details |
| PATCH | `/api/v1/alert-rules/{id}` | Update rule |
| DELETE | `/api/v1/alert-rules/{id}` | Delete rule |

**Create Rule Request:**
```json
{
  "serverId": "550e8400-...",
  "name": "High CPU Alert",
  "metricType": "cpu",
  "operator": "gt",
  "threshold": 90,
  "severity": "critical",
  "emailRecipients": ["ops@example.com"],
  "cooldownMinutes": 15
}
```

---

## 9. Operations

Operation history, statistics, and status tracking. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/operations` | List operations (filtered) |
| GET | `/api/v1/operations/stats` | Get aggregated statistics |
| GET | `/api/v1/operations/{id}` | Get operation details |
| POST | `/api/v1/operations` | Create operation record |
| PATCH | `/api/v1/operations/{id}/status` | Update operation status |

**Query Parameters** (`GET /operations`): `serverId`, `type`, `status`, `riskLevel`, `search`, `startDate`, `endDate`, `limit`, `offset`

**Stats Response:**
```json
{
  "stats": {
    "total": 128,
    "byStatus": { "success": 100, "failed": 15, "pending": 13 },
    "byType": { "execute": 80, "install": 30, "config": 18 },
    "byRiskLevel": { "green": 90, "yellow": 25, "red": 10, "critical": 3 }
  }
}
```

---

## 10. Agent

Agent version checking and binary downloads. **Public (no auth).**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/agent/version` | Check for updates (`?current=0.1.0&platform=linux&arch=x64`) |
| GET | `/api/v1/agent/binaries` | List all available binaries |

---

## 11. Knowledge

Documentation scraping and knowledge base search. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| POST | `/api/v1/knowledge/scrape` | Trigger documentation scrape (GitHub repo or website) |
| POST | `/api/v1/knowledge/scrape/builtin` | Scrape all built-in sources |
| GET | `/api/v1/knowledge/sources` | List documentation sources |
| GET | `/api/v1/knowledge/docs` | List fetched documentation |
| GET | `/api/v1/knowledge/tasks` | List fetch tasks |
| GET | `/api/v1/knowledge/tasks/{taskId}` | Get task details |
| GET | `/api/v1/knowledge/search` | Search knowledge base (`?q=nginx+reverse+proxy&source=builtin`) |

---

## 12. Doc Sources

Documentation source CRUD and fetch management. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/doc-sources` | List sources |
| POST | `/api/v1/doc-sources` | Create source (GitHub or website) |
| GET | `/api/v1/doc-sources/{id}` | Get source details |
| PATCH | `/api/v1/doc-sources/{id}` | Update source |
| DELETE | `/api/v1/doc-sources/{id}` | Delete source |
| POST | `/api/v1/doc-sources/{id}/fetch` | Trigger manual fetch |
| GET | `/api/v1/doc-sources/{id}/status` | Get fetch status and history |

---

## 13. Settings

User settings and AI provider configuration. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/settings` | Get all user settings |
| PUT | `/api/v1/settings/ai-provider` | Update AI provider config |
| PUT | `/api/v1/settings/profile` | Update user profile |
| PUT | `/api/v1/settings/notifications` | Update notification preferences |
| PUT | `/api/v1/settings/knowledge-base` | Update knowledge base settings |
| GET | `/api/v1/settings/ai-provider/health` | Check AI provider availability |

**AI Provider Config:**
```json
{
  "provider": "claude",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250929",
  "baseUrl": null
}
```

Supported providers: `claude`, `openai`, `ollama`, `deepseek`, `custom-openai`

---

## 14. Metrics

Server monitoring metrics and real-time streaming. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/metrics` | Get metrics by time range (`?serverId=...&range=1h\|24h\|7d`) |
| GET | `/api/v1/metrics/latest` | Get latest metric point (`?serverId=...`) |
| GET | `/api/v1/metrics/aggregated` | Get aggregated metrics (hourly/daily avg/min/max) |
| GET | `/api/v1/metrics/stream` | Real-time SSE stream (`?serverId=...`) |

**SSE Stream Events:**
- `connected` — Initial connection confirmation
- `metric` — New data point from agent heartbeat

**Metric Point:**
```json
{
  "cpuUsage": 45.2,
  "memoryUsage": 2147483648,
  "memoryTotal": 8589934592,
  "diskUsage": 53687091200,
  "diskTotal": 107374182400,
  "networkIn": 1048576,
  "networkOut": 524288,
  "timestamp": "2026-02-11T10:30:00Z"
}
```

---

## 15. Audit Log

Security audit trail querying and CSV export. **Auth required (admin/owner for export).**

### GET /api/v1/audit-log

Query audit log entries with filtering.

**Query Parameters:** `limit`, `offset`, `serverId`, `riskLevel` (green|yellow|red|critical|forbidden), `action` (allowed|blocked|requires_confirmation), `startDate`, `endDate`

**Response (200):**
```json
{
  "logs": [
    {
      "userId": "550e8400-...",
      "serverId": "550e8400-...",
      "command": "systemctl restart nginx",
      "riskLevel": "yellow",
      "action": "allowed",
      "reason": "Service restart operation",
      "auditWarnings": [],
      "auditBlockers": [],
      "createdAt": "2026-02-11T10:30:00Z"
    }
  ],
  "total": 256,
  "limit": 50,
  "offset": 0
}
```

### GET /api/v1/audit-log/export

Stream audit logs as CSV. Requires `audit-log:export` permission (admin/owner).

**Query Parameters:** `format=csv`, `from`, `to`, `serverId`, `riskLevel`

**Response:** `text/csv` with BOM header for Excel compatibility.

---

## 16. Webhooks

Webhook endpoint management, testing, and delivery history. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/webhooks` | List webhooks (secrets masked) |
| POST | `/api/v1/webhooks` | Create webhook |
| GET | `/api/v1/webhooks/{id}` | Get webhook details |
| PATCH | `/api/v1/webhooks/{id}` | Update webhook |
| DELETE | `/api/v1/webhooks/{id}` | Delete webhook |
| POST | `/api/v1/webhooks/{id}/test` | Send test event |
| GET | `/api/v1/webhooks/{id}/deliveries` | Get delivery history |

**Create Webhook:**
```json
{
  "name": "Deployment Notifier",
  "url": "https://hooks.example.com/deploy",
  "events": ["task.completed", "operation.failed"],
  "secret": "optional-min-16-chars-secret",
  "maxRetries": 3
}
```

**Event Types:** `task.completed`, `alert.triggered`, `server.offline`, `operation.failed`, `agent.disconnected`

Webhook payloads are signed with HMAC-SHA256 using the webhook secret.

---

## 17. Members

Tenant member role management. **Auth required.**

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/members` | List tenant members |
| PATCH | `/api/v1/members/{userId}/role` | Update member role (body: `{ "role": "admin"\|"member" }`) |
| DELETE | `/api/v1/members/{userId}` | Remove member from tenant |

**Constraints:** Cannot change own role, cannot change or remove owner.

---

## 18. Team

Team invitations and member management with public invite acceptance. **Mixed auth.**

### Authenticated Endpoints (Auth required)

| Method | Path | Summary |
|--------|------|---------|
| POST | `/api/v1/team/invite` | Create invitation |
| GET | `/api/v1/team/invitations` | List invitations |
| DELETE | `/api/v1/team/invitations/{id}` | Cancel pending invitation |
| GET | `/api/v1/team/members` | List team members |
| PUT | `/api/v1/team/members/{id}/role` | Update member role |
| DELETE | `/api/v1/team/members/{id}` | Remove member |

**Create Invitation:**
```json
{ "email": "invitee@example.com", "role": "member" }
```

### Public Endpoints (No auth)

| Method | Path | Summary |
|--------|------|---------|
| GET | `/api/v1/team/invite/{token}` | Get invitation details |
| POST | `/api/v1/team/invite/{token}/accept` | Accept invitation |

**Accept Invitation:**
```json
{ "name": "New User", "password": "securepassword123" }
```

Invitations expire after 7 days. Statuses: `pending` → `accepted` | `cancelled` | `expired`.

---

## 19. System

### GET /health

Health check endpoint (outside `/api/v1`, no auth required).

**Response (200):**
```json
{ "status": "ok", "timestamp": 1707648000000 }
```

---

## Error Responses

All error responses follow a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
```

**Common HTTP Status Codes:**

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 302 | Redirect (OAuth) |
| 400 | Bad request / Validation error |
| 401 | Unauthorized (missing or invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 503 | Service unavailable (agent offline, AI provider down) |

---

## RBAC Permissions

Three roles with cumulative permissions: **owner** > **admin** > **member**

Key permissions per resource:
- `chat:use`, `server:read/create/update/delete`, `task:read/create/update/delete`
- `operation:read/create`, `webhook:read/create/update/delete`
- `alert:read/resolve`, `alert-rule:read/create/update/delete`
- `settings:read/update`, `metrics:read`, `audit-log:read/export`
- `member:read/invite/update-role/remove`, `snapshot:read/create`

---

*Generated from OpenAPI spec v0.1.0 — Last updated: 2026-02-12*
