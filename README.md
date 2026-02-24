<p align="center">
  <img src="docs/assets/logo.png" alt="ServerPilot Logo" width="120" height="120">
</p>

<h1 align="center">ServerPilot</h1>

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
  <a href="https://github.com/jingjinbao/ServerPilot/actions/workflows/ci.yml"><img src="https://github.com/jingjinbao/ServerPilot/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/jingjinbao/ServerPilot/actions/workflows/test.yml"><img src="https://github.com/jingjinbao/ServerPilot/actions/workflows/test.yml/badge.svg" alt="Test"></a>
  <a href="https://github.com/jingjinbao/ServerPilot/actions/workflows/docker-publish.yml"><img src="https://github.com/jingjinbao/ServerPilot/actions/workflows/docker-publish.yml/badge.svg" alt="Docker"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
  <a href="https://github.com/jingjinbao/ServerPilot/releases"><img src="https://img.shields.io/github/v/release/jingjinbao/ServerPilot?include_prereleases" alt="Release"></a>
</p>

---

## What is ServerPilot?

**ServerPilot** is the AI-era replacement for traditional server management panels. Install with a single command, manage through AI conversations instead of clicking forms, and enjoy open-source transparency instead of closed-source black boxes.

```
Traditional DevOps: User → Scripts/Commands/Panel → Server
ServerPilot:       User → AI Chat → Plan Generated → User Confirms → Agent Executes → Feedback
```

**Core Value**: Manage servers using natural language. AI understands your intent and executes safely — no need to memorize complex commands.

## ✨ Key Features

### 🤖 AI-Powered Operations
- **Natural Language Interface** — Describe what you need; AI generates and executes the plan automatically
- **Multi-Model Support** — Works with Claude, OpenAI, DeepSeek, Ollama, or any Custom OpenAI-compatible API
- **Context-Aware** — AI remembers each server's environment, installed software, and configurations for precise operations
- **Self-Growing Knowledge Base** — Built-in documentation for common tech stacks (Nginx, MySQL, Docker, Node.js, etc.) with automatic updates

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
curl -fsSL https://raw.githubusercontent.com/jingjinbao/ServerPilot/master/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jingjinbao/ServerPilot/master/.env.example -o .env

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
git clone https://github.com/jingjinbao/ServerPilot.git
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

Images are published to both Docker Hub and GitHub Container Registry, supporting `linux/amd64` and `linux/arm64` architectures.

**Docker Hub:**

```bash
docker pull serverpilot/server:latest
docker pull serverpilot/agent:latest
docker pull serverpilot/dashboard:latest
```

**GitHub Container Registry:**

```bash
docker pull ghcr.io/jingjinbao/serverpilot/server:latest
docker pull ghcr.io/jingjinbao/serverpilot/agent:latest
docker pull ghcr.io/jingjinbao/serverpilot/dashboard:latest
```

**Tag Formats:**

| Tag Format | Example | Description |
|------------|---------|-------------|
| `latest` | `serverpilot/server:latest` | Latest master branch build |
| `{version}` | `serverpilot/server:0.1.0` | Semantic version (recommended for production) |
| `{major}.{minor}` | `serverpilot/server:0.1` | Major.minor version |
| `sha-{hash}` | `serverpilot/server:sha-a1b2c3d` | Git commit hash |

## 🎨 AI Provider Configuration

ServerPilot supports multiple AI model providers. Configure via environment variables:

| Provider | Environment Variables | Description |
|----------|----------------------|-------------|
| **Claude** (Default) | `AI_PROVIDER=claude`<br/>`ANTHROPIC_API_KEY=sk-...` | Anthropic Claude (Tier 1) |
| **OpenAI** | `AI_PROVIDER=openai`<br/>`OPENAI_API_KEY=sk-...` | GPT-4o and others (Tier 2) |
| **DeepSeek** | `AI_PROVIDER=deepseek`<br/>`DEEPSEEK_API_KEY=sk-...` | DeepSeek Chat (Tier 2) |
| **Ollama** | `AI_PROVIDER=ollama` | Local models (Tier 3) |
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
| **Server** | Node.js 22+, TypeScript, Hono, Drizzle ORM, SQLite | AGPL-3.0 |
| **Agent** | TypeScript, Bun (compiled to single binary) | Apache-2.0 |
| **Dashboard** | React 18, Vite 5, Tailwind CSS, Zustand, React Router 6 | AGPL-3.0 |
| **Shared** | Zod schema validation | MIT |
| **AI Providers** | Claude / OpenAI / DeepSeek / Ollama / Custom | - |
| **Deployment** | Docker Compose, GitHub Actions CI/CD | - |

