import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { getLimit, updateProfileTier } from '../lib/supabase'

const router = Router()

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: 'month',
    messagesPerDay: getLimit('free'),
    features: [
      `${getLimit('free')} AI messages per day`,
      'Save chat history',
      'Health profile',
      'All health topics',
    ],
    unavailable: ['Priority support', 'Extended context window'],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 9.99,
    currency: 'USD',
    interval: 'month',
    messagesPerDay: getLimit('premium'),
    features: [
      `${getLimit('premium')} AI messages per day`,
      'Save chat history',
      'Health profile',
      'All health topics',
      'Priority support',
      'Extended context window',
    ],
    unavailable: [],
  },
]

/**
 * GET /api/billing/plans
 * Public — returns all available plans.
 */
router.get('/plans', (_req: Request, res: Response) => {
  res.json({ plans: PLANS })
})

/**
 * GET /api/billing/subscription
 * Auth required — returns the user's current plan and usage limits.
 */
router.get('/subscription', requireAuth, (req: Request, res: Response) => {
  const tier = req.tier! as 'free' | 'premium'
  const plan = PLANS.find(p => p.id === tier) ?? PLANS[0]

  res.json({
    tier,
    plan,
    // In a real system this would come from a subscriptions table
    status: 'active',
    currentPeriodEnd: (() => {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      return d.toISOString()
    })(),
  })
})

/**
 * POST /api/billing/upgrade
 * Auth required — dummy upgrade to premium (no payment processing).
 */
router.post('/upgrade', requireAuth, async (req: Request, res: Response) => {
  if (req.tier === 'premium') {
    res.status(400).json({ error: 'Already on the Premium plan.' })
    return
  }

  const { error } = await updateProfileTier(req.userId!, 'premium')
  if (error) {
    res.status(500).json({ error: 'Failed to upgrade. Please try again.' })
    return
  }

  const plan = PLANS.find(p => p.id === 'premium')!
  res.json({
    success: true,
    message: 'Upgraded to Premium successfully.',
    tier: 'premium',
    plan,
  })
})

/**
 * POST /api/billing/downgrade
 * Auth required — dummy downgrade to free.
 */
router.post('/downgrade', requireAuth, async (req: Request, res: Response) => {
  if (req.tier === 'free') {
    res.status(400).json({ error: 'Already on the Free plan.' })
    return
  }

  const { error } = await updateProfileTier(req.userId!, 'free')
  if (error) {
    res.status(500).json({ error: 'Failed to downgrade. Please try again.' })
    return
  }

  const plan = PLANS.find(p => p.id === 'free')!
  res.json({
    success: true,
    message: 'Downgraded to Free plan.',
    tier: 'free',
    plan,
  })
})

export default router
