<h1 align="center">🚀 ServerPilot</h1>

<p align="center">
  <strong>AI-Powered Server Management Platform</strong>
</p>

<p align="center">
  Manage your servers through natural language conversations — Open Source, Secure, Self-Hosted
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/jingyus/serverpilot/actions/workflows/ci.yml"><img src="https://github.com/jingyus/serverpilot/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/jingyus/serverpilot/actions/workflows/test.yml"><img src="https://github.com/jingyus/serverpilot/actions/workflows/test.yml/badge.svg" alt="Test"></a>
  <a href="https://github.com/jingyus/serverpilot/actions/workflows/docker-publish.yml"><img src="https://github.com/jingyus/serverpilot/actions/workflows/docker-publish.yml/badge.svg" alt="Docker"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
  <a href="https://github.com/jingyus/serverpilot/releases"><img src="https://img.shields.io/github/v/release/jingyus/serverpilot?include_prereleases" alt="Release"></a>
  <a href="https://github.com/jingyus/serverpilot/stargazers"><img src="https://img.shields.io/github/stars/jingyus/serverpilot?style=social" alt="GitHub Stars"></a>
</p>

---

## What is ServerPilot?

**ServerPilot** is the AI-era replacement for traditional server management panels. Install with a single command, manage through AI conversations instead of clicking forms, and enjoy open-source transparency instead of closed-source black boxes.

```
Traditional DevOps: User → Scripts/Commands/Panel → Server
ServerPilot:       User → AI Chat → Plan Generated → User Confirms → Agent Executes → Feedback
```

**Core Value**: Manage servers using natural language. AI understands your intent and executes safely — no need to memorize complex commands.

---

<p align="center">
  <img src="images/1771944105900.jpg" alt="ServerPilot Dashboard" width="100%">
</p>

<p align="center">
  <em>Dashboard Overview - Server monitoring, operation trends, and real-time alerts</em>
</p>

---

## ✨ Key Features

### 🤖 AI-Powered Operations
- **Natural Language Interface** — Describe what you need; AI generates and executes the plan automatically
- **Multi-Model Support** — Works with Claude, OpenAI, DeepSeek, Ollama, or any Custom OpenAI-compatible API (OneAPI / LiteLLM / Azure)
- **Context-Aware** — AI remembers each server's environment, installed software, and configurations for precise operations
- **Self-Growing Knowledge Base** — Built-in documentation for common tech stacks (Nginx, MySQL, Docker, Node.js, etc.) with automatic updates from GitHub/official sites

### 🛡️ Enterprise-Grade Security
- **5-Layer Defense** — Command classification, parameter auditing, pre-operation snapshots, emergency kill switch, and complete audit trail
- **726+ Security Rules** — Commands classified into 5 risk levels (GREEN/YELLOW/RED/CRITICAL/FORBIDDEN)
- **45+ Parameter Patterns** — Automatic detection of dangerous flags and protected paths
- **Full Audit Trail** — Every operation tracked with user, timestamp, risk level, and outcome

### 📊 Real-Time Monitoring
- **Live Metrics** — CPU, memory, disk, and network monitoring with SSE streaming
- **Instant Alerts** — Webhook notifications for task completion, server offline, operation failures
- **Interactive Dashboards** — Real-time charts and historical trend analysis

### 🪶 Lightweight & Efficient
- **Minimal Footprint** — Single binary agent (<50MB, <1% CPU usage)
- **Zero-Config Deployment** — Works out of the box; customize only when needed
- **Cross-Platform** — Supports linux/amd64 and linux/arm64 architectures

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Dashboard                            │
│              React + Vite + Tailwind CSS + Zustand              │
│         Server List · AI Chat · Monitoring · Knowledge Base     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API + SSE Streaming
┌───────────────────────────┴─────────────────────────────────────┐
│                          Server                                  │
│                    Node.js + Hono + SQLite                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ AI Engine │ │ API Layer │ │ Knowledge│ │ Security & Audit   │  │
│  │(Multi-M.) │ │(REST+WS)  │ │Base(RAG) │ │(5-Layer Defense)   │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WSS Encrypted Connection
          ┌─────────────────┼─────────────────┐
          │                 │                 │
    ┌─────┴─────┐     ┌─────┴─────┐    ┌─────┴─────┐
    │  Agent A   │     │  Agent B   │    │  Agent C   │
    │ Production │     │  Staging   │    │    Dev     │
    │            │     │            │    │            │
    │ · Env Scan │     │ · Env Scan │    │ · Env Scan │
    │ · Exec Cmd │     │ · Exec Cmd │    │ · Exec Cmd │
    │ · Security │     │ · Security │    │ · Security │
    │ · Metrics  │     │ · Metrics  │    │ · Metrics  │
    └───────────┘     └───────────┘    └───────────┘
