/**
 * Database Deployment Tests
 *
 * Tests for database selection, configuration, and deployment.
 * NOTE: These tests were originally written for MySQL deployment.
 * The project has migrated to SQLite for zero-configuration deployment.
 * These tests are skipped until they are updated for SQLite architecture.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

describe.skip('Database Deployment (Legacy MySQL - Skipped)', () => {
  const projectRoot = join(__dirname, '..');

  describe('Docker Compose Configuration', () => {
    it('should have docker-compose.yml file', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      expect(existsSync(dockerComposePath)).toBe(true);
    });

    it('should define MySQL service in docker-compose.yml', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      expect(dockerCompose.services).toBeDefined();
      expect(dockerCompose.services.mysql).toBeDefined();
    });

    it('should configure MySQL with correct image and version', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      expect(mysqlService.image).toMatch(/^mysql:8\./);
    });

    it('should configure MySQL with persistent volume', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      expect(mysqlService.volumes).toBeDefined();

      const hasPersistentVolume = mysqlService.volumes.some((vol: string) =>
        vol.includes('mysql-data:/var/lib/mysql')
      );
      expect(hasPersistentVolume).toBe(true);
    });

    it('should configure MySQL with initialization script', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      const hasInitScript = mysqlService.volumes.some((vol: string) =>
        vol.includes('init-db.sql') && vol.includes('/docker-entrypoint-initdb.d/')
      );
      expect(hasInitScript).toBe(true);
    });

    it('should configure MySQL environment variables', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      expect(mysqlService.environment).toBeDefined();

      const envVars = mysqlService.environment;
      const hasRootPassword = envVars.some((env: string) =>
        env.includes('MYSQL_ROOT_PASSWORD')
      );
      const hasDatabase = envVars.some((env: string) =>
        env.includes('MYSQL_DATABASE')
      );
      const hasUser = envVars.some((env: string) =>
        env.includes('MYSQL_USER')
      );
      const hasPassword = envVars.some((env: string) =>
        env.includes('MYSQL_PASSWORD')
      );

      expect(hasRootPassword).toBe(true);
      expect(hasDatabase).toBe(true);
      expect(hasUser).toBe(true);
      expect(hasPassword).toBe(true);
    });

    it('should configure MySQL with health check', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      expect(mysqlService.healthcheck).toBeDefined();
      expect(mysqlService.healthcheck.test).toBeDefined();
      expect(mysqlService.healthcheck.interval).toBeDefined();
    });

    it('should configure MySQL with UTF-8 character set', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      expect(mysqlService.command).toBeDefined();

      const commandStr = Array.isArray(mysqlService.command)
        ? mysqlService.command.join(' ')
        : mysqlService.command;

      expect(commandStr).toContain('utf8mb4');
    });

    it('should configure server service to depend on MySQL', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const serverService = dockerCompose.services.server;
      expect(serverService.depends_on).toBeDefined();
      expect(serverService.depends_on.mysql).toBeDefined();
      expect(serverService.depends_on.mysql.condition).toBe('service_healthy');
    });

    it('should configure server with database environment variables', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const serverService = dockerCompose.services.server;
      expect(serverService.environment).toBeDefined();

      const envVars = serverService.environment;
      const hasDbType = envVars.some((env: string) =>
        env.includes('DB_TYPE')
      );
      const hasDbHost = envVars.some((env: string) =>
        env.includes('DB_HOST')
      );
      const hasDbPort = envVars.some((env: string) =>
        env.includes('DB_PORT')
      );
      const hasDbName = envVars.some((env: string) =>
        env.includes('DB_NAME')
      );
      const hasDbUser = envVars.some((env: string) =>
        env.includes('DB_USER')
      );
      const hasDbPassword = envVars.some((env: string) =>
        env.includes('DB_PASSWORD')
      );

      expect(hasDbType).toBe(true);
      expect(hasDbHost).toBe(true);
      expect(hasDbPort).toBe(true);
      expect(hasDbName).toBe(true);
      expect(hasDbUser).toBe(true);
      expect(hasDbPassword).toBe(true);
    });

    it('should define mysql-data volume', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      expect(dockerCompose.volumes).toBeDefined();
      expect(dockerCompose.volumes['mysql-data']).toBeDefined();
    });

    it('should define aiinstaller-network', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      expect(dockerCompose.networks).toBeDefined();
      expect(dockerCompose.networks['aiinstaller-network']).toBeDefined();
    });

    it('should configure MySQL to use aiinstaller-network', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      expect(mysqlService.networks).toBeDefined();
      expect(mysqlService.networks).toContain('aiinstaller-network');
    });

    it('should configure server to use aiinstaller-network', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const serverService = dockerCompose.services.server;
      expect(serverService.networks).toBeDefined();
      expect(serverService.networks).toContain('aiinstaller-network');
    });
  });

  describe('Database Initialization Script', () => {
    it('should have init-db.sql file', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      expect(existsSync(initScriptPath)).toBe(true);
    });

    it('should create ai_device table', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('CREATE TABLE IF NOT EXISTS `ai_device`');
      expect(initScript).toContain('`device_id` VARCHAR');
      expect(initScript).toContain('`token` VARCHAR');
      expect(initScript).toContain('`platform` VARCHAR');
      expect(initScript).toContain('`quota_used` INT');
      expect(initScript).toContain('`quota_limit` INT');
    });

    it('should create ai_license table', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('CREATE TABLE IF NOT EXISTS `ai_license`');
      expect(initScript).toContain('`license_key` VARCHAR');
      expect(initScript).toContain('`plan` VARCHAR');
      expect(initScript).toContain('`max_devices` INT');
      expect(initScript).toContain('`expires_at` DATETIME');
    });

    it('should create ai_session table', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('CREATE TABLE IF NOT EXISTS `ai_session`');
      expect(initScript).toContain('`session_id` VARCHAR');
      expect(initScript).toContain('`device_id` VARCHAR');
      expect(initScript).toContain('`software` VARCHAR');
      expect(initScript).toContain('`status` VARCHAR');
      expect(initScript).toContain('`steps_total` INT');
      expect(initScript).toContain('`steps_completed` INT');
    });

    it('should create ai_call_log table', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('CREATE TABLE IF NOT EXISTS `ai_call_log`');
      expect(initScript).toContain('`session_id` VARCHAR');
      expect(initScript).toContain('`scene` VARCHAR');
      expect(initScript).toContain('`provider` VARCHAR');
      expect(initScript).toContain('`model` VARCHAR');
      expect(initScript).toContain('`input_tokens` INT');
      expect(initScript).toContain('`output_tokens` INT');
      expect(initScript).toContain('`cost_usd` DECIMAL');
    });

    it('should use utf8mb4 character set', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('utf8mb4');
      expect(initScript).toContain('utf8mb4_unicode_ci');
    });

    it('should create indexes for device_id', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      // ai_device should have unique index on device_id
      expect(initScript).toMatch(/UNIQUE KEY.*uk_device_id.*device_id/);
    });

    it('should create indexes for session tracking', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      // ai_session should have unique index on session_id
      expect(initScript).toMatch(/UNIQUE KEY.*uk_session_id.*session_id/);
    });

    it('should use InnoDB engine', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      const createTableStatements = initScript.match(/CREATE TABLE[^;]+;/gs) || [];
      expect(createTableStatements.length).toBeGreaterThan(0);

      createTableStatements.forEach(stmt => {
        expect(stmt).toContain('ENGINE=InnoDB');
      });
    });

    it('should have proper timestamps', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('created_at');
      expect(initScript).toContain('updated_at');
      expect(initScript).toContain('DEFAULT CURRENT_TIMESTAMP');
      expect(initScript).toContain('ON UPDATE CURRENT_TIMESTAMP');
    });

    it('should insert default test data', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      expect(initScript).toContain('INSERT INTO');
      expect(initScript).toContain('FREE-TEST-LICENSE');
    });
  });

  describe('Environment Configuration', () => {
    it('should have .env.example file', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      expect(existsSync(envExamplePath)).toBe(true);
    });

    it('should define database configuration in .env.example', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const envExample = readFileSync(envExamplePath, 'utf-8');

      expect(envExample).toContain('DB_TYPE');
      expect(envExample).toContain('DB_HOST');
      expect(envExample).toContain('DB_PORT');
      expect(envExample).toContain('DB_NAME');
      expect(envExample).toContain('DB_USER');
      expect(envExample).toContain('DB_PASSWORD');
    });

    it('should define MySQL-specific configuration in .env.example', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const envExample = readFileSync(envExamplePath, 'utf-8');

      expect(envExample).toContain('MYSQL_ROOT_PASSWORD');
      expect(envExample).toContain('MYSQL_DATABASE');
      expect(envExample).toContain('MYSQL_PORT');
    });

    it('should use secure default passwords in .env.example', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const envExample = readFileSync(envExamplePath, 'utf-8');

      // Passwords should not be simple like "password" or "123456"
      expect(envExample).not.toContain('DB_PASSWORD=password');
      expect(envExample).not.toContain('DB_PASSWORD=123456');
      expect(envExample).not.toContain('MYSQL_ROOT_PASSWORD=root');
    });

    it('should configure DB_HOST as "mysql" for Docker', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const envExample = readFileSync(envExamplePath, 'utf-8');

      expect(envExample).toMatch(/DB_HOST=mysql/);
    });

    it('should configure DB_PORT as 3306', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const envExample = readFileSync(envExamplePath, 'utf-8');

      expect(envExample).toMatch(/DB_PORT=3306/);
    });

    it('should configure DB_NAME as aiinstaller', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const envExample = readFileSync(envExamplePath, 'utf-8');

      expect(envExample).toMatch(/DB_NAME=aiinstaller/);
    });
  });

  describe('Database Schema Validation', () => {
    it('should have all required tables defined', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      const requiredTables = [
        'ai_device',
        'ai_license',
        'ai_session',
        'ai_call_log'
      ];

      requiredTables.forEach(table => {
        expect(initScript).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
      });
    });

    it('should define proper data types for token fields', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      // Tokens should be VARCHAR with sufficient length
      expect(initScript).toMatch(/`token`.*VARCHAR\(128\)/);
    });

    it('should define proper data types for cost tracking', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      // Cost should be DECIMAL for precise monetary calculations
      expect(initScript).toMatch(/`cost_usd`.*DECIMAL/);
    });

    it('should define proper data types for JSON fields', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      // env_info and install_plan should be JSON type
      expect(initScript).toMatch(/`env_info`.*JSON/);
      expect(initScript).toMatch(/`install_plan`.*JSON/);
    });

    it('should have comments on all tables', () => {
      const initScriptPath = join(projectRoot, 'scripts', 'init-db.sql');
      const initScript = readFileSync(initScriptPath, 'utf-8');

      const createTableStatements = initScript.match(/CREATE TABLE[^;]+;/gs) || [];
      expect(createTableStatements.length).toBeGreaterThan(0);

      createTableStatements.forEach(stmt => {
        expect(stmt).toMatch(/COMMENT='[^']+'/);
      });
    });
  });

  describe('Data Persistence', () => {
    it('should configure persistent volume for MySQL data', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      expect(dockerCompose.volumes).toBeDefined();
      expect(dockerCompose.volumes['mysql-data']).toBeDefined();
      expect(dockerCompose.volumes['mysql-data'].driver).toBe('local');
    });

    it('should mount data directory correctly', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      const dataVolume = mysqlService.volumes.find((vol: string) =>
        vol.includes('mysql-data') && vol.includes('/var/lib/mysql')
      );

      expect(dataVolume).toBeDefined();
      expect(dataVolume).toBe('mysql-data:/var/lib/mysql');
    });
  });

  describe('Database Security', () => {
    it('should not expose MySQL port to public by default', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      // Port should be configurable but defaults should be safe
      expect(mysqlService.ports).toBeDefined();

      // Check if port mapping uses environment variable
      const portMapping = mysqlService.ports[0];
      expect(portMapping).toContain('MYSQL_PORT');
    });

    it('should use environment variables for sensitive data', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      const envVars = mysqlService.environment;

      // All sensitive data should use environment variables
      envVars.forEach((env: string) => {
        if (env.includes('PASSWORD') || env.includes('USER')) {
          expect(env).toMatch(/\${[^}]+}/);
        }
      });
    });

    it('should use native password authentication', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const dockerComposeContent = readFileSync(dockerComposePath, 'utf-8');
      const dockerCompose = parseYaml(dockerComposeContent);

      const mysqlService = dockerCompose.services.mysql;
      const commandStr = Array.isArray(mysqlService.command)
        ? mysqlService.command.join(' ')
        : mysqlService.command;

      expect(commandStr).toContain('default-authentication-plugin=mysql_native_password');
    });
  });
});
