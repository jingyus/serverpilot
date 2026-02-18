# ServerPilot License Strategy

ServerPilot uses an **Open Core** licensing model with a clear separation:
**100% of core functionality is open source** (Self-Hosted), with Cloud-only
features reserved for the managed SaaS offering.

## License Overview

| Component | License | SPDX Identifier | File |
|-----------|---------|------------------|------|
| **Server** (Self-Hosted) | AGPL-3.0 | `AGPL-3.0` | [LICENSE](LICENSE) |
| **Dashboard** (Self-Hosted) | AGPL-3.0 | `AGPL-3.0` | [LICENSE](LICENSE) |
| **Agent** | Apache-2.0 | `Apache-2.0` | [packages/agent/LICENSE](packages/agent/LICENSE) |
| **Shared** | MIT | `MIT` | [packages/shared/LICENSE](packages/shared/LICENSE) |
| **Cloud SaaS** | Commercial | Proprietary | [LICENSE-EE](LICENSE-EE) |

## What This Means

### For Self-Hosted Users (Free, Open Source)

The **Self-Hosted deployment** is fully open source under AGPL-3.0. You can:

✅ **Use it for free, forever** — No feature limits, no user limits, no server limits
✅ **Self-host on your own servers** — Full data ownership and control
✅ **Access all core features** — Multi-server management, team collaboration, webhooks, alerts, metrics, audit export, OAuth login, etc.
✅ **Modify the source code** — Adapt it to your needs
✅ **Use it commercially** — Deploy internally in your organization
✅ **Contribute back to the project** — Help improve ServerPilot for everyone

**AGPL-3.0 requirements**:
- If you modify ServerPilot and offer it as a network service, you must make your modifications available under the same license
- This protects the open-source community from cloud vendors who might take the code without contributing back

**What you need to provide yourself**:
- AI Provider API Key (Anthropic, OpenAI, DeepSeek, or use local Ollama)
- OAuth configuration (if you want GitHub login)
- Infrastructure management (backups, updates, security)

### For Cloud Users (AI-Driven Platform)

