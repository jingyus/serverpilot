# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- InstallAIAgent multi-provider support (decouple Anthropic SDK)
- Product Hunt launch preparation

## [0.3.0-beta] - 2026-02-12

Phase 3: Open Source Release

### Added
- **Single-Tenant Simplification**: Removed unnecessary multi-tenant complexity for open-source edition — owner is the sole admin, streamlined middleware chain
- **Server Group Management**: Server grouping API and Dashboard UI for organizing servers by project/environment
- **Dashboard Chat UX**: Plan preview and execution confirmation workflow — users can review AI plans before execution
- **AI Error Auto-Diagnosis**: Automatic error diagnosis and fix suggestions on step failure — rule-based first, AI fallback (20+ common error patterns)
- **RAG Knowledge Base Pipeline**: TF-IDF embedding + local vector store for knowledge-augmented AI conversations — 15% model context budget for knowledge injection
- **AI Profile Context Injection**: Server profile auto-injected into AI system prompt — OS, software, services, notes, preferences with token budget trimming
- **E2E Test Coverage**: Playwright end-to-end tests covering core user journeys (login, server management, chat flow)
- **Dashboard Alerts**: Alert management page with real-time notification support
- **Dashboard Audit Logs**: Operation audit log page for full traceability
- **Dashboard Chat Enhancements**: Real-time execution progress display with emergency stop button
- **Dashboard Monitoring**: Chart real-time refresh with empty state handling
- **Custom OpenAI Provider**: Support for OpenAI-compatible APIs (OneAPI / LiteLLM / Azure)
- **Dashboard AI Provider Selector**: UI support for custom-openai provider configuration
- **Docker Compose E2E Smoke Tests**: Full-chain deployment verification
- **Server Command Validation**: Server-side command security layer for dual-endpoint defense
- **Dev Environment**: `pnpm dev` one-click startup with development scripts

### Changed
- Docker Compose now passes Custom OpenAI, GitHub OAuth, and GitHub Token environment variables
- `.env.example` updated with bilingual (English + Chinese) annotations
- DEPLOY.md corrected to reflect actual default port 3001
- LICENSE updated with project copyright header

## [0.2.0] - 2026-02-11

Phase 2: Security, Experience & Platform Features

### Added
- **Real-Time Metrics SSE**: Server metrics pushed via SSE with <2s latency — replaced 60s polling with EventEmitter pub/sub bus
- **Audit Log CSV Export**: Streaming CSV export with date range and risk level filters, admin-only permission, Excel UTF-8 BOM support
- **API Rate Limiting**: Sliding window rate limiter — 100 req/min authenticated, 20 req/min anonymous, route-specific overrides (login: 5/min, chat: 30/min)
- **Team Invitation System**: Email-based team invitations with 7-day expiry tokens, accept/cancel/expire lifecycle, member management UI
- **RBAC Access Control**: 3-role hierarchy (owner > admin > member) with 32 permissions — single source of truth in `shared/src/rbac.ts`
- **Webhook Notifications**: 5 event types (task.completed, alert.triggered, server.offline, operation.failed, agent.disconnected) with HMAC-SHA256 signing and exponential backoff retry
- **GitHub OAuth Login**: GitHub one-click login with account linking by email, hash fragment token passing for security
- **Multi-Tenant Architecture**: Row-level tenant isolation with `tenant_id` columns, `requireTenant` middleware, tenant migration support
- **Shared Security Rules**: Extracted command/parameter security rules to `@aiinstaller/shared` package as single source of truth (750+ command patterns, 45+ parameter rules)
- **AI Provider Factory**: Dynamic provider selection with factory pattern — Claude (Tier 1), OpenAI (Tier 2), DeepSeek (Tier 2), Ollama (Tier 3)
- **Dashboard AI Provider Settings**: Provider switching UI with health check support
- **CI/CD Pipeline**: GitHub Actions workflows — lint, build, test matrix, coverage gates (80% threshold)
- **Docker Image Publishing**: Docker Hub + GHCR dual-registry release pipeline with multi-arch (amd64/arm64) version tagging
- **Agent Install Script**: Multi-platform binary build (linux-x64, linux-arm64, darwin-arm64, darwin-x64)
- **Security Whitepaper**: Five-layer defense architecture documentation
- **E2E Integration Tests**: Complete chat → plan → execute → result flow verification
- **Protocol Compatibility**: Server ↔ Agent WebSocket connection debugging and validation
- **Dashboard API Integration**: Dashboard ↔ Server API integration with automatic 401 → refresh → retry
- **README Rewrite**: Open-source community-facing project introduction
- **LICENSE**: AGPL-3.0 license for server/dashboard, Apache-2.0 for agent, MIT for shared
- **Docker Compose Optimization**: One-click deployment verification and fixes

### Changed
- Knowledge base expanded to 10+ common software packages
- Docker Compose deployment experience improved

## [0.1.0] - 2026-02-10

Phase 1: MVP Core Loop — Initial release

### Added
- **Project Initialization**: Monorepo setup with pnpm workspaces (`@aiinstaller/server`, `@aiinstaller/agent`, `@aiinstaller/dashboard`, `@aiinstaller/shared`)
- **Dashboard Foundation**: React 18 + Vite 5 + TypeScript with Shadcn/ui + Tailwind CSS
  - Login/Registration pages with JWT authentication
  - Server list and detail pages
  - Add server workflow with token management
  - AI chat interface with SSE streaming
  - Knowledge base search page
  - Settings page
  - Zustand state management
  - Responsive design with mobile adaptation
- **Server Core**: Hono web framework + ws WebSocket server
  - REST API routing with JWT authentication middleware
  - Server management CRUD API
  - AI chat API with SSE streaming responses
  - Session manager (conversation context + history)
  - Server profile manager (system info + software inventory)
  - Task executor (command dispatch + result handling)
- **Agent Core**: WebSocket real-time command execution
  - System environment detection
  - Real-time command execution with output streaming
  - Service discovery (systemd/pm2/docker)
- **AI Engine**: Multi-provider support
  - Claude Provider (Anthropic SDK)
  - OpenAI Provider (GPT-4o)
  - Ollama Provider (local models)
  - DeepSeek Provider
  - AI quality checker (output validation)
  - Token counting and usage statistics
- **Database**: Drizzle ORM + SQLite
  - Schema design and migrations
  - Repository layer (data access encapsulation)
- **Security**: Five-layer defense architecture
  - Command classifier (5 risk levels: safe → critical)
  - Parameter auditor (dangerous parameter/path detection)
  - Enhanced command security audit rule library
- **Knowledge Base**: Built-in knowledge for 10+ common software packages with RAG retrieval
- **Documentation**: Quick start guide, API documentation, OpenAPI specification
- **Document Source Tracking**: Update history tracking for documentation sources
- **Docker Compose**: One-click `docker compose up` self-deployment

### Fixed
- Task queue detection and generation logic
- Task ID extraction and token statistics accuracy

[Unreleased]: https://github.com/jingjinbao/ServerPilot/compare/v0.3.0-beta...HEAD
[0.3.0-beta]: https://github.com/jingjinbao/ServerPilot/compare/v0.2.0...v0.3.0-beta
[0.2.0]: https://github.com/jingjinbao/ServerPilot/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jingjinbao/ServerPilot/releases/tag/v0.1.0
