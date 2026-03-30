import type { Request, Response, NextFunction } from 'express'
import { verifyToken, getProfile, type Profile } from '../lib/supabase'
import type { Tier } from '../lib/supabase'

// Extend Express Request to carry auth state
declare global {
  namespace Express {
    interface Request {
      userId?: string
      userProfile?: Profile | null
      tier?: Tier
      clientIp: string
    }
  }
}

/** Extracts the real client IP, respecting reverse-proxy headers. */
function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? '0.0.0.0'
}

/**
 * OPTIONAL auth middleware.
 * Attaches userId, userProfile, and tier to the request if a valid
 * Bearer token is present. Does NOT reject unauthenticated requests —
 * use requireAuth for that.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.clientIp = extractIp(req)

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    req.tier = 'anonymous'
    return next()
  }

  const token = authHeader.slice(7)
  const user = await verifyToken(token)
  if (!user) {
    req.tier = 'anonymous'
    return next()
  }

  const profile = await getProfile(user.id)
  req.userId = user.id
  req.userProfile = profile
  req.tier = profile?.tier === 'premium' ? 'premium' : 'free'
  next()
}

/**
 * REQUIRED auth middleware.
 * Returns 401 if there is no valid Bearer token.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  await optionalAuth(req, res, () => {})

  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  next()
}
