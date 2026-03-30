import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import chatRouter from './routes/chat'
import conversationsRouter from './routes/conversations'
import usageRouter from './routes/usage'
import billingRouter from './routes/billing'

const app = express()
const PORT = process.env.PORT ?? 3001

// ─── Security middleware ──────────────────────────────────────────────────────

app.use(helmet())

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })
)

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '16kb' }))

// ─── Global rate limiter (fallback, per IP) ───────────────────────────────────
// This is a hard cap on raw HTTP requests to prevent abuse.
// Business-logic rate limiting (per user/tier) is handled in the chat route.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,             // 60 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  })
)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/chat', chatRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/usage', usageRouter)
app.use('/api/billing', billingRouter)

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`MediSpace backend running on http://localhost:${PORT}`)
  console.log(`  Environment : ${process.env.NODE_ENV ?? 'development'}`)
  console.log(`  Frontend URL: ${process.env.FRONTEND_URL ?? 'http://localhost:5173'}`)
})

export default app
