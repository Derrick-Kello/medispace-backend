-- ─── Migration: Add tier + daily_usage for rate limiting ─────────────────────
-- Run this in your Supabase SQL editor.

-- 1. Add tier column to profiles (free or premium)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'premium'));

-- 2. Daily usage tracking table
CREATE TABLE IF NOT EXISTS daily_usage (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address   text,
  date         date        NOT NULL DEFAULT CURRENT_DATE,
  message_count integer    NOT NULL DEFAULT 0,
  updated_at   timestamptz DEFAULT now(),

  -- A logged-in user gets one row per day
  CONSTRAINT uq_user_date    UNIQUE (user_id, date),
  -- An anonymous IP gets one row per day
  CONSTRAINT uq_ip_date      UNIQUE (ip_address, date),
  -- Every row must have either a user_id OR an ip_address, not neither
  CONSTRAINT chk_identity    CHECK (user_id IS NOT NULL OR ip_address IS NOT NULL)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage (user_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_usage_ip_date   ON daily_usage (ip_address, date);

-- 3. RPC: atomically increment usage for a logged-in user
--    Called by the backend; avoids a read-then-write race condition.
CREATE OR REPLACE FUNCTION increment_daily_usage_user(p_user_id uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO daily_usage (user_id, ip_address, date, message_count)
    VALUES (p_user_id, NULL, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    message_count = daily_usage.message_count + 1,
    updated_at    = now();
END;
$$;

-- 4. RPC: atomically increment usage for an anonymous IP
CREATE OR REPLACE FUNCTION increment_daily_usage_ip(p_ip text, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO daily_usage (user_id, ip_address, date, message_count)
    VALUES (NULL, p_ip, p_date, 1)
  ON CONFLICT (ip_address, date)
  DO UPDATE SET
    message_count = daily_usage.message_count + 1,
    updated_at    = now();
END;
$$;

-- 5. RLS: only the service role (backend) should read/write daily_usage
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;

-- The backend uses the service role key which bypasses RLS entirely.
-- Block all access from the anon/authenticated roles for safety.
CREATE POLICY "deny_all_direct_access" ON daily_usage
  FOR ALL USING (false);

-- 6. Ensure messages cascade-delete when a conversation is deleted
--    (Add this only if your messages table doesn't already have it)
-- ALTER TABLE messages
--   DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey,
--   ADD CONSTRAINT messages_conversation_id_fkey
--     FOREIGN KEY (conversation_id)
--     REFERENCES conversations(id)
--     ON DELETE CASCADE;
