# ServerPilot Architecture

> **Version**: 1.0 | **Last Updated**: February 2026 | **Applies to**: ServerPilot v0.1.x

## Table of Contents

- [System Overview](#system-overview)
- [High-Level Architecture](#high-level-architecture)
- [Package Structure](#package-structure)
- [Server](#server)
  - [Entry Point and Initialization](#entry-point-and-initialization)
  - [REST API Layer](#rest-api-layer)
  - [WebSocket Server](#websocket-server)
  - [AI Integration](#ai-integration)
  - [Core Services](#core-services)
  - [Database Schema](#database-schema)
  - [Middleware](#middleware)
- [Agent](#agent)
  - [CLI Interface](#cli-interface)
  - [WebSocket Client](#websocket-client)
  - [Environment Detection](#environment-detection)
  - [Command Execution](#command-execution)
  - [Security Layers](#security-layers)
- [Dashboard](#dashboard)
  - [Routing](#routing)
  - [State Management](#state-management)
  - [API Integration](#api-integration)
- [Shared Protocol](#shared-protocol)
  - [Message Types](#message-types)
  - [Schema Validation](#schema-validation)
- [Communication Flows](#communication-flows)
  - [Installation Flow](#installation-flow)
  - [Chat Flow](#chat-flow)
  - [Monitoring Flow](#monitoring-flow)
- [Data Flow Diagram](#data-flow-diagram)

---

## System Overview

ServerPilot is an AI-driven DevOps platform built as a **pnpm monorepo** with four packages:

| Package | Purpose | Tech Stack | License |
|---------|---------|-----------|---------|
| `@aiinstaller/server` | API server, AI engine, WebSocket hub | Node.js 22+, Hono, Drizzle ORM, SQLite | AGPL-3.0 |
| `@aiinstaller/agent` | Runs on managed servers, executes commands | Node.js 22+, ws, Bun (binary build) | Apache-2.0 |
| `@aiinstaller/dashboard` | Web UI for server management | React 18, Vite 5, Zustand, Tailwind CSS | AGPL-3.0 |
| `@aiinstaller/shared` | Protocol definitions and schemas | Zod, TypeScript | MIT |

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Web Dashboard                                │
│                React 18 + Vite + Tailwind CSS + Zustand              │
│       Server List · AI Chat · Real-time Monitoring · Knowledge Base  │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ REST API + SSE (streaming responses)
┌────────────────────────────┴─────────────────────────────────────────┐
│                            Server                                     │
│                     Node.js + Hono + SQLite                           │
│                                                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐ │
│  │  AI Engine  │  │  REST API   │  │ Knowledge  │  │   Security &   │ │
│  │ (Multi-     │  │  + WebSocket│  │   Base     │  │   Audit        │ │
│  │  Provider)  │  │   Server   │  │  (RAG)     │  │  (5-Layer)     │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────────┘ │
│                                                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐ │
│  │  Snapshot   │  │   Task     │  │   Alert    │  │   Session      │ │
│  │  & Rollback │  │  Scheduler │  │  Evaluator │  │   Manager      │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────────┘ │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ WebSocket (encrypted in production)
           ┌─────────────────┼─────────────────┐
           │                 │                  │
     ┌─────┴──────┐   ┌─────┴──────┐    ┌─────┴──────┐
     │   Agent A   │   │   Agent B   │    │   Agent C   │
     │  Production │   │   Staging   │    │    Dev      │
     │             │   │             │    │             │
     │ · Env Detect│   │ · Env Detect│    │ · Env Detect│
     │ · Cmd Exec  │   │ · Cmd Exec  │    │ · Cmd Exec  │
     │ · Security  │   │ · Security  │    │ · Security  │
     │ · Metrics   │   │ · Metrics   │    │ · Metrics   │
     └────────────┘   └────────────┘    └────────────┘
```

---

## Package Structure

```
ServerPilot/
├── packages/
│   ├── server/src/
│   │   ├── index.ts              # Entry point, server bootstrap
│   │   ├── api/
│   │   │   ├── routes/           # REST API route modules
│   │   │   ├── middleware/       # Auth, validation, error handling
│   │   │   ├── server.ts         # InstallServer (WebSocket)
│   │   │   ├── handlers.ts       # WebSocket message routing
│   │   │   └── auth-handler.ts   # Device authentication
│   │   ├── ai/
│   │   │   ├── providers/        # AI provider implementations
│   │   │   ├── agent.ts          # Install AI agent
│   │   │   ├── planner.ts        # Plan generation
│   │   │   ├── error-analyzer.ts # Error diagnosis
│   │   │   ├── streaming.ts      # Token streaming
│   │   │   └── fault-tolerance.ts# Fallback chain
│   │   ├── core/
│   │   │   ├── session/          # Session lifecycle
│   │   │   ├── task/             # Task executor & scheduler
│   │   │   ├── snapshot/         # Pre-operation snapshots
│   │   │   ├── rollback/         # Rollback service
│   │   │   ├── alert/            # Alert evaluation & notification
│   │   │   ├── agent/            # Agent connector
│   │   │   └── operation/        # Operation history
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle ORM table definitions
│   │   │   ├── connection.ts     # SQLite connection setup
│   │   │   └── repositories/     # Data access layer
│   │   ├── knowledge/            # RAG knowledge base
│   │   └── utils/                # Logger, password, monitoring
│   │
│   ├── agent/src/
│   │   ├── index.ts              # CLI entry point
│   │   ├── client.ts             # WebSocket client
│   │   ├── authenticated-client.ts # Auth-aware client wrapper
│   │   ├── detect/               # Environment detection modules
│   │   ├── execute/              # Command execution & sandbox
│   │   ├── security/             # Command classifier & param auditor
│   │   ├── ui/                   # CLI display components
│   │   ├── updater/              # Self-update with signature verify
│   │   └── protocol-lite.ts      # Lightweight message factory
│   │
│   ├── dashboard/src/
│   │   ├── main.tsx              # React entry point
│   │   ├── App.tsx               # Router setup
│   │   ├── pages/                # Route pages
│   │   ├── components/           # UI components
│   │   ├── stores/               # Zustand state stores
│   │   ├── api/                  # API client & hooks
│   │   └── types/                # TypeScript type definitions
│   │
│   └── shared/src/
│       ├── protocol/
│       │   ├── messages.ts       # Message type definitions
│       │   ├── schemas.ts        # Zod validation schemas
│       │   └── types.ts          # Domain types
│       └── index.ts              # Public exports
│
├── tests/                        # Root-level integration tests
├── docker-compose.yml            # Full-stack deployment
└── docs/                         # Documentation
```

---

## Server

### Entry Point and Initialization

The server bootstraps in the following sequence:

```
1. Load environment config (.env + process.env)
2. Initialize Pino logger
3. Initialize SQLite database + run migrations
4. Seed default admin user (if users table is empty)
5. Initialize JWT configuration
6. Create Hono REST API application
7. Create InstallServer (WebSocket)
8. Attach WebSocket upgrade handler to HTTP server
9. Start background services:
   - Memory monitor
   - Task scheduler (cron)
   - Alert evaluator
   - Documentation auto-fetcher
   - Metrics cleanup/aggregation
10. Register graceful shutdown handlers
```

A single HTTP server hosts both the REST API and WebSocket connections on the same port (default: 3000).

### REST API Layer

Built on **Hono** framework. All routes are prefixed with `/api/v1` and protected by JWT authentication (except auth and health endpoints).

| Route Module | Base Path | Endpoints | Purpose |
|-------------|-----------|-----------|---------|
| `auth` | `/auth` | 4 | Login, register, refresh, logout |
| `servers` | `/servers` | 10+ | Server CRUD, profiles, metrics, operations |
| `chat` | `/chat` | 5 | Chat sessions, message streaming (SSE) |
| `tasks` | `/tasks` | 5 | Scheduled cron task management |
| `operations` | `/operations` | 3 | Operation history and execution |
| `alerts` | `/alerts` | 3 | Alert listing and resolution |
| `alert-rules` | `/alert-rules` | 4 | Threshold-based monitoring rules |
| `knowledge` | `/knowledge` | 1 | Semantic search over documentation |
| `doc-sources` | `/doc-sources` | 3 | Documentation source management |
| `settings` | `/settings` | 5 | AI provider config, notifications |
| `metrics` | `/metrics` | 3 | System monitoring data |
| `snapshots` | `/snapshots` | 3 | File snapshot management |
| `agent` | `/agent` | 2 | Agent registration and updates |
| `openapi` | `/api-docs` | 1 | Swagger UI documentation |

### WebSocket Server

The `InstallServer` class manages WebSocket connections:

**Responsibilities:**
- Client connection lifecycle (connect, authenticate, disconnect)
- Session management (create, track, complete)
- Message routing via `routeMessage()` dispatcher
- Heartbeat/keepalive (ping every 30s, pong timeout 10s)
- Client metadata tracking (deviceId, sessionId, authenticatedAt)

**Message routing table:**

| Incoming Message | Handler | Action |
|-----------------|---------|--------|
| `auth.request` | `handleAuthRequest` | Validate device, check quotas |
| `session.create` | `handleCreateSession` | Create installation session |
| `env.report` | `handleEnvironmentReport` | Receive env info, trigger AI plan |
| `step.execute` | `handleStepExecute` | Track step execution start |
| `step.output` | `handleStepOutput` | Capture intermediate output |
| `step.complete` | `handleStepComplete` | Record result, trigger next step |
| `error.occurred` | `handleErrorOccurred` | AI error diagnosis |
| `metrics.report` | `handleMetricsReport` | Store system metrics |

### AI Integration

ServerPilot uses a **provider factory pattern** for pluggable AI backends:

```
                    ┌──────────────────────┐
                    │  AIProviderInterface  │
                    │  · chat(messages)     │
                    │  · stream(request)    │
                    │  · isAvailable()      │
                    └──────────┬───────────┘
            ┌──────────┬──────┴───────┬───────────┐
            │          │              │            │
    ┌───────┴──┐ ┌─────┴────┐ ┌──────┴───┐ ┌─────┴────┐
    │  Claude   │ │  OpenAI   │ │ DeepSeek  │ │  Ollama   │
    │ (Tier 1)  │ │ (Tier 2)  │ │ (Tier 2)  │ │ (Tier 3)  │
    │ Anthropic │ │ GPT-4     │ │ DeepSeek  │ │  Local    │
    │   SDK     │ │  Turbo    │ │  Coder    │ │  LLM      │
    └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**Provider selection:**
- Environment variable `AI_PROVIDER` sets the default provider
- Users can switch providers via `PUT /settings/ai-provider` (live switch)
- Health checks available via `GET /settings/ai-provider/health`

**AI capabilities:**
- `planner.ts` — Generates step-by-step installation plans from environment data
- `error-analyzer.ts` — Diagnoses command failures and suggests fixes
- `chat-ai.ts` — Conversational server management with context injection
- `fault-tolerance.ts` — Fallback to preset templates when AI is unavailable
- `streaming.ts` — Real-time token streaming to clients

### Core Services

| Service | Module | Responsibility |
|---------|--------|---------------|
| **Session Manager** | `core/session/` | Create/retrieve/close sessions; associate clients |
| **Task Executor** | `core/task/executor.ts` | Validate commands, create operations, dispatch to agents |
| **Task Scheduler** | `core/task/scheduler.ts` | Cron-based task scheduling and dispatch |
| **Snapshot Service** | `core/snapshot/` | Pre-operation file capture, config mapping |
| **Rollback Service** | `core/rollback/` | File restoration from snapshots |
| **Alert Evaluator** | `core/alert/` | Threshold rule evaluation, trigger alerts |
| **Email Notifier** | `core/alert/` | SMTP notifications with cooldown |
| **Operation History** | `core/operation/` | Track all command executions and outcomes |
| **Agent Connector** | `core/agent/` | Manage communication with remote agents |
| **Memory Monitor** | `utils/memory-monitor.ts` | RSS/heap tracking, OOM prevention |
| **Metrics Cleanup** | `core/metrics-cleanup-scheduler.ts` | Hourly/daily aggregation, data retention |

### Database Schema

**ORM**: Drizzle ORM with SQLite (better-sqlite3 driver)

```
┌──────────┐     ┌───────────┐     ┌────────────┐
│  users   │────▶│  servers   │────▶│  profiles   │
│          │     │            │     │ (1:1)       │
│          │────▶│            │────▶│             │
└──────────┘     └───────────┘     └────────────┘
     │                │
     │                ├──────────▶ agents (1:1)
     │                │
     │                ├──────────▶ operations
     │                │
     │                ├──────────▶ sessions
     │                │
     │                ├──────────▶ tasks
     │                │
     │                ├──────────▶ snapshots
     │                │
     │                ├──────────▶ metrics
     │                │            metricsHourly
     │                │            metricsDaily
     │                │
     │                ├──────────▶ alerts
     │                │
     │                └──────────▶ alertRules
     │
     └──────────────▶ userSettings (1:1)
```

**15 tables** covering users, servers, operations, monitoring, and knowledge:

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `users` | email, passwordHash, name | User accounts |
| `userSettings` | aiProvider (JSON), notifications (JSON) | Per-user preferences |
| `servers` | name, userId, status, tags | Managed servers |
| `agents` | serverId, keyHash, version, lastSeen | Agent registration |
| `profiles` | serverId, osInfo, software, services | Server environment snapshots |
| `sessions` | userId, serverId, messages (JSON) | Chat/install sessions |
| `operations` | serverId, commands, status, riskLevel | Execution audit trail |
| `snapshots` | serverId, files (JSON), expiresAt | Pre-operation backups |
| `tasks` | serverId, cron, command, status | Scheduled tasks |
| `alertRules` | metricType, operator, threshold, severity | Monitoring thresholds |
| `alerts` | type, severity, value, resolved | Alert instances |
| `metrics` | cpuUsage, memoryUsage, diskUsage | Raw metrics (real-time) |
| `metricsHourly` | cpuAvg/Min/Max, sampleCount | Aggregated (30-day retention) |
| `metricsDaily` | cpuAvg/Min/Max, sampleCount | Aggregated (1-year retention) |
| `knowledgeCache` | content, embedding (JSON vector) | RAG document chunks |

### Middleware

| Middleware | File | Purpose |
|-----------|------|---------|
| `requireAuth` | `auth.ts` | JWT verification, userId extraction |
| `validateBody` | `validate.ts` | Zod schema validation for request bodies |
| `validateQuery` | `validate.ts` | Zod schema validation for query params |
| `errorHandler` | `error-handler.ts` | Global error catching, standardized responses |
| `rateLimiter` | `rate-limiter.ts` | AI API quota enforcement |

---

## Agent

### CLI Interface

The agent is a command-line tool distributed as a single binary (compiled with Bun):

```bash
ai-installer [software] [options]

Options:
  --server <url>    Server URL (default: ws://localhost:3000)
  --yes             Auto-confirm all prompts
  --verbose         Detailed output
  --dry-run         Preview mode (no execution)
  --offline         Environment detection only
  --update          Check & install updates
  --help            Show help
  --version         Show version
```

### WebSocket Client

The `AuthenticatedClient` wraps the WebSocket connection with:

- **Auto-reconnection**: Exponential backoff, max 3 retries
- **Re-authentication**: On reconnect, re-sends `auth.request`
- **Event system**: `message`, `disconnected`, `error`, `reconnected` events
- **State tracking**: Device ID, token, quota information

### Environment Detection

The agent detects the managed server's environment through 10 sub-modules:

| Module | Detects |
|--------|---------|
| `os.ts` | Platform, version, architecture, kernel, hostname, uptime |
| `runtime.ts` | Node.js, Python, Ruby, Go versions |
| `package-managers.ts` | npm, pnpm, yarn, brew, apt, yum, pacman |
| `network.ts` | Connectivity to npm registry, GitHub |
| `permissions.ts` | Sudo access, writable paths |
| `services.ts` | Running services (systemd, pm2, docker) |
| `ports.ts` | Open listening ports, process-to-port mapping |
| `device-fingerprint.ts` | Deterministic device ID (MAC address hash) |
| `metrics.ts` | CPU, memory, disk, network I/O |

Results are aggregated into an `EnvironmentInfo` object and sent to the server via `env.report`.

### Command Execution

```
CommandExecutor
     │
     ▼
  Sandbox
  ├── Confirmation prompts (unless --yes)
  ├── Dry-run mode (no execution)
  └── Error collection
     │
     ▼
  Shell execution
  ├── Timeout support
  ├── Real-time stdout/stderr streaming
  └── Windows .cmd resolution
     │
     ▼
  ExecResult { exitCode, stdout, stderr, duration }
```

### Security Layers

The agent runs its own security validation independent of the server:

1. **Command Classifier** (`security/command-classifier.ts`) — 726+ pattern rules across 5 risk levels
2. **Command Rules** (`security/command-rules.ts`) — Pattern database with regex matching
3. **Parameter Auditor** (`security/param-auditor.ts`) — Flag detection and protected path monitoring

The agent uses `protocol-lite.ts` instead of the shared Zod schemas to minimize binary size. Message types must be kept in sync manually.

---

## Dashboard

### Routing

Built with React Router 6. All routes except `/login` are protected by authentication.

```
/login                  → Login page (public)
/                       → MainLayout wrapper (protected)
  /dashboard            → Overview with quick stats
  /servers              → Server list
  /servers/:id          → Server detail (profile, metrics, operations)
  /chat                 → Chat session list
  /chat/:serverId       → Server-specific AI chat
  /tasks                → Scheduled task management
  /operations           → Operation history
  /search               → Knowledge base search
  /settings             → AI provider & notification settings
```

### State Management

Zustand stores provide focused, independent state slices:

| Store | Key State | Purpose |
|-------|-----------|---------|
| `useAuthStore` | user, tokens, login/logout | Authentication |
| `useServersStore` | server list, filters | Server management |
| `useServerDetailStore` | current server, profile | Server details |
| `useChatStore` | messages, streaming state | AI chat |
| `useWebSocketStore` | connection status | Real-time metrics |
| `useOperationsStore` | operation history | Audit trail |
| `useTasksStore` | scheduled tasks | Task management |
| `useSettingsStore` | AI provider, preferences | User settings |
| `useDashboardStore` | quick stats | Dashboard overview |
| `useUiStore` | theme, sidebar | UI state |

### API Integration

- **REST client**: Fetch-based with automatic JWT refresh on 401
- **SSE streaming**: Chat responses stream tokens in real-time
- **WebSocket**: Real-time metrics updates from agents
- **Error handling**: Retry with backoff for network errors

---

## Shared Protocol

### Message Types

The shared package defines 20 WebSocket message types organized by category:

| Category | Messages | Direction |
|----------|----------|-----------|
| **Auth** | `auth.request`, `auth.response` | Agent → Server → Agent |
| **Session** | `session.create`, `session.complete` | Agent → Server |
| **Plan** | `plan.receive` | Server → Agent |
| **Environment** | `env.report` | Agent → Server |
| **Execution** | `step.execute`, `step.output`, `step.complete` | Bidirectional |
| **Error** | `error.occurred`, `fix.suggest` | Agent → Server → Agent |
| **Snapshot** | `snapshot.request`, `snapshot.response` | Server → Agent → Server |
| **Rollback** | `rollback.request`, `rollback.response` | Server → Agent → Server |
| **Metrics** | `metrics.report` | Agent → Server |
| **AI Stream** | `ai.stream.start`, `ai.stream.token`, `ai.stream.complete`, `ai.stream.error` | Server → Client |

### Schema Validation

All messages are validated using Zod schemas:

- `validate.*()` — Throws on validation failure (for critical paths)
- `safeParse.*()` — Returns success/error result (for graceful handling)
- Discriminated union on `type` field ensures type-safe message routing

**Session lifecycle states**: `CREATED → DETECTING → PLANNING → EXECUTING → ERROR | COMPLETED`

**Step lifecycle states**: `PENDING → RUNNING → SUCCESS | FAILED | SKIPPED`

---

## Communication Flows

### Installation Flow

```
Dashboard                    Server                        Agent
    │                          │                             │
    │ POST /servers            │                             │
    │─────────────────────────▶│                             │
    │ { server, agentToken,    │                             │
    │   installCommand }       │                             │
    │◀─────────────────────────│                             │
    │                          │                             │
    │  User runs install       │                             │
    │  command on target       │      WebSocket connect      │
    │  server                  │◀────────────────────────────│
    │                          │                             │
    │                          │      auth.request           │
    │                          │◀────────────────────────────│
    │                          │      auth.response          │
    │                          │────────────────────────────▶│
    │                          │                             │
    │                          │      session.create         │
    │                          │◀────────────────────────────│
    │                          │      plan.receive (empty)   │
    │                          │────────────────────────────▶│
    │                          │                             │
    │                          │      env.report             │
    │                          │◀────────────────────────────│
    │                          │                             │
    │                          │  [AI generates plan]        │
    │                          │                             │
    │                          │      plan.receive (steps)   │
    │                          │────────────────────────────▶│
    │                          │                             │
    │                          │                   [User confirms]
    │                          │                             │
    │                          │      step.execute           │
    │                          │◀────────────────────────────│
    │                          │      step.output            │
    │                          │◀────────────────────────────│
    │                          │      step.complete          │
    │                          │◀────────────────────────────│
    │                          │                             │
    │                          │  [Repeat for each step]     │
    │                          │                             │
    │                          │      session.complete       │
    │                          │◀────────────────────────────│
```

### Chat Flow

```
Dashboard                    Server                        Agent
    │                          │                             │
    │ POST /chat/sessions/:id  │                             │
    │   /messages              │                             │
    │─────────────────────────▶│                             │
    │                          │                             │
    │                          │  [Inject server context:    │
    │                          │   profile, metrics,         │
    │                          │   knowledge base]           │
    │                          │                             │
    │                          │  [Send to AI provider]      │
    │                          │                             │
    │   SSE: token stream      │                             │
    │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                             │
    │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                             │
    │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                             │
    │                          │                             │
    │  [If plan detected       │                             │
    │   in AI response]        │                             │
    │                          │                             │
    │ POST /operations/:id     │                             │
    │   /execute               │                             │
    │─────────────────────────▶│                             │
    │                          │      step.execute           │
    │                          │────────────────────────────▶│
    │                          │      step.complete          │
    │                          │◀────────────────────────────│
```

### Monitoring Flow

```
Agent                        Server                      Dashboard
  │                            │                            │
  │  metrics.report            │                            │
  │  (every 30s)               │                            │
  │───────────────────────────▶│                            │
  │                            │                            │
  │                            │  [Store in metrics table]  │
  │                            │  [Evaluate alert rules]    │
  │                            │                            │
  │                            │  [If threshold breached]   │
  │                            │  [Create alert record]     │
  │                            │  [Send email notification] │
  │                            │                            │
  │                            │    WebSocket: metrics      │
  │                            │───────────────────────────▶│
  │                            │                            │
  │                            │                     [Update charts]
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           User                                       │
│                                                                       │
│    Natural language:                    Dashboard UI:                 │
│    "Install nginx on                   Monitor metrics,              │
│     my production server"              view operations,              │
│                                        manage servers                │
└───────────┬──────────────────────────────────┬──────────────────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────────┐         ┌─────────────────────────┐
│    AI Provider         │         │     REST API (Hono)     │
│  Claude/OpenAI/etc.   │         │                         │
│                       │         │  Auth → Validate →      │
│  "Here's a plan:      │         │  Route → Service →      │
│   1. apt update       │         │  Repository → SQLite    │
│   2. apt install      │         │                         │
│      nginx            │         └────────────┬────────────┘
│   3. systemctl        │                      │
│      enable nginx"    │                      │
└───────────┬───────────┘                      │
            │                                  │
            ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                    WebSocket Server                            │
│                                                                │
│  Message Router → Session Manager → Task Executor             │
│                                                                │
│  Validates all messages against Zod schemas                   │
│  Tracks sessions, operations, and audit trail                 │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │  WebSocket
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                        Agent                                   │
│                                                                │
│  ┌──────────┐    ┌─────────────┐    ┌──────────────────┐     │
│  │ Command   │───▶│  Parameter   │───▶│  Sandbox          │     │
│  │ Classify  │    │  Audit       │    │  (confirm/execute)│     │
│  │ (5 levels)│    │ (flags/paths)│    │                   │     │
│  └──────────┘    └─────────────┘    └────────┬─────────┘     │
│                                               │               │
│                                               ▼               │
│                                        Shell Execution        │
│                                        stdout/stderr          │
│                                        exit code              │
└──────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Security White Paper](./SECURITY.md) — Detailed security architecture and five-layer defense
- [Development Standards](./开发标准.md) — Code conventions, testing, and Git workflow
- [Deployment Guide](./deployment.md) — Docker Compose setup and configuration
- [API Documentation](http://localhost:3000/api-docs) — Interactive Swagger UI (when server is running)