**ServerPilot Cloud** (https://serverpilot.io) is our AI-driven DevOps platform:

✅ Same features as Self-Hosted (multi-server, team, webhooks, etc.)
✅ **Plus** official AI Provider with smart routing (50-60% cost savings vs self-managed API)
✅ **Plus** AI Skills: log scanner, security audit, performance optimizer, cost analyzer
✅ **Plus** auto weekly reports and trend analysis
✅ **Plus** enterprise SSO (SAML 2.0, Google Workspace, Okta)
✅ **Plus** compliance reports (SOC2, ISO27001, GDPR)
✅ **Plus** 99.9% SLA and priority support

**Pricing**:
- Free tier: 1 server, 100 AI calls/month
- Pro: $19/month — 10 servers, 2000 AI calls/month, AI log/security scanner
- Team: $49/month — unlimited servers & AI calls, all AI Skills
- Enterprise: $199/month — custom AI Skills, SAML SSO, compliance, dedicated support

### For Agent Users

The **Agent** is licensed under Apache-2.0, the most enterprise-friendly
open-source license. You can deploy agents on any server without license
concerns. This is intentional — we want the agent to be as widely
deployable as possible.

### For Library/SDK Users

The **Shared** package (protocol types, Zod schemas, security rules) is
MIT licensed. You can use it in your own projects with minimal restrictions.

## Feature Availability

All core features are available in both Self-Hosted and Cloud deployments:

| Feature | Self-Hosted | Cloud |
|---------|:-----------:|:-----:|
| **Core AI Features** |
| AI Chat (multi-provider) | ✅ | ✅ |
| Command Execution | ✅ | ✅ |
| Knowledge Base (RAG) | ✅ | ✅ |
| Error Auto-Diagnosis | ✅ | ✅ |
| **Server Management** |
| Multi-Server Management | ✅ | ✅ |
| Real-time Metrics | ✅ | ✅ |
| **Team Collaboration** |
| Multi-User (RBAC) | ✅ | ✅ |
| Team Invitations | ✅ | ✅ |
| **Notifications & Monitoring** |
| Webhooks | ✅ | ✅ |
| Alert System | ✅ | ✅ |
| **Security & Audit** |
| Audit Log Export (CSV) | ✅ | ✅ |
| OAuth Login (GitHub) | ✅ ⚙️ | ✅ |
| API Rate Limiting | ✅ | ✅ |
| **Cloud-Only AI Features** |
| Official AI Provider (Smart Routing) | ❌ | ✅ |
| AI Log Scanner (Auto Diagnosis) | ❌ | ✅ |
| AI Security Audit (CVE Detection) | ❌ | ✅ |
| AI Performance Optimizer | ❌ | ✅ |
| AI Cost Analyzer | ❌ | ✅ |
| AI Backup Advisor | ❌ | ✅ |
| **Cloud-Only Infrastructure** |
| Auto Weekly Reports | ❌ | ✅ |
| Enterprise SSO (SAML) | ❌ | ✅ |
| Compliance Reports (SOC2) | ❌ | ✅ |
| Multi-Tenant Isolation | ❌ | ✅ |
| Subscription Billing | ❌ | ✅ |

⚙️ = Self-configurable (you provide your own OAuth App credentials)

## Comparison with Other Models

### GitLab (Old Strategy)
GitLab CE was fully open source with all features. GitLab.com (SaaS) was
the same code, just hosted for you. **This is our model** — Self-Hosted has
all features, Cloud is convenience + enterprise enhancements.

### GitLab (New Strategy)
GitLab now has CE (open source) vs EE (proprietary). Many features
(geo-replication, advanced CI/CD) are EE-only. **We deliberately avoid this**
— all DevOps features are open source.

### Supabase / Appwrite
100% open source, SaaS hosting is the business model. **Similar to us**, except
we add some Cloud-only infrastructure enhancements (SAML SSO, compliance).

### Elastic / MongoDB (SSPL)
Server Side Public License — controversial, not OSI-approved. **We use
AGPL-3.0 instead**, which is recognized and well-understood.

## Why AGPL-3.0 for Server/Dashboard?

1. **Protects the open-source community**: Cloud vendors must contribute back
   if they modify and host our code.

2. **Does not restrict Self-Hosted users**: You can use it freely internally,
   even commercially. AGPL only kicks in if you modify and offer as a service.

3. **Well-established license**: Used by MongoDB (pre-SSPL), Nextcloud, Grafana.

4. **Compatible with our business model**: Cloud is our SaaS, we're not worried
   about AGPL "infection" because we own the code.

## Why Apache-2.0 for Agent?

The agent runs on user servers and needs to be as permissive as possible:

- No copyleft obligations
- Can be embedded in proprietary systems
- Patent grant for extra safety
- Widely trusted by enterprises

## Development Guidelines

### Adding New Features

**Core features** (multi-server, team, webhooks, alerts, etc.):
- Always add to the open-source codebase (Server/Dashboard)
- No feature flags restricting access
- Self-Hosted users get it for free

**Cloud-only features** (SAML SSO, compliance reports, billing):
- Infrastructure enhancements that only make sense in managed SaaS
- Use `CLOUD_ONLY` feature flags
- Clearly document why it's Cloud-only (requires managed infra, not a capability restriction)

### Reviewing Contributions

- Welcome community contributions to all open-source components
- Require Contributor License Agreement (CLA) for significant changes
- Ensure contributions align with AGPL-3.0 license

## FAQ

**Q: Can I use ServerPilot Self-Hosted for my company?**
A: Yes! AGPL-3.0 allows internal commercial use without restrictions.

**Q: What if I modify ServerPilot and deploy it internally?**
A: That's fine! AGPL only requires you to share modifications if you offer
it as a network service to others.

**Q: Can I sell ServerPilot hosting to customers?**
A: Yes, but you must make your modifications available under AGPL-3.0.
Alternatively, contact us about a commercial partnership.

**Q: Why not MIT/Apache for everything?**
A: AGPL protects us from cloud vendors taking the code without contributing
back. MIT/Apache would allow competitors to create proprietary forks.

**Q: Does AGPL "infect" my code if I use ServerPilot?**
A: No. If you're just **using** ServerPilot (Self-Hosted or Cloud API), it
doesn't affect your code's license. AGPL only applies if you modify and
distribute ServerPilot itself.

**Q: Can I contribute if I work for a cloud provider?**
A: Yes! Contributions are welcome from everyone, regardless of employer.
Your contribution will be under the project's licenses.

**Q: How do I upgrade from Self-Hosted to Cloud?**
A: Cloud provides data migration tools to import your Self-Hosted config
and history. No vendor lock-in — you can always export and return to Self-Hosted.

## Contact

For licensing questions, partnership inquiries, or commercial licensing:
- Email: licensing@serverpilot.io
- Website: https://serverpilot.io/licensing

---

*This licensing strategy is effective as of February 2026. We reserve the
right to update it for future versions, but existing users are grandfathered
under the license of the version they adopted.*
