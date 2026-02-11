# Contributing to ServerPilot

Thank you for your interest in contributing to ServerPilot! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Knowledge Base Contributions](#knowledge-base-contributions)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)
- [License](#license)

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing. We are committed to providing a welcoming and inclusive experience for everyone.

## Getting Started

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0
- **Git**
- **Docker** and **Docker Compose** (for deployment testing)

### Installation

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/<your-username>/ServerPilot.git
cd ServerPilot

# 3. Run the setup script (checks prerequisites, installs deps, creates .env.local)
./scripts/dev-setup.sh

# 4. (Optional) Edit .env.local to configure your AI provider
# 5. Start development
pnpm dev
```

> **Manual setup** (if you prefer not to use the script):
> ```bash
> pnpm install
> cp .env.example .env.local
> # Edit .env.local with your settings
> pnpm dev
> ```

### Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | No | Secret for JWT tokens (auto-generated if not set) |
| `AI_PROVIDER` | No | AI provider: `claude`, `openai`, `ollama`, `deepseek` (default: `claude`) |
| `ANTHROPIC_API_KEY` | If using Claude | Anthropic API key |
| `OPENAI_API_KEY` | If using OpenAI | OpenAI API key |
| `DEEPSEEK_API_KEY` | If using DeepSeek | DeepSeek API key |
| `DATABASE_PATH` | No | SQLite database path (default: `./data/serverpilot.db`) |
| `SERVER_PORT` | No | Server port (default: `3000`) |

### Verifying Your Setup

```bash
# Run all quality checks
pnpm typecheck    # TypeScript type checking
pnpm lint         # ESLint
pnpm test         # Unit tests

# Run specific package tests
pnpm --filter @aiinstaller/server test
pnpm --filter @aiinstaller/dashboard test
pnpm --filter @aiinstaller/agent test
```

## Development Environment

### Available Commands

```bash
# Development
pnpm dev                    # Start all services in dev mode
pnpm dev:server             # Start server only
pnpm dev:dashboard          # Start dashboard only
pnpm dev:agent              # Start agent only

# Building
pnpm build                  # Build all packages
pnpm build:server           # Build server only
pnpm build:dashboard        # Build dashboard only
pnpm build:binary           # Build agent binary (Bun)

# Testing
pnpm test                   # Run all tests
pnpm test:watch             # Run tests in watch mode
pnpm test:coverage          # Run tests with coverage report
pnpm test:e2e               # Run Playwright E2E tests

# Quality
pnpm lint                   # Run ESLint
pnpm lint:fix               # Auto-fix lint issues
pnpm format                 # Format code with Prettier
pnpm typecheck              # TypeScript type checking

# Database (server)
pnpm --filter @aiinstaller/server db:generate   # Generate Drizzle migrations
pnpm --filter @aiinstaller/server db:migrate    # Run migrations
pnpm --filter @aiinstaller/server db:studio     # Open Drizzle Studio
```

### IDE Setup

We recommend **VS Code** with the following extensions:

- ESLint
- Prettier
- Tailwind CSS IntelliSense
- TypeScript Importer

## Project Structure

```
ServerPilot/
├── packages/
│   ├── server/          # Backend - Hono + WebSocket + Drizzle ORM
│   ├── agent/           # Remote agent - Bun binary
│   ├── dashboard/       # Frontend - React + Vite + Tailwind
│   └── shared/          # Shared types and Zod schemas
├── knowledge-base/      # AI knowledge base for common software
│   ├── nginx/
│   ├── mysql/
│   ├── docker/
│   └── ...
├── tests/               # Root-level integration tests
├── docs/                # Project documentation
├── scripts/             # Build and automation scripts
└── .github/             # CI/CD workflows and templates
```

### Package Responsibilities

| Package | License | Responsibility |
| --- | --- | --- |
| `@aiinstaller/server` | AGPL-3.0 | API server, WebSocket, AI integration, auth |
| `@aiinstaller/agent` | Apache-2.0 | Remote command execution, environment detection |
| `@aiinstaller/dashboard` | AGPL-3.0 | Web UI, state management, user interactions |
| `@aiinstaller/shared` | MIT | Protocol schemas, Zod validation, shared types |

## Development Workflow

### Branch Naming

```
feat/<description>       # New feature
fix/<description>        # Bug fix
refactor/<description>   # Code refactoring
docs/<description>       # Documentation
test/<description>       # Test additions/changes
chore/<description>      # Maintenance tasks
```

### Commit Messages

Follow the conventional commit format:

```
<type>(<scope>): <description>

[optional body]
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

**Scopes**: `server`, `agent`, `dashboard`, `shared`, `kb` (knowledge-base), `ci`

**Examples**:
```
feat(server): add WebSocket reconnection logic
fix(dashboard): resolve auth token refresh race condition
docs(kb): add Redis troubleshooting guide
test(server): add unit tests for provider factory
```

### Workflow

1. Create a branch from `master` with the appropriate prefix
2. Make your changes following the code standards
3. Write or update tests as needed
4. Ensure all checks pass: `pnpm typecheck && pnpm lint && pnpm test`
5. Submit a Pull Request using the PR template

## Code Standards

### TypeScript

- **Strict mode** is enabled across all packages
- Use explicit types for function parameters and return values
- Use `interface` for object shapes, `type` for unions/intersections
- Use Zod for runtime validation of external data

### File Size

- **Soft limit**: 500 lines per file
- **Hard limit**: 800 lines per file
- If a file exceeds the soft limit, consider splitting it into smaller modules

### Naming Conventions

| Element | Convention | Example |
| --- | --- | --- |
| Files | kebab-case | `auth-middleware.ts` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Variables/Functions | camelCase | `handleConnection` |
| Classes/Interfaces | PascalCase | `WebSocketServer` |
| Type parameters | Single uppercase | `T`, `K`, `V` |

### Import Order

1. Node.js built-in modules
2. External dependencies
3. Internal packages (`@aiinstaller/*`)
4. Relative imports

### Comments

- Explain **why**, not **what**
- Use JSDoc for public APIs
- Avoid obvious comments

## Testing

### Coverage Requirements

| Module | Minimum Coverage |
| --- | --- |
| Security modules | 95% |
| AI modules | 90% |
| Protocol modules | 85% |
| UI components | 70% |
| **Overall** | **80%** |

### Testing Patterns

- Use **AAA** pattern: Arrange, Act, Assert
- Use descriptive test names that explain the expected behavior
- Mock external dependencies, not internal modules

### Running Tests

```bash
# Root-level tests (server, agent, shared, integration)
pnpm test

# Dashboard tests (separate jsdom environment)
cd packages/dashboard && pnpm test

# With coverage
pnpm test:coverage

# E2E tests
pnpm test:e2e
```

> **Note**: Dashboard tests use a separate Vitest config with `jsdom` environment. Run them from the `packages/dashboard/` directory.

## Knowledge Base Contributions

The knowledge base (`knowledge-base/`) powers ServerPilot's AI assistant with information about common software installation, configuration, and troubleshooting.

See [Knowledge Base Contribution Guide](docs/knowledge-base-contributing.md) for detailed instructions on adding or updating knowledge base entries.

### Quick Overview

Each software entry is a directory under `knowledge-base/` containing:

```
knowledge-base/<software>/
├── installation.md      # Installation steps for various OS
├── configuration.md     # Common configuration patterns
└── troubleshooting.md   # Common issues and solutions
```

## Submitting Changes

### Pull Request Process

1. Ensure your branch is up to date with `master`
2. Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md) completely
3. Ensure CI checks pass (lint, typecheck, tests)
4. Request review from maintainers
5. Address review feedback

### PR Requirements

- All CI checks must pass
- Test coverage must not decrease
- New features must include tests
- Documentation must be updated if applicable

## Reporting Issues

### Bug Reports

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version)
- Logs or screenshots if applicable

### Feature Requests

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md) and include:

- Problem description
- Proposed solution
- Alternatives considered

### Security Vulnerabilities

**Do NOT open public issues for security vulnerabilities.** Please follow our [Security Policy](SECURITY.md) and report vulnerabilities to **security@serverpilot.dev**.

## License

By contributing to ServerPilot, you agree that your contributions will be licensed under the respective package licenses:

- **Server & Dashboard**: [AGPL-3.0](LICENSE)
- **Agent**: [Apache-2.0](packages/agent/LICENSE)
- **Shared**: [MIT](packages/shared/LICENSE)

---

Questions? Open a [Discussion](https://github.com/ServerPilot/ServerPilot/discussions) or reach out to the maintainers.
