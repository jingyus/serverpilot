# Skill Development Guide

Build AI-powered automation for your servers. This guide takes you from zero to a working Skill.

## Table of Contents

- [Quick Start — Your First Skill](#quick-start--your-first-skill)
- [skill.yaml Reference](#skillyaml-reference)
- [Tools API](#tools-api)
- [Triggers](#triggers)
- [Template Variables](#template-variables)
- [User Inputs](#user-inputs)
- [Security Model](#security-model)
- [Prompt Engineering](#prompt-engineering)
- [Testing Your Skill](#testing-your-skill)
- [Publishing](#publishing)

---

## Quick Start — Your First Skill

### 1. Create the Skill directory

```bash
mkdir -p skills/community/disk-checker
```

### 2. Write `skill.yaml`

```yaml
kind: skill
version: "1.0"

metadata:
  name: disk-checker
  displayName: "Disk Usage Checker"
  description: "Check disk usage and alert when partitions are running low"
  version: "0.1.0"
  author: "your-name"
  tags: [monitoring, disk]

triggers:
  - type: manual
  - type: cron
    schedule: "0 */6 * * *"   # Every 6 hours

tools:
  - shell
  - notify

inputs:
  - name: threshold_percent
    type: number
    required: false
    default: 85
    description: "Alert when disk usage exceeds this percentage"

constraints:
  risk_level_max: green        # Read-only commands only
  timeout: "1m"
  max_steps: 5

requires:
  os: [linux, darwin]

prompt: |
  ## Role
  You are a disk monitoring specialist.

  ## Task
  Check disk usage on server {{server.name}} ({{server.os}}).

  ## Steps
  1. Run `df -h` to list all mounted filesystems
  2. Identify partitions exceeding {{input.threshold_percent}}% usage
  3. If any partition is over threshold, send a notification via notify
  4. Report results in JSON format

  ## Output
  ```json
  {
    "severity": "info | warning | critical",
    "summary": "one-line result",
    "partitions": [
      {
        "mount": "/",
        "usage_percent": 72,
        "available": "15G"
      }
    ]
  }
  ```

outputs:
  - name: severity
    type: string
    description: "Result severity level"
  - name: report
    type: object
    description: "Full disk usage report"
```

### 3. Validate the manifest

```bash
# From the project root
pnpm --filter @aiinstaller/shared build
```

The `SkillManifestSchema` in `@aiinstaller/shared` is used to validate your `skill.yaml` at load time. Any validation errors will appear in the server logs with the exact field path and message.

### 4. Install and run

```bash
# Install from local directory
serverpilot skill install ./skills/community/disk-checker/

# Or through the Dashboard: Skills → Install → select directory
```

Once installed, you can trigger it manually from the Dashboard, or wait for the cron schedule.

---

## skill.yaml Reference

Every Skill is defined by a single `skill.yaml` file. Here is the complete field reference:

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"skill"` | Fixed identifier |
| `version` | `"1.0"` | Spec version (currently `"1.0"`) |
| `metadata` | object | Name, version, description (see below) |
| `triggers` | array | At least one trigger (see [Triggers](#triggers)) |
| `tools` | array | At least one tool (see [Tools API](#tools-api)) |
| `prompt` | string | The AI instruction (50–50,000 chars) |

### metadata (required)

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | yes | Lowercase + hyphens, 2–50 chars, pattern: `^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$` |
| `displayName` | string | yes | 1–100 chars |
| `description` | string | no | Up to 500 chars |
| `version` | string | yes | SemVer format: `"1.0.0"` |
| `author` | string | no | Up to 100 chars |
| `tags` | string[] | no | Up to 10 tags, each ≤ 30 chars |
| `icon` | string | no | Relative path to icon file |

### constraints (optional, has defaults)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `risk_level_max` | enum | `"yellow"` | Max command risk level: `green` \| `yellow` \| `red` \| `critical` |
| `timeout` | string | `"5m"` | Max execution time: `"30s"` \| `"5m"` \| `"1h"` |
| `max_steps` | number | `20` | Max commands per execution (1–100) |
| `requires_confirmation` | boolean | `false` | Require user approval before each run |
| `server_scope` | enum | `"single"` | `"single"` \| `"all"` \| `"tagged"` |
| `server_tags` | string[] | — | Required when `server_scope` is `"tagged"` |
| `run_as` | string | — | Execution user (e.g. `"root"`, `"deploy"`) |

### requires (optional)

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string | Minimum Agent version, e.g. `">=1.0.0"` |
| `os` | array | Supported OS: `linux`, `darwin`, `windows` |
| `commands` | string[] | Required system commands (checked before execution) |

### outputs (optional)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Identifier, pattern: `^[a-z_][a-z0-9_]*$` |
| `type` | enum | yes | `string` \| `number` \| `boolean` \| `object` |
| `description` | string | yes | Up to 500 chars |

---

## Tools API

Skills declare which tools they need. The AI can only call tools listed in the `tools` array — this is the principle of least privilege.

### `shell` — Execute commands on the server

The most common tool. Runs shell commands on the target server through the Agent.

```yaml
tools:
  - shell
```

**Security**: Every command goes through `classifyCommand()` and is checked against `risk_level_max`. See [Security Model](#security-model).

**In your prompt**, just tell the AI what to do:

```
Run `df -h` to check disk usage.
```

The AI will call the `shell` tool with that command. The result (stdout/stderr/exitCode) is returned to the AI for analysis.

### `read_file` — Read files on the server

Read file contents from the target server. Read-only — does not trigger risk classification.

```yaml
tools:
  - read_file
```

**In your prompt**:

```
Read the contents of /etc/nginx/nginx.conf to check the configuration.
```

### `write_file` — Write files on the server

Create or overwrite files on the server. Subject to `risk_level_max` constraints.

```yaml
tools:
  - write_file
```

**In your prompt**:

```
Write the optimized config to /etc/nginx/conf.d/performance.conf.
```

### `notify` — Send notifications

Send alerts through configured Webhook endpoints and Dashboard push notifications.

```yaml
tools:
  - notify
```

**In your prompt**:

```
If any critical issues are found, send a notification with the details.
```

The notification content, severity, and format are determined by the AI based on your prompt instructions.

### `http` — External HTTP requests

Call external APIs. Restricted to HTTPS only; internal/private network addresses are blocked.

```yaml
tools:
  - http
```

**In your prompt**:

```
Check the SSL certificate expiry by calling https://api.ssllabs.com/api/v3/analyze?host={{server.ip}}
```

### `store` — Persistent key-value storage

Each Skill gets its own isolated storage space (max 1MB). Useful for tracking state between runs — baselines, previous results, counters.

```yaml
tools:
  - store
```

**In your prompt**:

```
Save the current port list to store for comparison in the next run.
Read the previous port list from store and compare with current results.
```

---

## Triggers

Every Skill must declare at least one trigger. You can combine multiple triggers.

### `manual` — User clicks "Run" in Dashboard

```yaml
triggers:
  - type: manual
```

No configuration needed. The simplest trigger — great for on-demand tasks.

### `cron` — Scheduled execution

```yaml
triggers:
  - type: cron
    schedule: "0 8 * * *"     # Every day at 08:00
```

Standard 5-field cron expression:

```
┌─────── minute (0-59)
│ ┌───── hour (0-23)
│ │ ┌─── day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌ day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

**Common patterns**: `*/15 * * * *` (every 15min), `0 */6 * * *` (every 6h), `0 8 * * *` (daily 8AM), `0 3 * * 0` (weekly Sun 3AM), `0 0 1 * *` (monthly).

### `event` — React to system events

```yaml
triggers:
  - type: event
    on: alert.triggered
    filter:
      severity: [warning, critical]
```

**Available events**:

| Event | When it fires | Payload fields |
|-------|--------------|----------------|
| `alert.triggered` | Alert rule fires | severity, metric, value, serverId |
| `server.offline` | Server goes offline | serverId, lastSeen |
| `server.online` | Server comes online | serverId |
| `task.completed` | Task finishes | taskId, success, serverId |
| `task.failed` | Task fails | taskId, error, serverId |
| `operation.failed` | Operation fails | operationId, exitCode, serverId |
| `agent.disconnected` | Agent disconnects | agentId, serverId |
| `skill.completed` | Another Skill finishes | skillName, outputs |

The optional `filter` field matches against the event payload. Only events matching all filter conditions will trigger the Skill.

### `threshold` — Metric-based triggers

```yaml
triggers:
  - type: threshold
    metric: cpu.usage
    operator: gte
    value: 90
```

**Available metrics**:

| Metric | Description | Unit |
|--------|-------------|------|
| `cpu.usage` | CPU utilization | % (0–100) |
| `memory.usage_percent` | Memory utilization | % (0–100) |
| `disk.usage_percent` | Disk utilization | % (0–100) |
| `disk.io_wait` | Disk I/O wait | % |
| `network.rx_bytes` | Network receive rate | bytes/s |
| `network.tx_bytes` | Network transmit rate | bytes/s |
| `load.1min` | 1-minute load average | float |
| `load.5min` | 5-minute load average | float |

**Operators**: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`

### Combining triggers

A Skill can have multiple triggers. It will run whenever any trigger condition is met:

```yaml
triggers:
  - type: manual                     # User can always run it on demand
  - type: cron
    schedule: "0 8 * * *"           # Also runs daily at 08:00
  - type: event
    on: alert.triggered              # Also runs when alerts fire
    filter:
      severity: [critical]
  - type: threshold
    metric: cpu.usage
    operator: gte
    value: 95                        # Also runs on CPU spike
```

---

## Template Variables

Use `{{variable}}` syntax in your prompt. Variables are resolved at execution time before being sent to the AI.

### Server context

| Variable | Description | Example value |
|----------|-------------|---------------|
| `{{server.name}}` | Server display name | `"production-web-01"` |
| `{{server.os}}` | Operating system | `"Ubuntu 22.04"` |
| `{{server.ip}}` | Server IP address | `"192.168.1.100"` |

### Skill state

| Variable | Description | Example value |
|----------|-------------|---------------|
| `{{skill.last_run}}` | Previous execution time (ISO 8601) | `"2026-01-15T08:00:00Z"` |
| `{{skill.last_result}}` | Previous run output summary | `"Found 3 warnings..."` |
| `{{now}}` | Current time (ISO 8601) | `"2026-01-16T08:00:00Z"` |

### User inputs

| Variable | Description | Example value |
|----------|-------------|---------------|
| `{{input.<name>}}` | User-configured parameter | `{{input.log_paths}}` → `"/var/log/syslog"` |

**Example usage in prompt**:

```yaml
prompt: |
  Check server {{server.name}} ({{server.os}}) at {{server.ip}}.
  Scan the last {{input.lookback_hours}} hours of logs.
  Last check was {{skill.last_run}} — compare with previous findings.
```

---

## User Inputs

Define configurable parameters that users fill in when installing or configuring your Skill.

### Input types

| Type | YAML | Default example | Description |
|------|------|-----------------|-------------|
| `string` | `type: string` | `"/var/log/syslog"` | Free text |
| `number` | `type: number` | `85` | Numeric value |
| `boolean` | `type: boolean` | `true` | True/false toggle |
| `string[]` | `type: string[]` | `["/var/log/a", "/var/log/b"]` | List of strings |
| `enum` | `type: enum` | `"gzip"` | Pick from predefined options |

### Validation rules

- `name`: lowercase letters, numbers, underscores. Pattern: `^[a-z_][a-z0-9_]*$`
- `description`: up to 500 chars
- `enum` type **requires** `options` with at least 2 values

### Examples

```yaml
inputs:
  # Simple string
  - name: backup_dir
    type: string
    required: false
    default: "/var/backups"
    description: "Backup storage directory"

  # Number with threshold
  - name: max_failed_attempts
    type: number
    required: false
    default: 10
    description: "Max failed login attempts before alerting"

  # Boolean toggle
  - name: verify_backup
    type: boolean
    required: false
    default: true
    description: "Verify backup integrity after creation"

  # Multi-value list
  - name: log_sources
    type: string[]
    required: false
    default: ["/var/log/syslog", "/var/log/auth.log"]
    description: "Log files to scan"

  # Enum with fixed choices
  - name: compression
    type: enum
    required: true
    default: gzip
    options: [gzip, zstd, none]
    description: "Compression algorithm"
```

---

## Security Model

ServerPilot uses a 5-level risk classification system. Every command the AI tries to execute goes through `classifyCommand()`.

### Risk levels

| Level | Description | Example commands | Skill behavior |
|-------|-------------|-----------------|----------------|
| **green** | Read-only | `ls`, `cat`, `ps`, `df`, `uptime` | Auto-execute |
| **yellow** | Install / low-risk changes | `apt install`, `pip install` | Auto-execute (if declared) |
| **red** | Configuration changes | `systemctl restart`, `chmod`, `chown` | Execute if declared; consider `requires_confirmation: true` |
| **critical** | Dangerous operations | `rm -rf`, `fdisk`, `iptables` | Execute if declared; `requires_confirmation: true` strongly recommended |
| **forbidden** | Absolutely prohibited | Fork bombs, `mkfs` on system disk | **Always blocked** — cannot be overridden |

### How `risk_level_max` works

Your Skill declares the maximum risk level it needs:

```yaml
constraints:
  risk_level_max: green    # Can only run read-only commands
```

When the AI tries to execute a command:

1. `classifyCommand(command)` → determines the command's risk level
2. If risk level is `forbidden` → **always rejected**, regardless of Skill config
3. If risk level > `risk_level_max` → **rejected** with "insufficient permissions"
4. If `requires_confirmation` is true → pauses and asks the user
5. Otherwise → **executes** the command

### Choosing the right risk level

| Use case | Recommended level |
|----------|------------------|
| Monitoring, log analysis, health checks | `green` |
| Installing packages, updating software | `yellow` |
| Restarting services, modifying configs | `red` |
| Disk operations, firewall rules | `critical` |

**Principle of least privilege**: Always use the lowest level that covers your Skill's needs. A log auditor doesn't need `red` — `green` is sufficient.

### Install-time permissions review

When users install your Skill, the Dashboard shows a permissions summary listing requested tools, security level, and trigger configuration. Users must explicitly approve before installation.

---

## Prompt Engineering

The prompt is the heart of your Skill. It tells the AI **what to do**, **how to do it**, and **what to output**.

### Recommended structure

```yaml
prompt: |
  ## Role
  You are a [domain] expert responsible for [responsibility].

  ## Task
  [One sentence describing the goal.]

  ## Environment
  - Server: {{server.name}} ({{server.os}})
  - IP: {{server.ip}}
  - Last run: {{skill.last_run}}

  ## Steps
  1. First, [action]
  2. Then, [action]
  3. Based on results, [action]

  ## Constraints
  - Do not [dangerous action]
  - If [condition], use notify to alert
  - [Other boundaries]

  ## Output
  Return results as JSON:
  {
    "severity": "info | warning | critical",
    "summary": "one-line summary",
    "details": [...]
  }
```

### Best practices

**Be specific about the role and goal**

```yaml
# Good — clear role and specific goal
prompt: |
  ## Role
  You are a Linux security specialist focused on SSH hardening.

  ## Task
  Audit the SSH configuration on {{server.name}} and report any
  security weaknesses against CIS benchmarks.
```

```yaml
# Bad — vague, no clear direction
prompt: |
  Check if the server is secure.
```

**Guide, don't script**

Tell the AI *what* to achieve, not *exactly how*. The AI adapts to different OS versions and environments:

```yaml
# Good — lets AI adapt to the environment
prompt: |
  ## Steps
  1. Detect the init system (systemd vs sysvinit vs openrc)
  2. List all running services
  3. Identify services listening on public interfaces
```

```yaml
# Bad — hardcodes assumptions
prompt: |
  Run: systemctl list-units --type=service --state=running
  Run: ss -tlnp
```

**Define clear output format**

Structured output enables the Dashboard to display results and enables event chaining:

```yaml
prompt: |
  ## Output
  Return a JSON object:
  {
    "severity": "info | warning | critical",
    "summary": "one-line summary",
    "findings": [
      {
        "category": "auth | service | disk",
        "description": "what was found",
        "recommendation": "what to do about it"
      }
    ]
  }
```

**Set explicit boundaries**

Tell the AI what NOT to do, especially for higher risk levels:

```yaml
prompt: |
  ## Constraints
  - Do NOT restart any services — only analyze and report
  - Do NOT modify firewall rules — only list current rules
  - If a log file doesn't exist, skip it silently
  - Never output passwords, API keys, or other secrets in findings
```

**Use store for cross-run state**

For Skills that run repeatedly, use `store` to track changes between runs:

```yaml
prompt: |
  1. Read the previous port scan results from store
  2. Run a fresh port scan
  3. Compare and highlight any new or removed ports
  4. Save the current scan to store for next run comparison
```

**Use notify wisely**

Avoid notification fatigue — only alert on actionable findings:

```yaml
prompt: |
  ## Notification rules
  - severity=critical: Always notify (include specific threat details + remediation steps)
  - severity=warning: Notify (include summary)
  - severity=info: Do NOT notify (just store the report)
```

---

## Testing Your Skill

### 1. Validate the YAML schema

The `validateSkillManifest()` function from `@aiinstaller/shared` validates your `skill.yaml` against the schema. Validation happens automatically when the server loads your Skill.

Common validation errors:

| Error | Fix |
|-------|-----|
| `metadata.name: Must be lowercase letters, numbers, and hyphens` | Use only `a-z`, `0-9`, `-` |
| `metadata.version: Must be SemVer` | Use format `"1.0.0"` |
| `triggers: At least one trigger is required` | Add at least one trigger |
| `enum type requires options with at least 2 values` | Add `options` array with ≥ 2 entries |
| `prompt: String must contain at least 50 character(s)` | Write a more detailed prompt |

### 2. Test with manual trigger

Always include `- type: manual` in your triggers during development. This lets you run the Skill on demand without waiting for cron or events.

### 3. Start with green risk level

During development, use `risk_level_max: green` to limit to read-only commands. This prevents accidental damage while you iterate on the prompt. Increase the risk level only when your prompt is stable.

### 4. Check execution logs

After each run, check the execution history in the Dashboard (Skills → your skill → Executions) or via the API:

```
GET /api/v1/skills/:id/executions
GET /api/v1/skills/:id/executions/:executionId
```

The execution record includes: status, steps executed, duration, AI output, and any errors.

### 5. Iterate on the prompt

Prompt engineering is iterative. Common issues and fixes:

| Problem | Fix |
|---------|-----|
| AI runs too many commands | Add `max_steps` constraint; simplify the task scope |
| AI executes wrong commands | Be more specific in Steps section; add explicit constraints |
| Output format is inconsistent | Add a concrete JSON example in the Output section |
| AI ignores environment differences | Add "detect the OS and package manager first" to Steps |
| AI outputs sensitive data | Add "Never output passwords, keys, or secrets" to Constraints |

---

## Publishing

### Directory structure for community Skills

```
my-awesome-skill/
  skill.yaml           # Required
  README.md            # Recommended — explain purpose, configuration, examples
  LICENSE              # Recommended — open source license
  CHANGELOG.md         # Recommended — version history
```

### Naming conventions

- `metadata.name`: lowercase + digits + hyphens, 2–50 chars
- Valid: `log-auditor`, `ssl-checker`, `mysql-backup-v2`
- Invalid: `Log_Auditor`, `my skill`, `a`

### Versioning

Follow [SemVer](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes to inputs or prompt behavior
- **MINOR** (1.0.0 → 1.1.0): New features (new outputs, new trigger support)
- **PATCH** (1.0.0 → 1.0.1): Bug fixes, prompt improvements

### Installing from various sources

```bash
# From a Git repository
serverpilot skill install https://github.com/user/my-skill.git

# From a local directory
serverpilot skill install ./path/to/skill/

# Uninstall
serverpilot skill uninstall my-skill
```

---

## Examples

The `skills/official/` directory contains three production-ready Skills you can use as reference:

| Skill | Risk level | Tools | Triggers | Description |
|-------|-----------|-------|----------|-------------|
| [log-auditor](official/log-auditor/skill.yaml) | green | shell, read_file, notify, store | cron + event + manual | Daily log analysis with anomaly detection |
| [intrusion-detector](official/intrusion-detector/skill.yaml) | yellow | shell, read_file, notify, store | cron + event + threshold + manual | Security scanning every 30 min |
| [auto-backup](official/auto-backup/skill.yaml) | red | shell, read_file, notify, store | cron + manual | Nightly backup with verification |

These demonstrate increasing risk levels, different trigger combinations, and prompt patterns for various use cases. Read them to understand real-world Skill design.
