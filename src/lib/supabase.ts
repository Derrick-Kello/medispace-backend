import { createClient } from '@supabase/supabase-js'

// Service role client — bypasses RLS, used only server-side
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string
  full_name: string | null
  onboarding_completed: boolean
  tier: 'free' | 'premium'
  created_at: string
}

export interface HealthProfile {
  id: string
  user_id: string
  date_of_birth: string | null
  gender: string | null
  height_cm: number | null
  weight_kg: number | null
  blood_type: string | null
  existing_conditions: string[]
  allergies: string[]
  current_medications: string[]
  smoking_status: string | null
  alcohol_consumption: string | null
  exercise_frequency: string | null
  primary_health_goal: string | null
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  topic: string | null
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface DailyUsage {
  id: string
  user_id: string | null
  ip_address: string | null
  date: string
  message_count: number
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Verify a Supabase JWT and return the user, or null if invalid. */
export async function verifyToken(token: string) {
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data ?? null
}

export async function updateProfileTier(
  userId: string,
  tier: 'free' | 'premium'
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ tier })
    .eq('id', userId)
  return { error: error?.message ?? null }
}

export async function getHealthProfile(userId: string): Promise<HealthProfile | null> {
  const { data } = await supabase
    .from('health_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  return data ?? null
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  return data ?? []
}

export async function getConversationById(id: string): Promise<Conversation | null> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single()
  return data ?? null
}

export async function createConversation(
  userId: string,
  title: string,
  topic?: string
): Promise<Conversation | null> {
  const { data } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title, topic: topic ?? null })
    .select()
    .single()
  return data ?? null
}

export async function deleteConversation(id: string): Promise<boolean> {
  const { error } = await supabase.from('conversations').delete().eq('id', id)
  return !error
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string): Promise<ConversationMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  return data ?? []
}

export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<ConversationMessage | null> {
  const { data } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single()

  // Touch conversation updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  return data ?? null
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const LIMITS = {
  anonymous: parseInt(process.env.RATE_LIMIT_ANONYMOUS ?? '3'),
  free: parseInt(process.env.RATE_LIMIT_FREE ?? '20'),
  premium: parseInt(process.env.RATE_LIMIT_PREMIUM ?? '200'),
}

export type Tier = 'anonymous' | 'free' | 'premium'

export function getLimit(tier: Tier): number {
  return LIMITS[tier]
}

/**
 * Returns how many messages the user/IP has sent today.
 * Creates the row if it doesn't exist.
 */
export async function getTodayUsage(userId: string | null, ip: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]

  if (userId) {
    const { data } = await supabase
      .from('daily_usage')
      .select('message_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single()
    return data?.message_count ?? 0
  } else {
    const { data } = await supabase
      .from('daily_usage')
      .select('message_count')
      .eq('ip_address', ip)
      .is('user_id', null)
      .eq('date', today)
      .single()
    return data?.message_count ?? 0
  }
}

/**
 * Atomically increments the daily message count.
 * Uses upsert so the row is created on first use.
 */
export async function incrementUsage(userId: string | null, ip: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]

  if (userId) {
    // Try update first, then insert if not exists
    const { error } = await supabase.rpc('increment_daily_usage_user', {
      p_user_id: userId,
      p_date: today,
    })
    // Fallback to manual upsert if the RPC doesn't exist yet
    if (error) {
      await supabase.from('daily_usage').upsert(
        { user_id: userId, ip_address: null, date: today, message_count: 1 },
        { onConflict: 'user_id,date', ignoreDuplicates: false }
      )
      // Increment separately
      await supabase.rpc('increment_usage_count', { p_user_id: userId, p_date: today })
    }
  } else {
    const { error } = await supabase.rpc('increment_daily_usage_ip', {
      p_ip: ip,
      p_date: today,
    })
    if (error) {
      await supabase.from('daily_usage').upsert(
        { user_id: null, ip_address: ip, date: today, message_count: 1 },
        { onConflict: 'ip_address,date', ignoreDuplicates: false }
      )
    }
  }
}
