# ServerPilot License Strategy

ServerPilot uses an **Open Core** licensing model. All source code lives in a
single monorepo, but different components are covered by different licenses.

## License Overview

| Component | License | SPDX Identifier | File |
|-----------|---------|------------------|------|
| **Server** (CE features) | AGPL-3.0 | `AGPL-3.0` | [LICENSE](LICENSE) |
| **Dashboard** (CE features) | AGPL-3.0 | `AGPL-3.0` | [LICENSE](LICENSE) |
| **Agent** | Apache-2.0 | `Apache-2.0` | [packages/agent/LICENSE](packages/agent/LICENSE) |
| **Shared** | MIT | `MIT` | [packages/shared/LICENSE](packages/shared/LICENSE) |
| **EE features** | Commercial | `LicenseRef-ServerPilot-EE` | [LICENSE-EE](LICENSE-EE) |
| **Cloud package** | BUSL-1.1 | `BUSL-1.1` | packages/cloud/LICENSE |

## What This Means

### For Individual Developers & Small Teams

The **Community Edition (CE)** is fully open source under AGPL-3.0. You can:

- Use it for free, forever
- Self-host on your own servers
- Modify the source code
- Contribute back to the project

The AGPL-3.0 requires that if you modify ServerPilot and offer it as a
network service, you must make your modifications available under the same
license.

### For Enterprise Users

**Enterprise Edition (EE)** features require a commercial license. This
includes multi-server management, team collaboration, webhooks, alerts,
metrics monitoring, audit export, OAuth login, and rate limiting.

Purchase a subscription at [serverpilot.io/pricing](https://serverpilot.io/pricing).

### For Agent Users

The **Agent** is licensed under Apache-2.0, the most enterprise-friendly
open-source license. You can deploy agents on any server without license
concerns. This is intentional — we want the agent to be as widely
deployable as possible.

### For Library/SDK Users

The **Shared** package is MIT licensed. You can use the protocol types,
Zod schemas, and security rules in your own projects with minimal
restrictions.

## How to Identify License Scope

Every source file includes an SPDX license header on line 1:

```typescript
// SPDX-License-Identifier: AGPL-3.0        — CE feature (open source)
// SPDX-License-Identifier: MIT              — Shared library (open source)
// SPDX-License-Identifier: Apache-2.0       — Agent (open source)
// SPDX-License-Identifier: BUSL-1.1         — Cloud-only (source-available)
// SPDX-License-Identifier: LicenseRef-ServerPilot-EE  — EE feature (commercial)
```

Additionally, EE features are gated at runtime by feature flags:

```typescript
// Server-side: feature availability is checked via FEATURES.*
import { FEATURES } from '../config/edition.js';

if (!FEATURES.multiServer) {
  return c.json({ error: 'Feature not available in CE' }, 403);
}
```

## Edition Feature Mapping

| Feature | CE (AGPL-3.0) | EE (Commercial) |
|---------|:---:|:---:|
| AI Chat | Y | Y |
| Command Execution | Y | Y |
| Knowledge Base (RAG) | Y | Y |
| Error Auto-Diagnosis | Y | Y |
| Basic Audit Log | Y | Y |
| Multi-Server Management | | Y |
| Team Collaboration (RBAC) | | Y |
| Webhook Notifications | | Y |
| Alert System | | Y |
| Metrics Monitoring (SSE) | | Y |
| Audit Log Export (CSV) | | Y |
| OAuth Login | | Y |
| API Rate Limiting | | Y |
| Multi-Tenant Isolation | | Y (Cloud) |
| Subscription Billing | | Y (Cloud) |

## Why AGPL-3.0 for the Core?

We chose AGPL-3.0 (not MIT) for the server and dashboard because:

1. **Prevents proprietary forks** — competitors cannot take our code,
   modify it, and offer it as a closed-source SaaS without contributing
   back.
2. **Protects the community** — improvements made by cloud providers must
   be shared with the open-source community.
3. **Industry standard** — GitLab, Grafana, and MongoDB use similar
   copyleft-based Open Core models.

The AGPL-3.0 does NOT restrict:
- Self-hosting for internal use (even commercially)
- Using the CE as-is without modifications
- Integrating with other systems via the API

## Why Apache-2.0 for the Agent?

The Agent runs on customer servers. We chose Apache-2.0 because:

1. **No copyleft concerns** — enterprises can deploy agents without
   worrying about AGPL network-use obligations.
2. **Full auditability** — security-conscious teams can review every
   line of code running on their infrastructure.
3. **Maximum adoption** — fewer license restrictions = more users.

## Contributing

By submitting a pull request, you agree that your contributions will be
licensed under the same license as the files being modified:

- Changes to `packages/agent/` → Apache-2.0
- Changes to `packages/shared/` → MIT
- Changes to `packages/server/` or `packages/dashboard/` → AGPL-3.0
- Changes to `packages/cloud/` → BUSL-1.1

We may ask contributors to sign a Contributor License Agreement (CLA)
to ensure we can maintain the Open Core licensing model.

## Questions?

- License inquiries: license@serverpilot.io
- General questions: [GitHub Discussions](https://github.com/jingjinbao/ServerPilot/discussions)
