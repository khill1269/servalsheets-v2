-- ServalSheets Database Schema
-- Run this in Supabase SQL Editor or any PostgreSQL database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CUSTOMERS
-- ============================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  
  -- Stripe integration
  stripe_customer_id VARCHAR(255) UNIQUE,
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50) DEFAULT 'none',
  
  -- Plan info
  tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  
  -- Referral
  referral_code VARCHAR(20) UNIQUE,
  referred_by UUID REFERENCES customers(id),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customers_stripe ON customers(stripe_customer_id);
CREATE INDEX idx_customers_email ON customers(email);

-- ============================================
-- API KEYS
-- ============================================
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  
  key_prefix VARCHAR(20) NOT NULL,
  key_hash VARCHAR(64) UNIQUE NOT NULL,
  
  name VARCHAR(100) DEFAULT 'Default API Key',
  tier VARCHAR(20) NOT NULL,
  permissions JSONB DEFAULT '["*"]',
  rate_limit INTEGER DEFAULT 60,
  
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_customer ON api_keys(customer_id);

-- ============================================
-- USAGE TRACKING
-- ============================================
CREATE TABLE usage_records (
  id BIGSERIAL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  
  tool VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 1,
  
  spreadsheet_id VARCHAR(100),
  success BOOLEAN DEFAULT true,
  latency_ms INTEGER,
  
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE usage_records_2026_01 PARTITION OF usage_records
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE usage_records_2026_02 PARTITION OF usage_records
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE usage_records_2026_03 PARTITION OF usage_records
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE INDEX idx_usage_customer_time ON usage_records(customer_id, created_at);

-- ============================================
-- MONTHLY USAGE AGGREGATES
-- ============================================
CREATE TABLE usage_monthly (
  customer_id UUID NOT NULL REFERENCES customers(id),
  month DATE NOT NULL,
  
  total_operations INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  operations_by_tool JSONB DEFAULT '{}',
  
  PRIMARY KEY (customer_id, month)
);

-- ============================================
-- REFERRALS
-- ============================================
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  referrer_id UUID NOT NULL REFERENCES customers(id),
  referee_id UUID NOT NULL REFERENCES customers(id),
  referral_code VARCHAR(20) NOT NULL,
  
  referrer_reward_tokens INTEGER DEFAULT 0,
  referee_reward_tokens INTEGER DEFAULT 0,
  
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Increment usage atomically
CREATE OR REPLACE FUNCTION increment_usage(
  p_customer_id UUID,
  p_month DATE,
  p_tool TEXT,
  p_tokens INTEGER
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO usage_monthly (customer_id, month, total_operations, total_tokens, operations_by_tool)
  VALUES (p_customer_id, p_month, 1, p_tokens, jsonb_build_object(p_tool, p_tokens))
  ON CONFLICT (customer_id, month) DO UPDATE SET
    total_operations = usage_monthly.total_operations + 1,
    total_tokens = usage_monthly.total_tokens + p_tokens,
    operations_by_tool = usage_monthly.operations_by_tool || 
      jsonb_build_object(p_tool, COALESCE((usage_monthly.operations_by_tool->>p_tool)::INTEGER, 0) + p_tokens);
END;
$$ LANGUAGE plpgsql;

-- Generate referral code
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::INTEGER, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate referral code trigger
CREATE OR REPLACE FUNCTION set_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_referral_code
  BEFORE INSERT ON customers
  FOR EACH ROW
  EXECUTE FUNCTION set_referral_code();
