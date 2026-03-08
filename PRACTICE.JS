require('dotenv').config()
const { Worker } = require('bullmq')
const axios = require('axios')
const pool = require('../db/pool')
const { generateSignature } = require('../services/signature')
const logger = require('../services/logger')
const { connection } = require('./queue')

const MAX_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS) || 5
const BASE_DELAY_MS = parseInt(process.env.BASE_RETRY_DELAY_MS) || 10000
const TIMEOUT_MS = parseInt(process.env.DELIVERY_TIMEOUT_MS) || 10000

// ── BACKOFF CALCULATOR ──────────────────────────────────────────────
function calcBackoffDelay(attemptNumber) {
  const exponential = BASE_DELAY_MS * Math.pow(2, attemptNumber)
  const jitter = Math.random() * 1000  // 0 to 1 second random noise
  const delay = exponential + jitter
  return Math.round(delay)
}

// ── HTTP DELIVERY FUNCTION ──────────────────────────────────────────
async function deliverWebhook(endpoint, event, deliveryId, attemptNumber) {
  // Build the payload we'll send
  const webhookPayload = {
    id: event.id,
    type: event.event_type,
    payload: event.payload,
    timestamp: event.triggered_at
  }

  // Convert to string for signing
  const payloadString = JSON.stringify(webhookPayload)

  // Generate HMAC signature using this endpoint's secret
  const signature = generateSignature(payloadString, endpoint.secret)

  const startTime = Date.now()

  // Send the HTTP POST
  const response = await axios.post(
    endpoint.url,
    webhookPayload,
    {
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,      // ← HMAC signature
        'X-Webhook-ID': deliveryId,            // ← which delivery
        'X-Webhook-Timestamp': new Date().toISOString(),
        'X-Webhook-Attempt': attemptNumber,    // ← which attempt number
        'User-Agent': 'WebhookEngine/1.0',
      }
    }
  )

  const responseTimeMs = Date.now() - startTime

  return {
    responseCode: response.status,
    responseTimeMs,
    responseBody: JSON.stringify(response.data).substring(0, 1000)
  }
}

// ── THE WORKER ──────────────────────────────────────────────────────
const worker = new Worker(
  'webhook-deliveries',    // must match queue name in queue.js
  async (job) => {
    const { deliveryId, endpointId, eventId } = job.data

    logger.info('⚡ Worker picked up job', { deliveryId, endpointId })

    const client = await pool.connect()
    try {

      // ── FETCH EVERYTHING WE NEED ──────────────────────────────────
      const [deliveryRes, endpointRes, eventRes] = await Promise.all([
        client.query('SELECT * FROM deliveries WHERE id = $1', [deliveryId]),
        client.query('SELECT * FROM endpoints WHERE id = $1', [endpointId]),
        client.query('SELECT * FROM events WHERE id = $1', [eventId]),
      ])

      const delivery = deliveryRes.rows[0]
      const endpoint = endpointRes.rows[0]
      const event    = eventRes.rows[0]

      // Safety checks
      if (!delivery || !endpoint || !event) {
        logger.warn('Missing data for delivery job', { deliveryId })
        return
      }

      if (!endpoint.is_active) {
        logger.info('Skipping — endpoint is inactive', { endpointId })
        await client.query(
          `UPDATE deliveries
           SET status = 'failed',
               error_message = 'Endpoint is inactive',
               updated_at = NOW()
           WHERE id = $1`,
          [deliveryId]
        )
        return
      }

      // ── INCREMENT ATTEMPT NUMBER ──────────────────────────────────
      const newAttempt = delivery.attempt_number + 1

      // Mark as "delivering" so we know it's in progress
      await client.query(
        `UPDATE deliveries
         SET status = 'delivering',
             attempt_number = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [newAttempt, deliveryId]
      )

      logger.info(`🚀 Attempting delivery`, {
        deliveryId,
        attempt: newAttempt,
        endpoint: endpoint.url,
        eventType: event.event_type
      })

      // ── TRY THE DELIVERY ──────────────────────────────────────────
      try {
        const { responseCode, responseTimeMs, responseBody } =
          await deliverWebhook(endpoint, event, deliveryId, newAttempt)

        // ── SUCCESS ───────────────────────────────────────────────
        await client.query(
          `UPDATE deliveries
           SET status = 'success',
               response_code = $1,
               response_time_ms = $2,
               response_body = $3,
               delivered_at = NOW(),
               updated_at = NOW()
           WHERE id = $4`,
          [responseCode, responseTimeMs, responseBody, deliveryId]
        )

        logger.info(`✅ Delivery succeeded`, {
          deliveryId,
          attempt: newAttempt,
          responseCode,
          responseTimeMs: `${responseTimeMs}ms`
        })

      } catch (deliveryError) {
        // ── FAILURE ───────────────────────────────────────────────
        const errMsg = deliveryError.message || 'Unknown error'
        const responseCode = deliveryError.response?.status || null
        const responseTimeMs = deliveryError.response
          ? Date.now() - Date.now()
          : null

        logger.warn(`❌ Delivery attempt failed`, {
          deliveryId,
          attempt: newAttempt,
          error: errMsg
        })

        if (newAttempt >= MAX_ATTEMPTS) {
          // ── PERMANENTLY FAILED ──────────────────────────────────
          await client.query(
            `UPDATE deliveries
             SET status = 'permanently_failed',
                 response_code = $1,
                 error_message = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [responseCode, errMsg, deliveryId]
          )

          logger.error(`💀 Delivery permanently failed`, {
            deliveryId,
            totalAttempts: newAttempt
          })

        } else {
          // ── SCHEDULE RETRY WITH BACKOFF ─────────────────────────
          const delayMs = calcBackoffDelay(newAttempt)
          const nextRetryAt = new Date(Date.now() + delayMs)

          await client.query(
            `UPDATE deliveries
             SET status = 'failed',
                 response_code = $1,
                 error_message = $2,
                 next_retry_at = $3,
                 updated_at = NOW()
             WHERE id = $4`,
            [responseCode, errMsg, nextRetryAt, deliveryId]
          )

          // Push retry job back to queue with delay
          const { deliveryQueue } = require('./queue')
          await deliveryQueue.add(
            'deliver',
            { deliveryId, endpointId, eventId },
            {
              delay: delayMs,
              jobId: `retry-${deliveryId}-attempt-${newAttempt}`
            }
          )

          logger.info(`🔄 Retry scheduled`, {
            deliveryId,
            attempt: newAttempt,
            nextRetryAt,
            delayMs: `${Math.round(delayMs / 1000)}s`
          })
        }
      }

    } finally {
      client.release()
    }
  },
  {
    connection,
    concurrency: 10,  // process up to 10 deliveries at the same time
  }
)

// ── WORKER EVENT LISTENERS ──────────────────────────────────────────
worker.on('completed', (job) => {
  logger.debug(`Job ${job.id} completed`)
})

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} threw an unexpected error`, {
    error: err.message
  })
})

logger.info('👷 Delivery worker started')

module.exports = worker