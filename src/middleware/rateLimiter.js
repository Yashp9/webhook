const rateLimit = require('express-rate-limit')

// General API limit — 100 requests per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Max 100 per minute.' }
})

// Stricter limit on event triggering — 30 per minute
const triggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Trigger rate limit exceeded. Max 30 events per minute.' }
})

module.exports = { apiLimiter, triggerLimiter }