```

## 🚀 Quick Start

### Option 1: Docker Deployment (Recommended)

Use pre-built images — no code cloning or local compilation needed:

```bash
# 1. Download configuration files
curl -fsSL https://raw.githubusercontent.com/jingyus/serverpilot/master/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jingyus/serverpilot/master/.env.example -o .env

# 2. Edit .env (at minimum, set JWT_SECRET and AI Provider)
#    JWT_SECRET=your-secret-key-at-least-32-chars
#    AI_PROVIDER=claude
#    ANTHROPIC_API_KEY=sk-ant-...

# 3. Pull images and start services
docker compose pull && docker compose up -d

# 4. Open your browser
#    Dashboard: http://localhost:3001
#    API Docs:  http://localhost:3001/api-docs
```

View the auto-generated admin password in logs:

```bash
docker compose logs server | grep -i "password"
```

### Option 2: Build from Source

```bash
# 1. Clone the repository
git clone https://github.com/jingyus/serverpilot.git
cd ServerPilot

# 2. Build and start with Docker Compose
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# 3. Open http://localhost:3001 in your browser
```

For guided setup with AI configuration:

```bash
./init.sh
```

### Option 3: Local Development

```bash
# Install dependencies
pnpm install

# Start in development mode (hot reload)
pnpm dev

# Run tests
pnpm test

# Build agent binary
bun scripts/build-binary.ts
```

## 🐳 Docker Images

Images are published to GitHub Container Registry (GHCR), supporting `linux/amd64` and `linux/arm64` architectures.

```bash
docker pull ghcr.io/jingyus/serverpilot/server:latest
docker pull ghcr.io/jingyus/serverpilot/agent:latest
docker pull ghcr.io/jingyus/serverpilot/dashboard:latest
```

**Tag Formats:**

| Tag Format | Example | Description |
|------------|---------|-------------|
| `latest` | `ghcr.io/jingyus/serverpilot/server:latest` | Latest main branch build |
| `{version}` | `ghcr.io/jingyus/serverpilot/server:0.1.0` | Semantic version (recommended for production) |
| `{major}.{minor}` | `ghcr.io/jingyus/serverpilot/server:0.1` | Major.minor version |
| `sha-{hash}` | `ghcr.io/jingyus/serverpilot/server:sha-a1b2c3d` | Git commit hash |

## 🎨 AI Provider Configuration

ServerPilot supports multiple AI model providers. Configure via environment variables:

| Provider | Environment Variables | Description |
|----------|----------------------|-------------|
| **Claude** (Default) | `AI_PROVIDER=claude`<br/>`ANTHROPIC_API_KEY=sk-...` | Anthropic Claude (Tier 1, recommended) |
| **OpenAI** | `AI_PROVIDER=openai`<br/>`OPENAI_API_KEY=sk-...` | GPT-4o and others (Tier 2) |
| **DeepSeek** | `AI_PROVIDER=deepseek`<br/>`DEEPSEEK_API_KEY=sk-...` | DeepSeek Chat (Tier 2) |
| **Ollama** | `AI_PROVIDER=ollama` | Local models (Tier 3, no API key needed) |
| **Custom OpenAI** | `AI_PROVIDER=custom-openai` | Any OpenAI-compatible API |

**Custom OpenAI Compatible Services** (OneAPI / LiteLLM / Azure OpenAI):

```bash
AI_PROVIDER=custom-openai
CUSTOM_OPENAI_API_KEY=sk-your-api-key
CUSTOM_OPENAI_BASE_URL=https://your-api.example.com/v1
AI_MODEL=gpt-4o  # Optional: specify your model name
```

You can also switch providers dynamically via the Dashboard settings page without restarting services.

## 🛠️ Tech Stack

| Component | Technologies | License |
|-----------|-------------|---------|
| **Server** | Node.js 22+, TypeScript, Hono, Drizzle ORM, SQLite, Claude SDK | AGPL-3.0 |
| **Agent** | TypeScript, Bun (compiled to single binary) | Apache-2.0 |
| **Dashboard** | React 18, Vite 5, Tailwind CSS, Zustand, React Router 6 | AGPL-3.0 |
| **Shared** | Zod schema validation | MIT |
| **AI Providers** | Claude / OpenAI / DeepSeek / Ollama / Custom OpenAI-compatible | - |
| **Deployment** | Docker Compose, GitHub Actions CI/CD | - |

## 📊 Comparison with Other Tools

| Feature | ServerPilot | BaoTa Panel | Ansible | Portainer |
|---------|:-----------:|:-----------:|:-------:|:---------:|
| AI-Powered Operations | ✅ | ❌ | ❌ | ❌ |
| No Command Memorization | ✅ | ✅ | ❌ | ✅ |
| Open Source | ✅ | ❌ | ✅ | Partial |
| Lightweight Agent | ✅ | ❌ | No Agent | ❌ |
| 5-Layer Security | ✅ | Basic | None | None |
| RAG Knowledge Base | ✅ | ❌ | ❌ | ❌ |
| Context-Aware AI | ✅ | Basic Info | Inventory | Basic |
| Bring Your Own AI Key | ✅ | ❌ | ❌ | ❌ |
| Local Model Support | ✅ (Ollama) | ❌ | ❌ | ❌ |

## 💰 Pricing

**ServerPilot Community Edition is 100% open source and free forever.**

- ✅ **All core features available** — Multi-server management, team collaboration, webhooks, real-time monitoring
- ✅ **No feature limitations** — No trial periods, no paywalls, no artificial restrictions
- ✅ **Self-hosted on your infrastructure** — Full control over your data and deployment
- ⚙️ **Bring your own AI API Key** — Use Claude, OpenAI, DeepSeek, Ollama, or any OpenAI-compatible API
- 🔓 **No vendor lock-in** — Standard SQLite database, Docker deployment, open protocols

> 💡 **Future Plans**: We're considering a managed cloud version for users who prefer not to manage infrastructure. This would include official AI keys, automatic backups, and enterprise features (SAML SSO, compliance reports), but the self-hosted Community Edition will always remain fully-featured and free.

## 🗺️ Roadmap

| Phase | Goals | Status |
|-------|-------|--------|
| **MVP (v0.1)** | Self-deploy → Install Agent → Connect → AI Operations (closed loop) | ✅ Done |
| **v0.2** | Snapshot rollback + Scheduled tasks + Advanced alerts + Knowledge base auto-learning | 🚧 In Progress |
| **v0.3** | Community installer script + Plugin system + API extensions | 📋 Planned |
| **v1.0** | Stable APIs + Production-ready + Optional managed cloud service | 📋 Planned |

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System architecture, module responsibilities, data flows, communication protocols |
| [Security White Paper](docs/SECURITY.md) | Detailed five-layer defense-in-depth architecture |
| [Security Policy](SECURITY.md) | Vulnerability reporting process and security policy |
| [Deployment Guide](docs/deployment.md) | Docker Compose deployment guide |
| [API Documentation](http://localhost:3001/api-docs) | OpenAPI 3.0 specification with Swagger UI (when server is running) |

## 🔒 Security

ServerPilot implements a **five-layer defense-in-depth** strategy to protect your servers:

1. **Command Classification** — 726+ rules across 5 risk levels (GREEN / YELLOW / RED / CRITICAL / FORBIDDEN)
2. **Parameter Auditing** — 45+ dangerous parameter patterns, 40+ protected paths
3. **Pre-Operation Snapshots** — Automatic rollback points before critical operations
4. **Emergency Kill Switch** — One-click termination of all running operations
5. **Audit Trail** — Complete operation tracking and auditable records

The agent runs as a non-root user; only pre-approved operations receive elevated privileges. See [Security White Paper](docs/SECURITY.md) and [Security Policy](SECURITY.md) for details.

## 🤝 Contributing

We welcome Issues and Pull Requests!

```bash
# Fork and clone the repository
git clone https://github.com/your-username/ServerPilot.git
cd ServerPilot

