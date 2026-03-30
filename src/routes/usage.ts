import { Router } from 'express'
import type { Request, Response } from 'express'
import { optionalAuth } from '../middleware/auth'
import { getTodayUsage, getLimit } from '../lib/supabase'

const router = Router()

/**
 * GET /api/usage
 *
 * Returns the current user's rate limit status for today.
 * Works for both authenticated and anonymous users.
 *
 * Response:
 *   tier        'anonymous' | 'free' | 'premium'
 *   usageToday  number  — messages sent today
 *   usageLimit  number  — daily message limit for this tier
 *   usageLeft   number  — messages remaining today
 *   resetAt     string  — ISO timestamp when the count resets (midnight UTC)
 */
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  const tier = req.tier!
  const limit = getLimit(tier)
  const usageToday = await getTodayUsage(req.userId ?? null, req.clientIp)
  const usageLeft = Math.max(0, limit - usageToday)

  // Next reset is midnight UTC
  const now = new Date()
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

  res.json({
    tier,
    usageToday,
    usageLimit: limit,
    usageLeft,
    resetAt: resetAt.toISOString(),
  })
})

export default router
