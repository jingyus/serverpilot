# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- InstallAIAgent multi-provider support (decouple Anthropic SDK)
- Product Hunt launch preparation
- README placeholder URL cleanup & CI badges

## [0.3.0-beta] - 2026-02-11

Phase 3: Open Source Release (in progress)

### Added
- **Dashboard Alerts**: Alert management page with real-time notification support
- **Dashboard Audit Logs**: Operation audit log page for full traceability
- **Dashboard Chat Enhancements**: Real-time execution progress display with emergency stop button
- **Dashboard Monitoring**: Chart real-time refresh with empty state handling
- **Custom OpenAI Provider**: Support for OpenAI-compatible APIs (OneAPI / LiteLLM / Azure)
- **Dashboard AI Provider Selector**: UI support for custom-openai provider configuration
- **E2E Smoke Tests**: Docker Compose full-chain deployment verification
- **Server Command Validation**: Server-side command security layer for dual-endpoint defense
- **Dev Environment**: `pnpm dev` one-click startup with development scripts

### Changed
- TODO.md synced with Phase 1/2/3 progress status

## [0.2.0] - 2026-02-11

Phase 2: Security & Experience

### Added
- **Shared Security Rules**: Extracted command/parameter security rules to `@aiinstaller/shared` package as single source of truth (750+ command patterns, 45+ parameter rules)
- **AI Provider Factory**: Dynamic provider selection with factory pattern — Claude (Tier 1), OpenAI (Tier 2), DeepSeek (Tier 2), Ollama (Tier 3)
- **Dashboard AI Provider Settings**: Provider switching UI with health check support
- **CI/CD Pipeline**: GitHub Actions workflows — lint, build, test matrix, coverage gates (80% threshold)
- **Docker Image Publishing**: Docker Hub + GHCR dual-registry release pipeline with version tagging
- **Agent Install Script**: Multi-platform binary build (linux-x64, linux-arm64, darwin-arm64, darwin-x64)
- **Security Whitepaper**: Five-layer defense architecture documentation
- **E2E Integration Tests**: Complete chat → plan → execute → result flow verification
- **Protocol Compatibility**: Server ↔ Agent WebSocket connection debugging and validation
- **Dashboard API Integration**: Dashboard ↔ Server API integration with automatic 401 → refresh → retry
- **README Rewrite**: Open-source community-facing project introduction
- **LICENSE**: MIT license and open-source compliance preparation
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
  - Settings page (task-001)
  - Zustand state management
  - Responsive design with mobile adaptation
- **Server Core**: Hono web framework + ws WebSocket server
  - REST API routing with JWT authentication middleware
  - Server management CRUD API
  - AI chat API with SSE streaming responses
  - Session manager (conversation context + history)
  - Server profile manager (system info + software inventory)
  - Task executor (command dispatch + result handling)
- **Agent Core**: WebSocket real-time command execution (task-002)
  - System environment detection
  - Real-time command execution with output streaming
  - Service discovery (systemd/pm2/docker)
- **AI Engine**: Multi-provider support
  - Claude Provider (Anthropic SDK)
  - OpenAI Provider (GPT-4o)
  - Ollama Provider (local models)
  - DeepSeek Provider
  - AI quality checker (output validation)
  - Token counting and usage statistics (task-003)
- **Database**: Drizzle ORM + SQLite
  - Schema design and migrations
  - Repository layer (data access encapsulation)
- **Security**: Five-layer defense architecture
  - Command classifier (5 risk levels: safe → critical)
  - Parameter auditor (dangerous parameter/path detection)
  - Enhanced command security audit rule library
- **Knowledge Base**: Built-in knowledge for 10+ common software packages with RAG retrieval
- **Documentation**: Quick start guide, API documentation, OpenAPI specification
- **Document Source Tracking**: Update history tracking for documentation sources (task-004)
- **Docker Compose**: One-click `docker compose up` self-deployment

### Fixed
- Task queue detection and generation logic
- Task ID extraction and token statistics accuracy

[Unreleased]: https://github.com/your-org/ServerPilot/compare/v0.3.0-beta...HEAD
[0.3.0-beta]: https://github.com/your-org/ServerPilot/compare/v0.2.0...v0.3.0-beta
[0.2.0]: https://github.com/your-org/ServerPilot/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/your-org/ServerPilot/releases/tag/v0.1.0