# Install dependencies
pnpm install

# Development mode
pnpm dev

# Run tests
pnpm test

# Before submitting PR, ensure all checks pass
pnpm lint && pnpm typecheck && pnpm test
```

For detailed contribution guidelines, please refer to the contributing documentation in the project.

## 📄 License

ServerPilot uses an **Open Core** model:

| Component | License | Description |
|-----------|---------|-------------|
| **Server + Dashboard** (CE) | [AGPL-3.0](LICENSE) | Open source core, restricts cloud providers from direct use |
| **Agent** | [Apache-2.0](packages/agent/LICENSE) | Enterprise-friendly, 100% open source and auditable |
| **Shared** | [MIT](packages/shared/LICENSE) | Maximum ecosystem compatibility |

See [LICENSING.md](LICENSING.md) for detailed licensing strategy.

## 🙏 Acknowledgments

Built with ❤️ using:
- [Anthropic Claude](https://www.anthropic.com/) — AI provider
- [Hono](https://hono.dev/) — Ultrafast web framework
- [Drizzle ORM](https://orm.drizzle.team/) — TypeScript ORM
- [Bun](https://bun.sh/) — Fast JavaScript runtime
- [Vite](https://vitejs.dev/) — Next generation frontend tooling

## 📬 Contact & Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/jingyus/serverpilot/issues)
- **Documentation**: [docs/](docs/)
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting

---

<p align="center">
  If you find ServerPilot useful, please consider giving it a star ⭐ — it helps others discover the project!
</p>

<p align="center">
  <a href="https://star-history.com/#jingyus/serverpilot&Date">
    <img src="https://api.star-history.com/svg?repos=jingyus/serverpilot&type=Date" alt="Star History Chart" width="600">
  </a>
</p>

<p align="center">
  <sub>Built with ❤️ by the ServerPilot team</sub>
</p>
