-- ============================================================================
-- Bitcart Payment Integration Migration
-- 创建虚拟币支付相关表 (Bitcart)
-- ============================================================================

-- Bitcart 发票表
CREATE TABLE IF NOT EXISTS bitcart_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'team', 'enterprise')),

  -- 金额信息
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  order_id TEXT NOT NULL UNIQUE,

  -- 支付状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'invalid')),
  payment_currency TEXT,
  payment_address TEXT,
  payment_url TEXT,

  -- Webhook 验证
  webhook_verified BOOLEAN NOT NULL DEFAULT FALSE,

  -- 时间戳
  expires_at TIMESTAMP NOT NULL,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_bitcart_invoices_tenant_id ON bitcart_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bitcart_invoices_user_id ON bitcart_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_bitcart_invoices_status ON bitcart_invoices(status);
CREATE INDEX IF NOT EXISTS idx_bitcart_invoices_order_id ON bitcart_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_bitcart_invoices_expires_at ON bitcart_invoices(expires_at);

-- Bitcart 支付记录表 (审计追踪)
CREATE TABLE IF NOT EXISTS bitcart_payments (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES bitcart_invoices(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 交易详情
  tx_hash TEXT,
  payment_currency TEXT NOT NULL,
  payment_amount NUMERIC(18,8) NOT NULL,
  usd_amount NUMERIC(10,2) NOT NULL,

  -- 确认状态
  confirmations INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirmed', 'completed')),

  -- 额外元数据
  metadata JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_bitcart_payments_invoice_id ON bitcart_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_bitcart_payments_tenant_id ON bitcart_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bitcart_payments_tx_hash ON bitcart_payments(tx_hash);
CREATE INDEX IF NOT EXISTS idx_bitcart_payments_created_at ON bitcart_payments(created_at);

-- 扩展订阅表 (支持虚拟币支付方式)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS payment_method TEXT
  CHECK (payment_method IN ('bitcart'))
  DEFAULT 'bitcart';

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS bitcart_invoice_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_method ON subscriptions(payment_method);
CREATE INDEX IF NOT EXISTS idx_subscriptions_bitcart ON subscriptions(bitcart_invoice_id);