## 📊 Comparison

| Feature | ServerPilot | BaoTa Panel | Ansible | Portainer |
|---------|:-----------:|:-----------:|:-------:|:---------:|
| AI-Powered Operations | ✅ | ❌ | ❌ | ❌ |
| No Command Memorization | ✅ | ✅ | ❌ | ✅ |
| Open Source | ✅ | ❌ | ✅ | Partial |
| Lightweight Agent | ✅ | ❌ | No Agent | ❌ |
| 5-Layer Security | ✅ | Basic | None | None |
| RAG Knowledge Base | ✅ | ❌ | ❌ | ❌ |
| Context-Aware AI | ✅ | Basic Info | Inventory | Basic |
| Built-in AI Key | ✅ | ❌ | ❌ | ❌ |
| Local Model Support | ✅ (Ollama) | ❌ | ❌ | ❌ |

## 🗺️ Roadmap

| Phase | Goals |
|-------|-------|
| **MVP (v0.1)** | Self-deploy → Install Agent → Connect → AI Operations (closed loop) |
| **v0.2** | Snapshot rollback + Scheduled tasks + Alerts + Self-learning knowledge base |
| **v0.3** | GitHub open source release + Community edition installer |
| **v1.0** | ServerPilot Cloud + Team collaboration + Billing |

## 💰 Deployment Modes & Pricing

| Mode | Features | Price |
|------|----------|-------|
| **Self-Hosted** | 🎉 100% open source, all features available<br/>✅ Multi-server, team collaboration, webhooks, monitoring<br/>⚙️ Bring your own AI API Key<br/>⚙️ Manually execute AI Skills (log inspection, security scans) | **Free Forever** |
| **Cloud Free** | ✅ All Self-Hosted features<br/>✅ Official AI (smart routing, 100 calls/month)<br/>🤖 Try AI Skills (log inspection, security scanning)<br/>📊 Limits: 1 server, 1 user | **$0/month** |
| **Cloud Pro** | ✅ 10 servers, 5 users<br/>✅ Official AI (2000 calls/month, 60% cost reduction)<br/>🤖 AI log inspection + AI security scanning<br/>📈 Weekly reports + Trend analysis | **$19/month** |
| **Cloud Team** | ✅ Unlimited servers & users<br/>✅ Unlimited AI calls (smart routing)<br/>🤖 All AI Skills (performance optimization, cost analysis)<br/>🔔 Auto-inspection + Proactive alerts | **$49/month** |
| **Cloud Enterprise** | ✅ All Team features<br/>🤖 Custom AI Skills + Dedicated models<br/>🛡️ SAML SSO + Compliance reports (SOC2, ISO27001)<br/>📞 SLA guarantees + Dedicated support | **From $199/month** |

**Core Philosophy**: Self-Hosted and Cloud have **identical core features** (multi-server, teams, webhooks, alerts). Cloud's value is in **AI intelligence** (official AI + smart routing + professional Skills) and **enterprise enhancements** (SAML SSO, compliance), not feature unlocking. Users pay for **AI DevOps expertise**, not server hosting.

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
| **EE Features** | [Commercial](LICENSE-EE) | Enterprise features (multi-server, team collaboration, etc.) |

See [LICENSING.md](LICENSING.md) for detailed licensing strategy.

## 🙏 Acknowledgments

Built with ❤️ using:
- [Anthropic Claude](https://www.anthropic.com/) — AI provider
- [Hono](https://hono.dev/) — Ultrafast web framework
- [Drizzle ORM](https://orm.drizzle.team/) — TypeScript ORM
- [Bun](https://bun.sh/) — Fast JavaScript runtime
- [Vite](https://vitejs.dev/) — Next generation frontend tooling

## 📬 Contact & Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/jingjinbao/ServerPilot/issues)
- **Documentation**: [docs/](docs/)
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting

---

<p align="center">
  <sub>Built with ❤️ by the ServerPilot team</sub>
</p>
