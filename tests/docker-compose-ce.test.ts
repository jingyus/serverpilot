/**
 * Docker Compose CE (Community Edition) Deployment Tests
 *
 * Validates docker-compose.ce.yml for single-container CE deployment.
 * Ensures proper configuration for self-hosted, single-server use.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

describe('Server Dockerfile EDITION Support', () => {
  const projectRoot = join(__dirname, '..');
  const dockerfilePath = join(projectRoot, 'packages/server/Dockerfile');

  it('should have ARG EDITION with default value', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toMatch(/ARG EDITION=\w+/);
  });

  it('should have ENV EDITION referencing the ARG', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('ENV EDITION=${EDITION}');
  });

  it('should default EDITION ARG to ce', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('ARG EDITION=ce');
  });

  it('should place ARG/ENV in the runtime stage (after FROM runtime)', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    const runtimeIdx = content.indexOf('FROM node:22-alpine AS runtime');
    const argIdx = content.indexOf('ARG EDITION=ce');
    const envIdx = content.indexOf('ENV EDITION=${EDITION}');
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(argIdx).toBeGreaterThan(runtimeIdx);
    expect(envIdx).toBeGreaterThan(argIdx);
  });

  it('should have com.serverpilot.edition label', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('com.serverpilot.edition');
  });

  it('should have OCI image title label with edition', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('org.opencontainers.image.title');
  });
});

describe('Dashboard Dockerfile EDITION Support', () => {
  const projectRoot = join(__dirname, '..');
  const dockerfilePath = join(projectRoot, 'packages/dashboard/Dockerfile');

  it('should have ARG EDITION in the build stage', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    const buildIdx = content.indexOf('FROM node:22-alpine AS build');
    const firstArgIdx = content.indexOf('ARG EDITION=ce');
    expect(firstArgIdx).toBeGreaterThan(buildIdx);
  });

  it('should have ARG EDITION in the runtime stage', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    const runtimeIdx = content.indexOf('FROM nginx:alpine AS runtime');
    const afterRuntime = content.slice(runtimeIdx);
    expect(afterRuntime).toContain('ARG EDITION=ce');
    expect(afterRuntime).toContain('ENV EDITION=${EDITION}');
  });

  it('should set VITE_EDITION from EDITION build arg', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('VITE_EDITION=${EDITION}');
  });

  it('should have com.serverpilot.edition label', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('com.serverpilot.edition');
  });

  it('should have OCI image title label with edition', () => {
    const content = readFileSync(dockerfilePath, 'utf-8');
    expect(content).toContain('org.opencontainers.image.title');
  });
});

describe('Docker Compose CE Deployment', () => {
  const projectRoot = join(__dirname, '..');
  const ceComposePath = join(projectRoot, 'docker-compose.ce.yml');

  describe('File Structure', () => {
    it('should have docker-compose.ce.yml file', () => {
      expect(existsSync(ceComposePath)).toBe(true);
    });

    it('should parse as valid YAML', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      expect(() => parseYaml(content)).not.toThrow();
    });

    it('should define services section', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services).toBeDefined();
      expect(typeof config.services).toBe('object');
    });

    it('should have helpful comments explaining usage', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      expect(content).toContain('Community Edition');
      expect(content).toContain('Usage:');
      expect(content).toContain('docker compose -f docker-compose.ce.yml');
    });
  });

  describe('Service Architecture', () => {
    it('should define exactly "init-db" and "serverpilot" services', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const serviceNames = Object.keys(config.services);
      expect(serviceNames).toEqual(['init-db', 'serverpilot']);
    });

    it('should not include PostgreSQL, Redis, or other external dependencies', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const serviceNames = Object.keys(config.services);
      expect(serviceNames).not.toContain('postgres');
      expect(serviceNames).not.toContain('redis');
      expect(serviceNames).not.toContain('mysql');
    });

    it('should not define separate agent or dashboard services', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const serviceNames = Object.keys(config.services);
      expect(serviceNames).not.toContain('agent');
      expect(serviceNames).not.toContain('dashboard');
    });

    it('should not define any networks (single container, not needed)', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.networks).toBeUndefined();
    });

    it('should not define named volumes (uses bind mount)', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.volumes).toBeUndefined();
    });
  });

  describe('init-db Service', () => {
    it('should use the same image as the main service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services['init-db'].image).toBe(config.services.serverpilot.image);
    });

    it('should set restart to "no" (one-shot)', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services['init-db'].restart).toBe('no');
    });

    it('should have a custom command that initializes the database', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const initDb = config.services['init-db'];
      expect(initDb.command).toBeDefined();
      const commandStr = Array.isArray(initDb.command) ? initDb.command.join(' ') : String(initDb.command);
      expect(commandStr).toContain('initDatabase');
      expect(commandStr).toContain('createTables');
    });

    it('should mount the same data volume as the main service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const initDbVolumes = config.services['init-db'].volumes;
      expect(initDbVolumes).toBeDefined();
      expect(initDbVolumes).toContain('./data:/app/data');
    });

    it('should set DATABASE_PATH environment variable', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services['init-db'].environment;
      const dbPath = env.find((e: string) => e.startsWith('DATABASE_PATH='));
      expect(dbPath).toBe('DATABASE_PATH=/app/data/serverpilot.db');
    });

    it('should have container_name for easy identification', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services['init-db'].container_name).toBe('serverpilot-ce-init');
    });

    it('should have edition labels', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const labels = config.services['init-db'].labels;
      expect(labels).toBeDefined();
      expect(labels['com.serverpilot.edition']).toBe('ce');
      expect(labels['com.serverpilot.role']).toBe('init-db');
    });
  });

  describe('Service Dependencies', () => {
    it('should make serverpilot depend on init-db completing successfully', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const deps = config.services.serverpilot.depends_on;
      expect(deps).toBeDefined();
      expect(deps['init-db']).toBeDefined();
      expect(deps['init-db'].condition).toBe('service_completed_successfully');
    });
  });

  describe('Edition Environment Variables', () => {
    it('should set EDITION=ce', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env = config.services.serverpilot.environment;
      const editionVar = env.find((e: string) => e.startsWith('EDITION='));
      expect(editionVar).toBe('EDITION=ce');
    });

    it('should set CLOUD_MODE=false', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env = config.services.serverpilot.environment;
      const cloudVar = env.find((e: string) => e.startsWith('CLOUD_MODE='));
      expect(cloudVar).toBe('CLOUD_MODE=false');
    });

    it('should set NODE_ENV=production', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env = config.services.serverpilot.environment;
      const nodeEnvVar = env.find((e: string) => e.startsWith('NODE_ENV='));
      expect(nodeEnvVar).toBe('NODE_ENV=production');
    });
  });

  describe('Port Configuration', () => {
    it('should map port 3000 with configurable host port', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const ports = config.services.serverpilot.ports;
      expect(ports).toBeDefined();
      expect(ports.length).toBe(1);
      expect(ports[0]).toContain('3000');
      expect(ports[0]).toContain('SERVER_PORT');
    });
  });

  describe('Data Persistence', () => {
    it('should mount ./data to /app/data via bind mount', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const volumes = config.services.serverpilot.volumes;
      expect(volumes).toBeDefined();
      expect(volumes).toContain('./data:/app/data');
    });

    it('should configure DATABASE_PATH inside /app/data', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env = config.services.serverpilot.environment;
      const dbPath = env.find((e: string) => e.startsWith('DATABASE_PATH='));
      expect(dbPath).toBe('DATABASE_PATH=/app/data/serverpilot.db');
    });

    it('should configure KNOWLEDGE_BASE_DIR inside /app/data', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env = config.services.serverpilot.environment;
      const kbDir = env.find((e: string) => e.startsWith('KNOWLEDGE_BASE_DIR='));
      expect(kbDir).toBe('KNOWLEDGE_BASE_DIR=/app/data/knowledge-base');
    });

    it('should use consistent database path across init-db and main service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const initEnv: string[] = config.services['init-db'].environment;
      const mainEnv: string[] = config.services.serverpilot.environment;
      const initDbPath = initEnv.find((e: string) => e.startsWith('DATABASE_PATH='));
      const mainDbPath = mainEnv.find((e: string) => e.startsWith('DATABASE_PATH='));
      expect(initDbPath).toBe(mainDbPath);
    });
  });

  describe('Health Check', () => {
    it('should configure healthcheck with proper intervals', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const hc = config.services.serverpilot.healthcheck;
      expect(hc).toBeDefined();
      expect(hc.interval).toBeDefined();
      expect(hc.timeout).toBeDefined();
      expect(hc.retries).toBeDefined();
      expect(hc.start_period).toBeDefined();
    });

    it('should check /health endpoint', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const hc = config.services.serverpilot.healthcheck;
      const testCmd = Array.isArray(hc.test) ? hc.test.join(' ') : hc.test;
      expect(testCmd).toContain('/health');
      expect(testCmd).toContain('localhost:3000');
    });

    it('should have reasonable retry count (3-10)', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const retries = config.services.serverpilot.healthcheck.retries;
      expect(retries).toBeGreaterThanOrEqual(3);
      expect(retries).toBeLessThanOrEqual(10);
    });

    it('should have start_period for initial boot time', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const startPeriod = config.services.serverpilot.healthcheck.start_period;
      expect(startPeriod).toMatch(/\d+s/);
    });
  });

  describe('Container Configuration', () => {
    it('should set container_name to serverpilot-ce', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services.serverpilot.container_name).toBe('serverpilot-ce');
    });

    it('should use unless-stopped restart policy', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services.serverpilot.restart).toBe('unless-stopped');
    });

    it('should configure stop_grace_period', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services.serverpilot.stop_grace_period).toBeDefined();
      expect(config.services.serverpilot.stop_grace_period).toMatch(/\d+s/);
    });

    it('should configure JSON-file logging with rotation', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const logging = config.services.serverpilot.logging;
      expect(logging).toBeDefined();
      expect(logging.driver).toBe('json-file');
      expect(logging.options['max-size']).toBeDefined();
      expect(logging.options['max-file']).toBeDefined();
    });
  });

  describe('Labels', () => {
    it('should have edition label on the main service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const labels = config.services.serverpilot.labels;
      expect(labels).toBeDefined();
      expect(labels['com.serverpilot.edition']).toBe('ce');
    });

    it('should have role label on the main service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const labels = config.services.serverpilot.labels;
      expect(labels['com.serverpilot.role']).toBe('server');
    });

    it('should have description label on the main service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const labels = config.services.serverpilot.labels;
      expect(labels['com.serverpilot.description']).toBeDefined();
      expect(labels['com.serverpilot.description']).toContain('Community Edition');
    });

    it('should have consistent edition labels across all services', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      for (const [, service] of Object.entries(config.services)) {
        const svc = service as { labels?: Record<string, string> };
        expect(svc.labels).toBeDefined();
        expect(svc.labels!['com.serverpilot.edition']).toBe('ce');
      }
    });
  });

  describe('AI Provider Configuration', () => {
    it('should configure AI_PROVIDER with default', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env = config.services.serverpilot.environment;
      const aiProvider = env.find((e: string) => e.includes('AI_PROVIDER'));
      expect(aiProvider).toBeDefined();
      expect(aiProvider).toContain('claude');
    });

    it('should support multiple AI provider API keys', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.serverpilot.environment;
      expect(env.some(e => e.includes('ANTHROPIC_API_KEY'))).toBe(true);
      expect(env.some(e => e.includes('OPENAI_API_KEY'))).toBe(true);
      expect(env.some(e => e.includes('DEEPSEEK_API_KEY'))).toBe(true);
    });
  });

  describe('Security', () => {
    it('should not hardcode sensitive values', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      expect(content).not.toContain('sk-ant-');
      expect(content).not.toContain('password123');
      expect(content).not.toContain('secret123');
    });

    it('should use ${} variable substitution for secrets', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      expect(content).toContain('${JWT_SECRET');
      expect(content).toContain('${ANTHROPIC_API_KEY');
    });

    it('should not include EE-only environment variables', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      // CE should not have GitHub OAuth, multi-tenant configs
      expect(content).not.toContain('GITHUB_OAUTH_CLIENT_ID');
      expect(content).not.toContain('GITHUB_OAUTH_CLIENT_SECRET');
      expect(content).not.toContain('GITHUB_OAUTH_REDIRECT_URI');
    });
  });

  describe('Build Arguments', () => {
    it('should pass EDITION=ce as build arg to serverpilot service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services.serverpilot.build;
      expect(build.args).toBeDefined();
      expect(build.args.EDITION).toBe('ce');
    });

    it('should pass EDITION=ce as build arg to init-db service', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services['init-db'].build;
      expect(build.args).toBeDefined();
      expect(build.args.EDITION).toBe('ce');
    });

    it('should have consistent EDITION build arg and environment variable', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const buildEdition = config.services.serverpilot.build.args.EDITION;
      const env: string[] = config.services.serverpilot.environment;
      const envEdition = env.find((e: string) => e.startsWith('EDITION='));
      expect(envEdition).toBe(`EDITION=${buildEdition}`);
    });
  });

  describe('CE vs EE Differentiation', () => {
    it('should not include WebSocket config (agent co-located, no remote agents)', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.serverpilot.environment;
      expect(env.some(e => e.includes('WS_HEARTBEAT_INTERVAL'))).toBe(false);
      expect(env.some(e => e.includes('WS_CONNECTION_TIMEOUT'))).toBe(false);
      expect(env.some(e => e.includes('WS_REQUIRE_AUTH'))).toBe(false);
    });

    it('should have build section for local builds', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services.serverpilot.build;
      expect(build).toBeDefined();
      expect(build.context).toBe('.');
      expect(build.dockerfile).toBe('packages/server/Dockerfile');
    });

    it('should also specify image for pre-built usage', () => {
      const content = readFileSync(ceComposePath, 'utf-8');
      const config = parseYaml(content);
      const image = config.services.serverpilot.image;
      expect(image).toBeDefined();
      expect(image).toContain('serverpilot');
      expect(image).toContain('ce');
    });
  });
});
