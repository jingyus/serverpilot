/**
 * Docker Compose EE (Enterprise Edition) Deployment Tests
 *
 * Validates docker-compose.ee.yml for multi-service EE deployment.
 * Ensures proper configuration for enterprise SaaS with PostgreSQL + Redis.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

describe('Docker Compose EE Deployment', () => {
  const projectRoot = join(__dirname, '..');
  const eeComposePath = join(projectRoot, 'docker-compose.ee.yml');

  describe('File Structure', () => {
    it('should have docker-compose.ee.yml file', () => {
      expect(existsSync(eeComposePath)).toBe(true);
    });

    it('should parse as valid YAML', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(() => parseYaml(content)).not.toThrow();
    });

    it('should define services section', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services).toBeDefined();
      expect(typeof config.services).toBe('object');
    });

    it('should have helpful comments explaining usage', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('Enterprise Edition');
      expect(content).toContain('Usage:');
      expect(content).toContain('docker compose -f docker-compose.ee.yml');
    });
  });

  describe('Multi-Service Architecture', () => {
    it('should define four services: postgres, redis, server, dashboard', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const serviceNames = Object.keys(config.services);
      expect(serviceNames).toContain('postgres');
      expect(serviceNames).toContain('redis');
      expect(serviceNames).toContain('server');
      expect(serviceNames).toContain('dashboard');
      expect(serviceNames).toHaveLength(4);
    });

    it('should define a Docker network for inter-service communication', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.networks).toBeDefined();
      const networkNames = Object.keys(config.networks);
      expect(networkNames.length).toBeGreaterThanOrEqual(1);
    });

    it('should assign all services to the same network', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const networkName = Object.keys(config.networks)[0];
      for (const [, service] of Object.entries(config.services)) {
        const svc = service as Record<string, unknown>;
        expect(svc.networks).toBeDefined();
        expect(svc.networks).toContain(networkName);
      }
    });

    it('should define named volumes for data persistence', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.volumes).toBeDefined();
      const volumeNames = Object.keys(config.volumes);
      expect(volumeNames.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('PostgreSQL Service', () => {
    it('should use postgres:16-alpine image', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const pg = config.services.postgres;
      expect(pg.image).toContain('postgres');
      expect(pg.image).toContain('16');
    });

    it('should configure POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.postgres.environment;
      expect(env.some(e => e.includes('POSTGRES_DB'))).toBe(true);
      expect(env.some(e => e.includes('POSTGRES_USER'))).toBe(true);
      expect(env.some(e => e.includes('POSTGRES_PASSWORD'))).toBe(true);
    });

    it('should require POSTGRES_PASSWORD (not allow empty default)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      // ?POSTGRES_PASSWORD means required, no default
      expect(content).toContain('POSTGRES_PASSWORD:?');
    });

    it('should have a healthcheck using pg_isready', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const hc = config.services.postgres.healthcheck;
      expect(hc).toBeDefined();
      const testCmd = Array.isArray(hc.test) ? hc.test.join(' ') : hc.test;
      expect(testCmd).toContain('pg_isready');
    });

    it('should persist data via named volume', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const volumes: string[] = config.services.postgres.volumes;
      expect(volumes).toBeDefined();
      expect(volumes.some(v => v.includes('postgres-data'))).toBe(true);
    });

    it('should expose port 5432 with configurable host port', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const ports: string[] = config.services.postgres.ports;
      expect(ports).toBeDefined();
      expect(ports.some(p => p.includes('5432'))).toBe(true);
    });
  });

  describe('Redis Service', () => {
    it('should use redis:7-alpine image', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const redis = config.services.redis;
      expect(redis.image).toContain('redis');
      expect(redis.image).toContain('7');
    });

    it('should have a healthcheck using redis-cli ping', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const hc = config.services.redis.healthcheck;
      expect(hc).toBeDefined();
      const testCmd = Array.isArray(hc.test) ? hc.test.join(' ') : hc.test;
      expect(testCmd).toContain('redis-cli');
      expect(testCmd).toContain('ping');
    });

    it('should persist data via named volume', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const volumes: string[] = config.services.redis.volumes;
      expect(volumes).toBeDefined();
      expect(volumes.some(v => v.includes('redis-data'))).toBe(true);
    });

    it('should configure maxmemory and eviction policy', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('maxmemory');
      expect(content).toContain('maxmemory-policy');
    });

    it('should enable AOF persistence', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('appendonly yes');
    });

    it('should expose port 6379 with configurable host port', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const ports: string[] = config.services.redis.ports;
      expect(ports).toBeDefined();
      expect(ports.some(p => p.includes('6379'))).toBe(true);
    });
  });

  describe('Server Service', () => {
    it('should depend on postgres and redis with service_healthy condition', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const deps = config.services.server.depends_on;
      expect(deps).toBeDefined();
      expect(deps.postgres).toEqual({ condition: 'service_healthy' });
      expect(deps.redis).toEqual({ condition: 'service_healthy' });
    });

    it('should set EDITION=ee', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      const editionVar = env.find((e: string) => e.startsWith('EDITION='));
      expect(editionVar).toBe('EDITION=ee');
    });

    it('should set CLOUD_MODE with configurable default', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      const cloudVar = env.find((e: string) => e.startsWith('CLOUD_MODE='));
      expect(cloudVar).toBeDefined();
      expect(cloudVar).toContain('CLOUD_MODE');
    });

    it('should set DB_TYPE=postgres', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      const dbTypeVar = env.find((e: string) => e.startsWith('DB_TYPE='));
      expect(dbTypeVar).toBe('DB_TYPE=postgres');
    });

    it('should configure DATABASE_URL pointing to postgres service', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      const dbUrl = env.find((e: string) => e.startsWith('DATABASE_URL='));
      expect(dbUrl).toBeDefined();
      expect(dbUrl).toContain('@postgres:');
      expect(dbUrl).toContain('5432');
    });

    it('should configure REDIS_URL pointing to redis service', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      const redisUrl = env.find((e: string) => e.startsWith('REDIS_URL='));
      expect(redisUrl).toBeDefined();
      expect(redisUrl).toContain('redis://redis:');
    });

    it('should require JWT_SECRET (not allow empty default)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('JWT_SECRET:?');
    });

    it('should set NODE_ENV=production', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      const nodeEnvVar = env.find((e: string) => e.startsWith('NODE_ENV='));
      expect(nodeEnvVar).toBe('NODE_ENV=production');
    });

    it('should include EE-specific environment variables', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      // GitHub OAuth
      expect(env.some(e => e.includes('GITHUB_OAUTH_CLIENT_ID'))).toBe(true);
      expect(env.some(e => e.includes('GITHUB_OAUTH_CLIENT_SECRET'))).toBe(true);
      expect(env.some(e => e.includes('GITHUB_OAUTH_REDIRECT_URI'))).toBe(true);
      // WebSocket config
      expect(env.some(e => e.includes('WS_HEARTBEAT_INTERVAL'))).toBe(true);
      expect(env.some(e => e.includes('WS_CONNECTION_TIMEOUT'))).toBe(true);
      expect(env.some(e => e.includes('WS_REQUIRE_AUTH'))).toBe(true);
      // SMTP
      expect(env.some(e => e.includes('SMTP_HOST'))).toBe(true);
    });

    it('should configure AI provider variables', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const env: string[] = config.services.server.environment;
      expect(env.some(e => e.includes('AI_PROVIDER'))).toBe(true);
      expect(env.some(e => e.includes('ANTHROPIC_API_KEY'))).toBe(true);
      expect(env.some(e => e.includes('OPENAI_API_KEY'))).toBe(true);
      expect(env.some(e => e.includes('DEEPSEEK_API_KEY'))).toBe(true);
    });

    it('should map port 3000 with configurable host port', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const ports: string[] = config.services.server.ports;
      expect(ports).toBeDefined();
      expect(ports.some(p => p.includes('3000'))).toBe(true);
    });

    it('should have healthcheck on /health endpoint', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const hc = config.services.server.healthcheck;
      expect(hc).toBeDefined();
      const testCmd = Array.isArray(hc.test) ? hc.test.join(' ') : hc.test;
      expect(testCmd).toContain('/health');
      expect(testCmd).toContain('localhost:3000');
    });

    it('should have longer start_period than CE (database init takes time)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const startPeriod = config.services.server.healthcheck.start_period;
      expect(startPeriod).toMatch(/\d+s/);
      const seconds = parseInt(startPeriod);
      expect(seconds).toBeGreaterThanOrEqual(40);
    });

    it('should have build section for local builds', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services.server.build;
      expect(build).toBeDefined();
      expect(build.context).toBe('.');
      expect(build.dockerfile).toBe('packages/server/Dockerfile');
    });

    it('should specify EE-tagged image', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const image = config.services.server.image;
      expect(image).toBeDefined();
      expect(image).toContain('serverpilot');
      expect(image).toContain('ee');
    });
  });

  describe('Dashboard Service', () => {
    it('should depend on server with service_healthy condition', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const deps = config.services.dashboard.depends_on;
      expect(deps).toBeDefined();
      expect(deps.server).toEqual({ condition: 'service_healthy' });
    });

    it('should map port 80 with configurable host port (default 3001)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const ports: string[] = config.services.dashboard.ports;
      expect(ports).toBeDefined();
      expect(ports.some(p => p.includes('80') && p.includes('3001'))).toBe(true);
    });

    it('should have healthcheck', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const hc = config.services.dashboard.healthcheck;
      expect(hc).toBeDefined();
      expect(hc.interval).toBeDefined();
      expect(hc.timeout).toBeDefined();
    });

    it('should have build section with dashboard Dockerfile', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services.dashboard.build;
      expect(build).toBeDefined();
      expect(build.dockerfile).toBe('packages/dashboard/Dockerfile');
    });

    it('should specify EE-tagged image', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const image = config.services.dashboard.image;
      expect(image).toBeDefined();
      expect(image).toContain('ee');
    });
  });

  describe('Build Arguments', () => {
    it('should pass EDITION=ee as build arg to server service', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services.server.build;
      expect(build.args).toBeDefined();
      expect(build.args.EDITION).toBe('ee');
    });

    it('should pass EDITION=ee as build arg to dashboard service', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const build = config.services.dashboard.build;
      expect(build.args).toBeDefined();
      expect(build.args.EDITION).toBe('ee');
    });

    it('should have consistent EDITION build arg and environment variable for server', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      const buildEdition = config.services.server.build.args.EDITION;
      const env: string[] = config.services.server.environment;
      const envEdition = env.find((e: string) => e.startsWith('EDITION='));
      expect(envEdition).toBe(`EDITION=${buildEdition}`);
    });
  });

  describe('Service Dependencies', () => {
    it('should have correct startup order: postgres+redis → server → dashboard', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);

      // postgres and redis have no depends_on
      expect(config.services.postgres.depends_on).toBeUndefined();
      expect(config.services.redis.depends_on).toBeUndefined();

      // server depends on postgres and redis
      const serverDeps = Object.keys(config.services.server.depends_on);
      expect(serverDeps).toContain('postgres');
      expect(serverDeps).toContain('redis');

      // dashboard depends on server
      const dashDeps = Object.keys(config.services.dashboard.depends_on);
      expect(dashDeps).toContain('server');
    });

    it('should use service_healthy condition for all dependencies', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);

      for (const dep of Object.values(config.services.server.depends_on)) {
        expect(dep).toEqual({ condition: 'service_healthy' });
      }
      for (const dep of Object.values(config.services.dashboard.depends_on)) {
        expect(dep).toEqual({ condition: 'service_healthy' });
      }
    });
  });

  describe('Container Configuration', () => {
    it('should set container_name with serverpilot-ee- prefix for all services', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      for (const [, service] of Object.entries(config.services)) {
        const svc = service as Record<string, unknown>;
        expect(svc.container_name).toBeDefined();
        expect(svc.container_name as string).toContain('serverpilot-ee-');
      }
    });

    it('should use unless-stopped restart policy for all services', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      for (const [, service] of Object.entries(config.services)) {
        const svc = service as Record<string, unknown>;
        expect(svc.restart).toBe('unless-stopped');
      }
    });

    it('should configure stop_grace_period for all services', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      for (const [, service] of Object.entries(config.services)) {
        const svc = service as Record<string, unknown>;
        expect(svc.stop_grace_period).toBeDefined();
        expect(svc.stop_grace_period as string).toMatch(/\d+s/);
      }
    });

    it('should configure JSON-file logging with rotation for all services', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      for (const [, service] of Object.entries(config.services)) {
        const svc = service as Record<string, unknown>;
        const logging = svc.logging as Record<string, unknown>;
        expect(logging).toBeDefined();
        expect(logging.driver).toBe('json-file');
        const options = logging.options as Record<string, string>;
        expect(options['max-size']).toBeDefined();
        expect(options['max-file']).toBeDefined();
      }
    });
  });

  describe('Security', () => {
    it('should not hardcode sensitive values', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).not.toContain('sk-ant-');
      expect(content).not.toContain('password123');
      expect(content).not.toContain('secret123');
    });

    it('should use ${} variable substitution for secrets', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('${JWT_SECRET');
      expect(content).toContain('${ANTHROPIC_API_KEY');
      expect(content).toContain('${POSTGRES_PASSWORD');
    });

    it('should require critical secrets (JWT_SECRET, POSTGRES_PASSWORD)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      // :? syntax means required, error if missing
      expect(content).toContain('JWT_SECRET:?');
      expect(content).toContain('POSTGRES_PASSWORD:?');
    });
  });

  describe('EE vs CE Differentiation', () => {
    it('should include PostgreSQL and Redis (not present in CE)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services.postgres).toBeDefined();
      expect(config.services.redis).toBeDefined();
    });

    it('should include separate dashboard service (CE is all-in-one)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.services.dashboard).toBeDefined();
    });

    it('should use Docker network (CE has no network)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.networks).toBeDefined();
    });

    it('should use named volumes (CE uses bind mount)', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      const config = parseYaml(content);
      expect(config.volumes).toBeDefined();
      const volumeNames = Object.keys(config.volumes);
      expect(volumeNames.length).toBeGreaterThanOrEqual(3);
    });

    it('should include SMTP configuration for email alerts', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('SMTP_HOST');
      expect(content).toContain('SMTP_PORT');
    });

    it('should include WebSocket configuration for remote agents', () => {
      const content = readFileSync(eeComposePath, 'utf-8');
      expect(content).toContain('WS_HEARTBEAT_INTERVAL');
      expect(content).toContain('WS_CONNECTION_TIMEOUT');
    });
  });
});
