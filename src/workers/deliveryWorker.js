require('dotenv').config()
const { Worker } = require('bullmq')
const axios = require('axios')
const pool = require('../db/pool')
const { generateSignature } = require('../services/signature')
const { updateEndpointHealth } = require('../services/health')
const logger = require('../services/logger')
const { connection } = require('./queue')

const MAX_ATTEMPTS  = parseInt(process.env.MAX_RETRY_ATTEMPTS)   || 5
const BASE_DELAY_MS = parseInt(process.env.BASE_RETRY_DELAY_MS)  || 10000
const TIMEOUT_MS    = parseInt(process.env.DELIVERY_TIMEOUT_MS)  || 10000

// ── Exponential backoff ─────────────────────────────────────────────
function calcBackoffDelay(attemptNumber) {
  const exponential = BASE_DELAY_MS * Math.pow(2, attemptNumber)
  const jitter      = Math.random() * 1000
  return Math.round(exponential + jitter)
}

// ── HTTP delivery ───────────────────────────────────────────────────
async function deliverWebhook(endpoint, event, deliveryId, attemptNumber) {
  const webhookPayload = {
    id:        event.id,
    type:      event.event_type,
    payload:   event.payload,
    timestamp: event.triggered_at,
  }

  const payloadString = JSON.stringify(webhookPayload)
  const signature     = generateSignature(payloadString, endpoint.secret)
  const startTime     = Date.now()

  const response = await axios.post(endpoint.url, webhookPayload, {
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type':       'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-ID':        deliveryId,
      'X-Webhook-Timestamp': new Date().toISOString(),
      'X-Webhook-Attempt':   String(attemptNumber),
      'User-Agent':          'WebhookEngine/1.0',
    },
  })

  return {
    responseCode:    response.status,
    responseTimeMs:  Date.now() - startTime,
    responseBody:    JSON.stringify(response.data).substring(0, 1000),
  }
}

// ── Worker ──────────────────────────────────────────────────────────
const worker = new Worker(
  'webhook-deliveries',
  async (job) => {
    const { deliveryId, endpointId, eventId } = job.data

    logger.info('Worker picked up job', { deliveryId, endpointId })

    const client = await pool.connect()

    try {
      // Fetch all needed records in parallel
      const [deliveryRes, endpointRes, eventRes] = await Promise.all([
        client.query('SELECT * FROM deliveries WHERE id = $1', [deliveryId]),
        client.query('SELECT * FROM endpoints  WHERE id = $1', [endpointId]),
        client.query('SELECT * FROM events     WHERE id = $1', [eventId]),
      ])

      const delivery = deliveryRes.rows[0]
      const endpoint = endpointRes.rows[0]
      const event    = eventRes.rows[0]

      // Safety checks
      if (!delivery || !endpoint || !event) {
        logger.warn('Missing records for job', { deliveryId })
        return
      }

      if (!endpoint.is_active) {
        logger.info('Skipping — endpoint inactive', { endpointId })
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

      // Increment attempt number
      const newAttempt = delivery.attempt_number + 1

      // Mark as delivering
      await client.query(
        `UPDATE deliveries
         SET status         = 'delivering',
             attempt_number = $1,
             updated_at     = NOW()
         WHERE id = $2`,
        [newAttempt, deliveryId]
      )

      logger.info('Attempting delivery', {
        deliveryId,
        attempt:   newAttempt,
        url:       endpoint.url,
        eventType: event.event_type,
      })

      try {
        // ── SUCCESS ──────────────────────────────────────────────
        const { responseCode, responseTimeMs, responseBody } =
          await deliverWebhook(endpoint, event, deliveryId, newAttempt)

        await client.query(
          `UPDATE deliveries
           SET status          = 'success',
               response_code   = $1,
               response_time_ms = $2,
               response_body   = $3,
               delivered_at    = NOW(),
               updated_at      = NOW()
           WHERE id = $4`,
          [responseCode, responseTimeMs, responseBody, deliveryId]
        )

        logger.info('Delivery succeeded', {
          deliveryId,
          attempt:        newAttempt,
          responseCode,
          responseTimeMs: `${responseTimeMs}ms`,
        })

      } catch (deliveryError) {
        // ── FAILURE ──────────────────────────────────────────────
        const errMsg      = deliveryError.message || 'Unknown error'
        const responseCode = deliveryError.response?.status || null

        logger.warn('Delivery attempt failed', {
          deliveryId,
          attempt: newAttempt,
          error:   errMsg,
        })

        if (newAttempt >= MAX_ATTEMPTS) {
          // ── PERMANENTLY FAILED ──────────────────────────────
          await client.query(
            `UPDATE deliveries
             SET status        = 'permanently_failed',
                 response_code = $1,
                 error_message = $2,
                 updated_at    = NOW()
             WHERE id = $3`,
            [responseCode, errMsg, deliveryId]
          )

          logger.error('Delivery permanently failed', {
            deliveryId,
            totalAttempts: newAttempt,
          })

        } else {
          // ── SCHEDULE RETRY ───────────────────────────────────
          const delayMs    = calcBackoffDelay(newAttempt)
          const nextRetryAt = new Date(Date.now() + delayMs)

          await client.query(
            `UPDATE deliveries
             SET status        = 'failed',
                 response_code = $1,
                 error_message = $2,
                 next_retry_at = $3,
                 updated_at    = NOW()
             WHERE id = $4`,
            [responseCode, errMsg, nextRetryAt, deliveryId]
          )

          const { deliveryQueue } = require('./queue')
          await deliveryQueue.add(
            'deliver',
            { deliveryId, endpointId, eventId },
            {
              delay: delayMs,
              jobId: `retry-${deliveryId}-attempt-${newAttempt}`,
            }
          )

          logger.info('Retry scheduled', {
            deliveryId,
            attempt:      newAttempt,
            nextRetryAt,
            delaySeconds: Math.round(delayMs / 1000),
          })
        }
      }

    } finally {
      // Always update health and release client
      client.release()
      await updateEndpointHealth(endpointId)
    }
  },
  {
    connection,
    concurrency: 10,
  }
)

// ── Worker event listeners ──────────────────────────────────────────
worker.on('completed', (job) => {
  logger.debug(`Job ${job.id} completed`)
})

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} threw unexpected error`, { error: err.message })
})

logger.info('Delivery worker started')

module.exports = worker