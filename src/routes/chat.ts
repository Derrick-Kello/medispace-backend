import { Router } from 'express'
import type { Request, Response } from 'express'
import { optionalAuth } from '../middleware/auth'
import {
  getTodayUsage,
  incrementUsage,
  getLimit,
  getMessages,
  saveMessage,
  createConversation,
  getConversationById,
  getHealthProfile,
} from '../lib/supabase'
import { buildSystemPrompt, chat, chatStream } from '../lib/anthropic'

const router = Router()

/**
 * POST /api/chat
 *
 * Sends a user message and gets an AI response.
 * Enforces daily rate limits per tier.
 * Supports streaming via Accept: text/event-stream header.
 *
 * Body:
 *   message         string  — the user's message (required)
 *   conversationId  string  — existing conversation to continue (optional)
 *   topic           string  — active topic context, e.g. "Drug Interactions" (optional)
 *
 * Response (JSON):
 *   reply           string  — AI response text
 *   conversationId  string  — ID of the conversation (new or existing)
 *   usageToday      number  — messages sent today
 *   usageLimit      number  — daily limit for the user's tier
 *   usageLeft       number  — remaining messages today
 *
 * Response (SSE stream — when Accept: text/event-stream):
 *   data: {"type":"delta","content":"..."}   — text chunk
 *   data: {"type":"done","conversationId":"...","usageToday":N,"usageLimit":N,"usageLeft":N}
 *   data: [DONE]
 */
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  console.log('[chat] request received', req.body)
  const { message, conversationId, topic } = req.body as {
    message?: string
    conversationId?: string
    topic?: string
  }

  // ── Validate input ────────────────────────────────────────────────────────
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' })
    return
  }
  const userMessage = message.trim()

  // ── Rate limit + conversation ownership check (parallel) ─────────────────
  const tier = req.tier!
  const limit = getLimit(tier)

  const [usageToday, existingConv] = await Promise.all([
    getTodayUsage(req.userId ?? null, req.clientIp),
    conversationId && req.userId ? getConversationById(conversationId) : Promise.resolve(null),
  ])

  if (usageToday >= limit) {
    res.status(429).json({
      error: tier === 'anonymous'
        ? 'Free message limit reached. Sign in to keep chatting.'
        : tier === 'free'
        ? 'Daily message limit reached. Upgrade to premium for unlimited messages.'
        : 'Daily message limit reached.',
      usageToday,
      usageLimit: limit,
      usageLeft: 0,
    })
    return
  }

  if (conversationId && req.userId && (!existingConv || existingConv.user_id !== req.userId)) {
    res.status(403).json({ error: 'Conversation not found or access denied' })
    return
  }

  // ── Create conversation + fetch history + health profile (parallel) ───────
  let activeConversationId = conversationId ?? null
  const isNewConversation = !activeConversationId && !!req.userId

  const [, history, healthProfile] = await Promise.all([
    // Create conversation if needed
    isNewConversation
      ? (async () => {
          const title = topic
            ? `${topic} — ${new Date().toLocaleDateString()}`
            : `Conversation — ${new Date().toLocaleDateString()}`
          const conv = await createConversation(req.userId!, title, topic)
          if (!conv) throw new Error('Failed to create conversation')
          activeConversationId = conv.id
        })()
      : Promise.resolve(),

    // Load history (skip for new conversations — no messages yet)
    activeConversationId
      ? getMessages(activeConversationId).then(msgs =>
          msgs.slice(-20).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        )
      : Promise.resolve([]),

    // Health profile
    req.userId ? getHealthProfile(req.userId) : Promise.resolve(null),
  ])

  const systemPrompt = buildSystemPrompt(topic, healthProfile)
  const newUsageToday = usageToday + 1
  const usageLeft = Math.max(0, limit - newUsageToday)

  // ── Fire DB writes without blocking the stream ────────────────────────────
  const dbWrites = Promise.all([
    activeConversationId ? saveMessage(activeConversationId, 'user', userMessage) : Promise.resolve(),
    incrementUsage(req.userId ?? null, req.clientIp),
  ])

  // ── Stream or JSON response ───────────────────────────────────────────────
  const wantsStream = req.headers.accept?.includes('text/event-stream')
  console.log('[chat] wantsStream:', wantsStream, '| message:', userMessage, '| tier:', tier)

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const [fullReply] = await Promise.all([
        chatStream(userMessage, history as any, systemPrompt, (chunk) => {
          sendEvent({ type: 'delta', content: chunk })
        }),
        dbWrites,
      ])

      // Save AI response to DB
      if (activeConversationId) {
        await saveMessage(activeConversationId, 'assistant', fullReply)
      }

      sendEvent({
        type: 'done',
        conversationId: activeConversationId,
        usageToday: newUsageToday,
        usageLimit: limit,
        usageLeft,
      })
      res.write('data: [DONE]\n\n')
      res.end()
    } catch (err) {
      console.error('[chat stream error]', err)
      sendEvent({ type: 'error', message: 'AI response failed' })
      res.end()
    }
    return
  }

  // Non-streaming path
  try {
    const [reply] = await Promise.all([
      chat(userMessage, history as any, systemPrompt),
      dbWrites,
    ])

    // Save AI response to DB
    if (activeConversationId) {
      await saveMessage(activeConversationId, 'assistant', reply)
    }

    res.json({
      reply,
      conversationId: activeConversationId,
      usageToday: newUsageToday,
      usageLimit: limit,
      usageLeft,
    })
  } catch (err) {
    console.error('Anthropic error:', err)
    res.status(502).json({ error: 'AI service unavailable. Please try again.' })
  }
})

export default router
