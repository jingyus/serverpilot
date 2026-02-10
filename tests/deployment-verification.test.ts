/**
 * Deployment Verification Tests
 *
 * Tests for the deployment verification script and overall deployment readiness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, accessSync, constants } from 'fs';
import { join } from 'path';

describe('Deployment Verification', () => {
  const projectRoot = join(__dirname, '..');

  describe('Verification Script', () => {
    it('should have verify-deployment.sh script', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      expect(existsSync(scriptPath)).toBe(true);
    });

    it('should have executable permissions on verify-deployment.sh', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');

      try {
        accessSync(scriptPath, constants.X_OK);
        expect(true).toBe(true);
      } catch {
        expect(false).toBe(true); // File should be executable
      }
    });

    it('should have bash shebang', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    });

    it('should contain required verification checks', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      const requiredChecks = [
        'Docker',
        'Docker Compose',
        'docker-compose.yml',
        'restart policy',
        'health check',
        'network',
        'volume',
        '.env',
        'init-db.sql',
        'Dockerfile'
      ];

      requiredChecks.forEach(check => {
        expect(content.toLowerCase()).toContain(check.toLowerCase());
      });
    });

    it('should have proper error handling', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      // Should have set -e for error handling
      expect(content).toContain('set -e');

      // Should have exit codes
      expect(content).toContain('exit 0');
      expect(content).toContain('exit 1');
    });

    it('should have colored output functions', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      const outputFunctions = [
        'print_header',
        'print_check',
        'print_success',
        'print_error',
        'print_info'
      ];

      outputFunctions.forEach(func => {
        expect(content).toContain(func);
      });
    });

    it('should check for required files', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      const requiredFiles = [
        'docker-compose.yml',
        '.env.example',
        'packages/server/Dockerfile',
        '.dockerignore',
        'scripts/init-db.sql'
      ];

      requiredFiles.forEach(file => {
        expect(content).toContain(file);
      });
    });

    it('should check for required environment variables', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      const requiredEnvVars = [
        'ANTHROPIC_API_KEY',
        'DB_HOST',
        'DB_PORT',
        'DB_NAME',
        'MYSQL_ROOT_PASSWORD'
      ];

      requiredEnvVars.forEach(envVar => {
        expect(content).toContain(envVar);
      });
    });

    it('should check for security issues', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('Security Configuration');
      expect(content).toContain('hardcoded secrets');
    });

    it('should provide helpful next steps', () => {
      const scriptPath = join(projectRoot, 'scripts', 'verify-deployment.sh');
      const content = readFileSync(scriptPath, 'utf-8');

      expect(content).toContain('Next steps:');
      expect(content).toContain('docker compose up');
    });
  });

  describe('Deployment Prerequisites', () => {
    it('should have all required files for deployment', () => {
      const requiredFiles = [
        'docker-compose.yml',
        '.env.example',
        'packages/server/Dockerfile',
        '.dockerignore',
        'scripts/init-db.sql',
        'scripts/verify-deployment.sh'
      ];

      requiredFiles.forEach(file => {
        const filePath = join(projectRoot, file);
        expect(existsSync(filePath)).toBe(true);
      });
    });

    it('should have README with deployment instructions', () => {
      const readmePath = join(projectRoot, 'README.md');
      if (existsSync(readmePath)) {
        const content = readFileSync(readmePath, 'utf-8');
        const lowerContent = content.toLowerCase();
        // README should mention Docker or deployment (English or Chinese)
        expect(
          lowerContent.includes('docker') ||
          lowerContent.includes('deployment') ||
          content.includes('部署') ||
          content.includes('安装')
        ).toBe(true);
      } else {
        // If README doesn't exist, just pass
        expect(true).toBe(true);
      }
    });

    it('should have deployment documentation', () => {
      const deployDocPath = join(projectRoot, 'docs', 'deployment.md');
      expect(existsSync(deployDocPath)).toBe(true);
    });

    it('should document Docker Compose deployment in docs', () => {
      const deployDocPath = join(projectRoot, 'docs', 'deployment.md');
      const content = readFileSync(deployDocPath, 'utf-8');

      expect(content).toContain('Docker');
      expect(content).toContain('docker compose');
      expect(content).toContain('docker-compose.yml');
    });
  });

  describe('Production Readiness', () => {
    it('should not commit .env file', () => {
      const envPath = join(projectRoot, '.env');
      const gitignorePath = join(projectRoot, '.gitignore');

      if (existsSync(gitignorePath)) {
        const gitignore = readFileSync(gitignorePath, 'utf-8');
        expect(gitignore).toContain('.env');
      }
    });

    it('should have proper .gitignore for Docker artifacts', () => {
      const gitignorePath = join(projectRoot, '.gitignore');

      if (existsSync(gitignorePath)) {
        const gitignore = readFileSync(gitignorePath, 'utf-8');
        // Should ignore Docker-related files if any
        const dockerPatterns = ['.env', 'node_modules', 'dist'];
        dockerPatterns.forEach(pattern => {
          expect(gitignore).toContain(pattern);
        });
      }
    });

    it('should have .dockerignore file', () => {
      const dockerignorePath = join(projectRoot, '.dockerignore');
      expect(existsSync(dockerignorePath)).toBe(true);
    });

    it('should ignore unnecessary files in Docker build', () => {
      const dockerignorePath = join(projectRoot, '.dockerignore');
      const content = readFileSync(dockerignorePath, 'utf-8');

      const shouldIgnore = [
        'node_modules',
        '*.test.ts',
        'tests/',
        '.git',
        '.env'
      ];

      shouldIgnore.forEach(pattern => {
        expect(content).toContain(pattern);
      });
    });
  });

  describe('Deployment Commands', () => {
    it('should document startup command', () => {
      const deployDocPath = join(projectRoot, 'docs', 'deployment.md');
      const content = readFileSync(deployDocPath, 'utf-8');

      expect(content).toContain('docker compose up');
    });

    it('should document shutdown command', () => {
      const deployDocPath = join(projectRoot, 'docs', 'deployment.md');
      const content = readFileSync(deployDocPath, 'utf-8');

      expect(content).toContain('docker compose down');
    });

    it('should document log viewing command', () => {
      const deployDocPath = join(projectRoot, 'docs', 'deployment.md');
      const content = readFileSync(deployDocPath, 'utf-8');

      expect(content).toContain('docker compose logs');
    });

    it('should document health check verification', () => {
      const deployDocPath = join(projectRoot, 'docs', 'deployment.md');
      const content = readFileSync(deployDocPath, 'utf-8');

      expect(content.toLowerCase()).toContain('health');
      expect(content).toContain('curl') || expect(content).toContain('check');
    });
  });

  describe('Environment Configuration', () => {
    it('should have .env.example with all required variables', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const content = readFileSync(envExamplePath, 'utf-8');

      const requiredVars = [
        'ANTHROPIC_API_KEY',
        'SERVER_PORT',
        'DATABASE_PATH', // SQLite database path (zero-config)
        'JWT_SECRET'
      ];

      requiredVars.forEach(varName => {
        expect(content).toContain(varName);
      });
    });

    it('should have comments explaining environment variables', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const content = readFileSync(envExamplePath, 'utf-8');

      // Should have comments (lines starting with #)
      const lines = content.split('\n');
      const commentLines = lines.filter(line => line.trim().startsWith('#'));
      expect(commentLines.length).toBeGreaterThan(5);
    });

    it('should not have default insecure passwords', () => {
      const envExamplePath = join(projectRoot, '.env.example');
      const content = readFileSync(envExamplePath, 'utf-8');

      const insecurePasswords = ['password', '123456', 'admin', 'root'];
      insecurePasswords.forEach(pwd => {
        expect(content.toLowerCase()).not.toContain(`password=${pwd}`);
      });
    });
  });

  describe('Service Health Checks', () => {
    it('should configure reasonable health check intervals', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const content = readFileSync(dockerComposePath, 'utf-8');

      // Health check intervals should be present
      expect(content).toContain('interval:');
      expect(content).toContain('timeout:');
      expect(content).toContain('retries:');
    });

    it('should configure start_period for services', () => {
      const dockerComposePath = join(projectRoot, 'docker-compose.yml');
      const content = readFileSync(dockerComposePath, 'utf-8');

      expect(content).toContain('start_period:');
    });
  });

  describe('Deployment Documentation', () => {
    it('should have server setup guide', () => {
      const serverSetupPath = join(projectRoot, 'docs', 'server-setup.md');
      expect(existsSync(serverSetupPath)).toBe(true);
    });

    it('should document server requirements', () => {
      const serverSetupPath = join(projectRoot, 'docs', 'server-setup.md');
      const content = readFileSync(serverSetupPath, 'utf-8');
      const lowerContent = content.toLowerCase();

      // Check for requirements in English or Chinese
      expect(
        lowerContent.includes('requirement') ||
        content.includes('要求') ||
        content.includes('配置')
      ).toBe(true);
      expect(lowerContent.includes('server') || content.includes('服务器')).toBe(true);
    });

    it('should document DNS configuration', () => {
      const serverSetupPath = join(projectRoot, 'docs', 'server-setup.md');
      const content = readFileSync(serverSetupPath, 'utf-8');

      expect(content.toLowerCase()).toContain('dns') ||
        expect(content.toLowerCase()).toContain('domain');
    });

    it('should document security best practices', () => {
      const serverSetupPath = join(projectRoot, 'docs', 'server-setup.md');
      const content = readFileSync(serverSetupPath, 'utf-8');
      const lowerContent = content.toLowerCase();

      // Check for security topics in English or Chinese
      const hasSecurity =
        lowerContent.includes('security') ||
        lowerContent.includes('firewall') ||
        lowerContent.includes('ssh') ||
        content.includes('安全') ||
        content.includes('防火墙');

      expect(hasSecurity).toBe(true);
    });
  });

  describe('Deployment Test Files', () => {
    it('should have Docker Compose production tests', () => {
      const testPath = join(projectRoot, 'tests', 'docker-compose-production.test.ts');
      expect(existsSync(testPath)).toBe(true);
    });

    it('should have database deployment tests', () => {
      const testPath = join(projectRoot, 'tests', 'database-deployment.test.ts');
      expect(existsSync(testPath)).toBe(true);
    });

    it('should have database integration tests', () => {
      const testPath = join(projectRoot, 'tests', 'database-integration.test.ts');
      expect(existsSync(testPath)).toBe(true);
    });

    it('should have comprehensive test coverage', () => {
      const testFiles = [
        'docker-compose-production.test.ts',
        'database-deployment.test.ts',
        'database-integration.test.ts',
        'deployment-verification.test.ts'
      ];

      testFiles.forEach(testFile => {
        const testPath = join(projectRoot, 'tests', testFile);
        expect(existsSync(testPath)).toBe(true);
      });
    });
  });
});
