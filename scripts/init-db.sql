-- ==============================================================================
-- AI Installer Database Initialization Script
-- ==============================================================================
-- Purpose: Initialize database schema for AI Installer
-- Database: MySQL 8.0+
-- Created: 2026-02-07
-- ==============================================================================

-- Set character set and collation
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- Use aiinstaller database
USE aiinstaller;

-- ==============================================================================
-- Table: ai_device
-- Description: Device registration and management
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `ai_device` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `device_id` VARCHAR(64) NOT NULL COMMENT 'Device fingerprint hash (unique)',
  `token` VARCHAR(128) NOT NULL COMMENT 'Device authentication token',
  `platform` VARCHAR(32) NOT NULL COMMENT 'Platform: darwin/linux/win32',
  `os_version` VARCHAR(64) DEFAULT NULL COMMENT 'OS version',
  `architecture` VARCHAR(32) DEFAULT NULL COMMENT 'CPU architecture: x64/arm64',
  `hostname` VARCHAR(128) DEFAULT NULL COMMENT 'Device hostname',
  `quota_used` INT UNSIGNED DEFAULT 0 COMMENT 'AI calls used this month',
  `quota_limit` INT UNSIGNED DEFAULT 5 COMMENT 'Monthly AI call limit (default: 5)',
  `plan` VARCHAR(32) DEFAULT 'free' COMMENT 'Plan type: free/pro/enterprise',
  `banned` TINYINT(1) DEFAULT 0 COMMENT 'Is device banned (0: no, 1: yes)',
  `ban_reason` VARCHAR(255) DEFAULT NULL COMMENT 'Ban reason',
  `last_connected_at` DATETIME DEFAULT NULL COMMENT 'Last connection time',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Registration time',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_id` (`device_id`),
  UNIQUE KEY `uk_token` (`token`),
  KEY `idx_platform` (`platform`),
  KEY `idx_plan` (`plan`),
  KEY `idx_last_connected` (`last_connected_at`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Device registration table';

-- ==============================================================================
-- Table: ai_license
-- Description: License key and activation code management
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `ai_license` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `license_key` VARCHAR(128) NOT NULL COMMENT 'License key (unique)',
  `plan` VARCHAR(32) NOT NULL COMMENT 'Plan type: free/pro/enterprise',
  `max_devices` INT UNSIGNED DEFAULT 1 COMMENT 'Max bindable devices',
  `bound_devices` INT UNSIGNED DEFAULT 0 COMMENT 'Currently bound devices',
  `expires_at` DATETIME DEFAULT NULL COMMENT 'Expiration time',
  `active` TINYINT(1) DEFAULT 1 COMMENT 'Is active (0: no, 1: yes)',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT 'Remark notes',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Creation time',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_license_key` (`license_key`),
  KEY `idx_plan` (`plan`),
  KEY `idx_active` (`active`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='License key management table';

-- ==============================================================================
-- Table: ai_license_device
-- Description: License-device binding relationship
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `ai_license_device` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `license_id` BIGINT UNSIGNED NOT NULL COMMENT 'License ID',
  `device_id` VARCHAR(64) NOT NULL COMMENT 'Device fingerprint',
  `bound_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Binding time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_license_device` (`license_id`, `device_id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='License-device binding table';

-- ==============================================================================
-- Table: ai_session
-- Description: Installation session records
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `ai_session` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `session_id` VARCHAR(64) NOT NULL COMMENT 'Session ID (unique)',
  `device_id` VARCHAR(64) NOT NULL COMMENT 'Device ID',
  `software` VARCHAR(128) NOT NULL COMMENT 'Software name being installed',
  `status` VARCHAR(32) DEFAULT 'running' COMMENT 'Status: running/completed/failed/interrupted',
  `platform` VARCHAR(32) NOT NULL COMMENT 'Platform: darwin/linux/win32',
  `steps_total` INT UNSIGNED DEFAULT 0 COMMENT 'Total steps',
  `steps_completed` INT UNSIGNED DEFAULT 0 COMMENT 'Completed steps',
  `duration_ms` BIGINT UNSIGNED DEFAULT 0 COMMENT 'Duration in milliseconds',
  `error_message` TEXT DEFAULT NULL COMMENT 'Error message if failed',
  `env_info` JSON DEFAULT NULL COMMENT 'Environment info (JSON)',
  `install_plan` JSON DEFAULT NULL COMMENT 'Install plan (JSON)',
  `started_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Session start time',
  `completed_at` DATETIME DEFAULT NULL COMMENT 'Session completion time',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Creation time',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_session_id` (`session_id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_software` (`software`),
  KEY `idx_status` (`status`),
  KEY `idx_started_at` (`started_at`),
  KEY `idx_completed_at` (`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Installation session table';

-- ==============================================================================
-- Table: ai_call_log
-- Description: AI API call logs for cost tracking
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `ai_call_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `session_id` VARCHAR(64) NOT NULL COMMENT 'Associated session ID',
  `device_id` VARCHAR(64) NOT NULL COMMENT 'Device ID',
  `scene` VARCHAR(64) NOT NULL COMMENT 'Scene: envAnalysis/planGeneration/errorDiagnosis/tutor',
  `provider` VARCHAR(32) NOT NULL COMMENT 'Provider: anthropic/openai/deepseek/google/qwen',
  `model` VARCHAR(64) NOT NULL COMMENT 'Model name',
  `input_tokens` INT UNSIGNED DEFAULT 0 COMMENT 'Input token count',
  `output_tokens` INT UNSIGNED DEFAULT 0 COMMENT 'Output token count',
  `cost_usd` DECIMAL(10, 6) DEFAULT 0.000000 COMMENT 'Cost in USD',
  `duration_ms` INT UNSIGNED DEFAULT 0 COMMENT 'Response time in milliseconds',
  `success` TINYINT(1) DEFAULT 1 COMMENT 'Success (0: failed, 1: success)',
  `error_code` VARCHAR(64) DEFAULT NULL COMMENT 'Error code if failed',
  `error_message` TEXT DEFAULT NULL COMMENT 'Error message if failed',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Call time',
  PRIMARY KEY (`id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_scene` (`scene`),
  KEY `idx_provider` (`provider`),
  KEY `idx_success` (`success`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI call log table';

-- ==============================================================================
-- Table: ai_quota_reset_log
-- Description: Monthly quota reset records
-- ==============================================================================
CREATE TABLE IF NOT EXISTS `ai_quota_reset_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `device_id` VARCHAR(64) NOT NULL COMMENT 'Device ID',
  `reset_month` VARCHAR(7) NOT NULL COMMENT 'Reset month: YYYY-MM',
  `quota_used_before` INT UNSIGNED DEFAULT 0 COMMENT 'Quota used before reset',
  `quota_limit` INT UNSIGNED DEFAULT 5 COMMENT 'Quota limit',
  `reset_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Reset time',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_reset_month` (`reset_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quota reset log table';

-- ==============================================================================
-- Insert default data
-- ==============================================================================

-- Insert a default free license for testing
INSERT INTO `ai_license` (`license_key`, `plan`, `max_devices`, `active`, `remark`)
VALUES
  ('FREE-TEST-LICENSE-2026', 'free', 1, 1, 'Default test license')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- ==============================================================================
-- Database initialization completed
-- ==============================================================================

-- Display table information
SELECT
  TABLE_NAME as 'Table',
  TABLE_ROWS as 'Rows',
  ROUND(DATA_LENGTH / 1024 / 1024, 2) as 'Data Size (MB)',
  ROUND(INDEX_LENGTH / 1024 / 1024, 2) as 'Index Size (MB)',
  TABLE_COMMENT as 'Comment'
FROM
  information_schema.TABLES
WHERE
  TABLE_SCHEMA = 'aiinstaller'
ORDER BY
  TABLE_NAME;

SELECT '✓ Database initialization completed successfully!' as Status;
