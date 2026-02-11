# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously at ServerPilot. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Email your findings to: **security@serverpilot.dev**
3. Include the following in your report:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within **48 hours**
- **Assessment**: We will provide an initial assessment within **5 business days**
- **Resolution**: We aim to resolve critical vulnerabilities within **14 days**
- **Disclosure**: We will coordinate with you on public disclosure timing

### Scope

The following components are in scope for security reports:

| Component | License | Scope |
| --------- | ------- | ----- |
| `packages/server/` | AGPL-3.0 | WebSocket server, AI agent integration, API endpoints, authentication |
| `packages/agent/` | Apache-2.0 | Command execution, environment detection, privilege escalation |
| `packages/dashboard/` | AGPL-3.0 | Web UI, client-side state management |
| `packages/shared/` | MIT | Protocol schemas, validation logic |

### Security Architecture

ServerPilot implements a **five-layer defense-in-depth** strategy:

1. **Command Classification** - Commands are classified into risk levels (GREEN / YELLOW / RED / CRITICAL / FORBIDDEN) with appropriate approval workflows
2. **Parameter Validation** - All command parameters undergo safety auditing before execution
3. **Pre-operation Snapshots** - Critical operations create rollback snapshots before execution
4. **Emergency Kill Switch** - Immediate halt capability for all running operations
5. **Audit Trail** - Complete logging of all operations for traceability

### Agent Security Model

- The Agent runs as a non-root `serverpilot` user
- Privilege escalation is managed through `/etc/sudoers.d/serverpilot`
- Only pre-approved operations receive elevated privileges
- All external inputs are validated using Zod schemas

### Out of Scope

- Denial of service attacks
- Social engineering
- Vulnerabilities in third-party dependencies (report these to the respective maintainers)
- Issues that require physical access to the server

## Security Best Practices for Users

1. **Keep ServerPilot updated** to the latest version
2. **Use strong authentication** credentials
3. **Review agent permissions** regularly
4. **Monitor audit logs** for suspicious activity
5. **Run the agent** with minimal required privileges
6. **Network isolation** - Deploy the server behind a reverse proxy with TLS

## Recognition

We appreciate the security research community's efforts in helping keep ServerPilot secure. Reporters of valid vulnerabilities will be acknowledged in our security advisories (unless they prefer to remain anonymous).
