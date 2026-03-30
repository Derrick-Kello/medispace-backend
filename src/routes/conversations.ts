import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  getConversations,
  getConversationById,
  createConversation,
  deleteConversation,
  getMessages,
} from '../lib/supabase'

const router = Router()

// All conversation routes require authentication
router.use(requireAuth)

/**
 * GET /api/conversations
 *
 * Returns all conversations for the authenticated user,
 * ordered by most recently updated.
 *
 * Response:
 *   conversations  Conversation[]
 */
router.get('/', async (req: Request, res: Response) => {
  const conversations = await getConversations(req.userId!)
  res.json({ conversations })
})

/**
 * POST /api/conversations
 *
 * Creates a new conversation.
 *
 * Body:
 *   title  string  — conversation title (required)
 *   topic  string  — optional topic context
 *
 * Response:
 *   conversation  Conversation
 */
router.post('/', async (req: Request, res: Response) => {
  const { title, topic } = req.body as { title?: string; topic?: string }

  if (!title || typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const conversation = await createConversation(req.userId!, title.trim(), topic)
  if (!conversation) {
    res.status(500).json({ error: 'Failed to create conversation' })
    return
  }

  res.status(201).json({ conversation })
})

/**
 * GET /api/conversations/:id
 *
 * Returns a single conversation with its messages.
 *
 * Response:
 *   conversation  Conversation
 *   messages      ConversationMessage[]
 */
router.get('/:id', async (req: Request, res: Response) => {
  const conv = await getConversationById(req.params.id)

  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }
  if (conv.user_id !== req.userId) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  const messages = await getMessages(conv.id)
  res.json({ conversation: conv, messages })
})

/**
 * DELETE /api/conversations/:id
 *
 * Deletes a conversation and all its messages (cascade).
 * Only the owner can delete.
 *
 * Response:
 *   204 No Content
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const conv = await getConversationById(req.params.id)

  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }
  if (conv.user_id !== req.userId) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  const ok = await deleteConversation(conv.id)
  if (!ok) {
    res.status(500).json({ error: 'Failed to delete conversation' })
    return
  }

  res.status(204).send()
})

/**
 * GET /api/conversations/:id/messages
 *
 * Returns all messages for a conversation in chronological order.
 *
 * Response:
 *   messages  ConversationMessage[]
 */
router.get('/:id/messages', async (req: Request, res: Response) => {
  const conv = await getConversationById(req.params.id)

  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }
  if (conv.user_id !== req.userId) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  const messages = await getMessages(conv.id)
  res.json({ messages })
})

export default router
