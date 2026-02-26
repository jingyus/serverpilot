/**
 * Docker Compose Production Deployment Tests
 *
 * Tests specifically for production deployment configuration validation.
 * Ensures Docker Compose is properly configured for production use.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

describe('Docker Compose Production Deployment', () => {
  const projectRoot = join(__dirname, '..');
  const dockerComposePath = join(projectRoot, 'docker-compose.yml');

  describe('Production Configuration', () => {
    it('should have docker-compose.yml file', () => {
      expect(existsSync(dockerComposePath)).toBe(true);
    });

    it('should parse as valid YAML', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      expect(() => parseYaml(content)).not.toThrow();
    });

    it('should define services section', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services).toBeDefined();
      expect(typeof config.services).toBe('object');
    });
  });

  describe('Service Restart Policies', () => {
    it.skip('should configure MySQL with restart: unless-stopped (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.mysql).toBeDefined();
      expect(config.services.mysql.restart).toBe('unless-stopped');
    });

    it('should configure server with restart: unless-stopped', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.server).toBeDefined();
      expect(config.services.server.restart).toBe('unless-stopped');
    });

    it('should not use "always" restart policy', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // "unless-stopped" is preferred over "always" for production
      // as it respects manual stops
      Object.values(config.services as Record<string, any>).forEach(service => {
        expect(service.restart).not.toBe('always');
      });
    });
  });

  describe('Health Checks', () => {
    it.skip('should configure MySQL (Legacy MySQL test) health check with proper intervals', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const mysqlHealthCheck = config.services.mysql.healthcheck;
      expect(mysqlHealthCheck).toBeDefined();
      expect(mysqlHealthCheck.interval).toBeDefined();
      expect(mysqlHealthCheck.timeout).toBeDefined();
      expect(mysqlHealthCheck.retries).toBeDefined();
      expect(mysqlHealthCheck.start_period).toBeDefined();
    });

    it('should configure server health check with proper intervals', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const serverHealthCheck = config.services.server.healthcheck;
      expect(serverHealthCheck).toBeDefined();
      expect(serverHealthCheck.interval).toBeDefined();
      expect(serverHealthCheck.timeout).toBeDefined();
      expect(serverHealthCheck.retries).toBeDefined();
      expect(serverHealthCheck.start_period).toBeDefined();
    });

    it.skip('should configure MySQL (Legacy MySQL test) health check with reasonable retry count', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const retries = config.services.mysql.healthcheck.retries;
      expect(retries).toBeGreaterThanOrEqual(3);
      expect(retries).toBeLessThanOrEqual(10);
    });

    it('should configure server health check with reasonable retry count', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const retries = config.services.server.healthcheck.retries;
      expect(retries).toBeGreaterThanOrEqual(3);
      expect(retries).toBeLessThanOrEqual(10);
    });

    it('should configure dashboard health check', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const dashboardHealthCheck = config.services.dashboard.healthcheck;
      expect(dashboardHealthCheck).toBeDefined();
      expect(dashboardHealthCheck.interval).toBeDefined();
      expect(dashboardHealthCheck.timeout).toBeDefined();
      expect(dashboardHealthCheck.retries).toBeDefined();
    });
  });

  describe('Service Dependencies', () => {
    it('should configure dashboard to depend on server being healthy', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.dashboard.depends_on).toBeDefined();
      expect(config.services.dashboard.depends_on.server).toBeDefined();
      expect(config.services.dashboard.depends_on.server.condition).toBe('service_healthy');
    });
  });

  describe('Environment Configuration', () => {
    it('should set NODE_ENV=production for server', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const serverEnv = config.services.server.environment;
      expect(serverEnv).toBeDefined();

      const nodeEnv = serverEnv.find((env: string) =>
        env.includes('NODE_ENV=production')
      );
      expect(nodeEnv).toBeDefined();
    });

    it('should configure AI_PROVIDER with default', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const serverEnv = config.services.server.environment;
      const aiProvider = serverEnv.find((env: string) =>
        env.includes('AI_PROVIDER')
      );
      expect(aiProvider).toBeDefined();
    });

    it.skip('should configure server with database connection variables (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const serverEnv = config.services.server.environment;

      const requiredEnvVars = [
        'DB_TYPE',
        'DB_HOST',
        'DB_PORT',
        'DB_NAME',
        'DB_USER',
        'DB_PASSWORD'
      ];

      requiredEnvVars.forEach(varName => {
        const hasVar = serverEnv.some((env: string) => env.includes(varName));
        expect(hasVar).toBe(true);
      });
    });

    it.skip('should configure MySQL (Legacy MySQL test) with required environment variables', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const mysqlEnv = config.services.mysql.environment;

      const requiredEnvVars = [
        'MYSQL_ROOT_PASSWORD',
        'MYSQL_DATABASE',
        'MYSQL_USER',
        'MYSQL_PASSWORD'
      ];

      requiredEnvVars.forEach(varName => {
        const hasVar = mysqlEnv.some((env: string) => env.includes(varName));
        expect(hasVar).toBe(true);
      });
    });

    it.skip('should use environment variables for sensitive data (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Check MySQL environment
      const mysqlEnv = config.services.mysql.environment;
      mysqlEnv.forEach((env: string) => {
        if (env.includes('PASSWORD')) {
          // Should use ${VAR:-default} syntax
          expect(env).toMatch(/\${.*}/);
        }
      });
    });
  });

  describe('Network Configuration', () => {
    it('should define custom network', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.networks).toBeDefined();
      expect(config.networks['serverpilot-network']).toBeDefined();
    });

    it('should configure all services on the same network', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Check that server and dashboard are on the same network
      expect(config.services.server.networks).toContain('serverpilot-network');
      expect(config.services.dashboard.networks).toContain('serverpilot-network');
    });

    it('should use bridge driver for network', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.networks['serverpilot-network'].driver).toBe('bridge');
    });
  });

  describe('Volume Configuration', () => {
    it.skip('should define persistent volumes (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.volumes).toBeDefined();
      expect(config.volumes['mysql-data']).toBeDefined();
      expect(config.volumes['knowledge-base']).toBeDefined();
    });

    it.skip('should use local driver for volumes (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.volumes['mysql-data'].driver).toBe('local');
      expect(config.volumes['knowledge-base'].driver).toBe('local');
    });

    it.skip('should mount MySQL (Legacy MySQL test) data to persistent volume', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const mysqlVolumes = config.services.mysql.volumes;
      const hasDataVolume = mysqlVolumes.some((vol: string) =>
        vol.includes('mysql-data:/var/lib/mysql')
      );
      expect(hasDataVolume).toBe(true);
    });

    it('should mount server-data volume for SQLite persistence', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const serverVolumes = config.services.server.volumes;
      const hasDataVolume = serverVolumes.some((vol: string) =>
        vol.includes('server-data:/data')
      );
      expect(hasDataVolume).toBe(true);
    });
  });

  describe('Port Configuration', () => {
    it('should expose server port for agent WebSocket connections', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Server port is exposed for agent WebSocket connections (ws://host:3000)
      // Dashboard (Nginx) also reverse proxies API/WS for browser access
      expect(config.services.server.ports).toBeDefined();
      const portMapping = config.services.server.ports[0];
      expect(portMapping).toContain('3000');
    });

    it('should expose dashboard port with DASHBOARD_PORT environment variable', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.dashboard.ports).toBeDefined();
      expect(config.services.dashboard.ports.length).toBeGreaterThan(0);
      const portMapping = config.services.dashboard.ports[0];
      expect(portMapping).toContain('DASHBOARD_PORT');
      expect(portMapping).toContain('80');
    });

    it.skip('should expose MySQL (Legacy MySQL test) port for development', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.mysql.ports).toBeDefined();
      const portMapping = config.services.mysql.ports[0];
      expect(portMapping).toContain('MYSQL_PORT');
      expect(portMapping).toContain('3306');
    });
  });

  describe('Container Configuration', () => {
    it('should set container names for easy identification', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Check server and dashboard container names
      expect(config.services.server.container_name).toBe('serverpilot-server');
      expect(config.services.dashboard.container_name).toBe('serverpilot-dashboard');
    });

    it.skip('should configure MySQL (Legacy MySQL test) with proper timezone', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const mysqlEnv = config.services.mysql.environment;
      const hasTZ = mysqlEnv.some((env: string) => env.includes('TZ='));
      expect(hasTZ).toBe(true);
    });
  });

  describe.skip('MySQL Optimization (Legacy MySQL tests)', () => {
    it('should configure innodb_buffer_pool_size', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const command = config.services.mysql.command;
      const commandStr = Array.isArray(command) ? command.join(' ') : command;

      expect(commandStr).toContain('innodb_buffer_pool_size');
    });

    it('should configure max_connections', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const command = config.services.mysql.command;
      const commandStr = Array.isArray(command) ? command.join(' ') : command;

      expect(commandStr).toContain('max_connections');
    });

    it('should configure character set to utf8mb4', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const command = config.services.mysql.command;
      const commandStr = Array.isArray(command) ? command.join(' ') : command;

      expect(commandStr).toContain('character-set-server=utf8mb4');
      expect(commandStr).toContain('collation-server=utf8mb4_unicode_ci');
    });
  });

  describe('Image Configuration', () => {
    it('should use pre-built images (no build section)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.server.build).toBeUndefined();
      expect(config.services.server.image).toBe('ghcr.io/jingyus/serverpilot/server:latest');
    });

    it('should use pre-built dashboard image', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.dashboard.build).toBeUndefined();
      expect(config.services.dashboard.image).toBe('ghcr.io/jingyus/serverpilot/dashboard:latest');
    });

    it.skip('should use MySQL official image (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.mysql.image).toMatch(/^mysql:8\./);
    });
  });

  describe('Build Override File', () => {
    const buildOverridePath = join(projectRoot, 'docker-compose.build.yml');

    it('should have docker-compose.build.yml file', () => {
      expect(existsSync(buildOverridePath)).toBe(true);
    });

    it('should configure server build context in override', () => {
      const content = readFileSync(buildOverridePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.server.build).toBeDefined();
      expect(config.services.server.build.context).toBe('.');
      expect(config.services.server.build.dockerfile).toBe('packages/server/Dockerfile');
    });

    it('should configure agent build context in override', () => {
      const content = readFileSync(buildOverridePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.agent.build).toBeDefined();
      expect(config.services.agent.build.context).toBe('.');
      expect(config.services.agent.build.dockerfile).toBe('packages/agent/Dockerfile');
    });

    it('should configure dashboard build context in override', () => {
      const content = readFileSync(buildOverridePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.dashboard.build).toBeDefined();
      expect(config.services.dashboard.build.context).toBe('.');
      expect(config.services.dashboard.build.dockerfile).toBe('packages/dashboard/Dockerfile');
    });
  });

  describe('Documentation', () => {
    it('should have helpful comments in docker-compose.yml', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');

      // File should have comments explaining usage
      expect(content).toContain('#');
      expect(content).toContain('Usage:');
    });

    it('should use environment variable substitution syntax', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');

      // Docker Compose auto-loads .env file; variables are referenced via ${VAR:-default} syntax
      expect(content).toContain('${');
    });
  });

  describe('Deployment Readiness', () => {
    it('should have all required files present', () => {
      const requiredFiles = [
        'docker-compose.yml',
        'docker-compose.build.yml',
        '.env.example',
        'packages/server/Dockerfile',
        'packages/agent/Dockerfile',
        'packages/dashboard/Dockerfile',
        'packages/dashboard/nginx.conf',
        '.dockerignore',
        'init.sh',
        'scripts/verify-deployment.sh',
        'scripts/smoke-test.sh'
      ];

      requiredFiles.forEach(file => {
        const filePath = join(projectRoot, file);
        expect(existsSync(filePath)).toBe(true);
      });
    });
  });

  describe('Production Best Practices', () => {
    it('should not hardcode sensitive values in docker-compose.yml', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');

      // Should not contain actual API keys or passwords
      expect(content).not.toContain('sk-ant-');
      expect(content).not.toContain('password123');
      expect(content).not.toContain('secret123');
    });

    it.skip('should provide default values for environment variables (Legacy MySQL test)', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const mysqlEnv = config.services.mysql.environment;

      // Environment variables should have defaults using ${VAR:-default}
      mysqlEnv.forEach((env: string) => {
        if (env.includes('${')) {
          expect(env).toContain(':-');
        }
      });
    });

    it('should configure JSON-file logging with rotation', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Server logging
      expect(config.services.server.logging).toBeDefined();
      expect(config.services.server.logging.driver).toBe('json-file');
      expect(config.services.server.logging.options['max-size']).toBeDefined();
      expect(config.services.server.logging.options['max-file']).toBeDefined();

      // Dashboard logging
      expect(config.services.dashboard.logging).toBeDefined();
      expect(config.services.dashboard.logging.driver).toBe('json-file');
    });
  });

  describe('Graceful Shutdown', () => {
    it('should configure stop_grace_period for server', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.server.stop_grace_period).toBeDefined();
      expect(config.services.server.stop_grace_period).toMatch(/\d+s/);
    });

    it('should configure stop_grace_period for dashboard', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      expect(config.services.dashboard.stop_grace_period).toBeDefined();
      expect(config.services.dashboard.stop_grace_period).toMatch(/\d+s/);
    });
  });

  describe('Service Startup Order', () => {
    it('should ensure dashboard starts after server is healthy', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Dashboard depends on server with health condition
      const dashboardDeps = config.services.dashboard.depends_on;
      expect(dashboardDeps.server).toBeDefined();
      expect(dashboardDeps.server.condition).toBe('service_healthy');
    });

    it('should have server healthcheck start_period configured', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      const serverHealthCheck = config.services.server.healthcheck;
      expect(serverHealthCheck.start_period).toBeDefined();

      // Parse the start_period value (e.g., "15s")
      const startPeriod = serverHealthCheck.start_period;
      expect(startPeriod).toMatch(/\d+s/);
    });
  });

  describe('Resource Management', () => {
    it('should configure SQLite database persistence', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Server should have DATABASE_PATH environment variable
      const serverEnv = config.services.server.environment;
      const dbPath = Array.isArray(serverEnv)
        ? serverEnv.find((e: string) => e.startsWith('DATABASE_PATH='))
        : serverEnv.DATABASE_PATH;

      expect(dbPath).toBeDefined();
      expect(dbPath).toContain('/data/serverpilot.db');
    });

    it('should configure data volume for SQLite persistence', () => {
      const content = readFileSync(dockerComposePath, 'utf-8');
      const config = parseYaml(content);

      // Should have server-data volume defined
      expect(config.volumes['server-data']).toBeDefined();

      // Server should mount the data volume
      const serverVolumes = config.services.server.volumes;
      expect(serverVolumes).toContain('server-data:/data');
    });
  });
});
