const express = require('express')
const { param, validationResult } = require('express-validator')
const pool = require('../../db/pool')
const { deliveryQueue } = require('../../workers/queue')
const logger = require('../../services/logger')

const router = express.Router()

function validate(req, res, next) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    })
  }
  next()
}

// ── GET /api/deliveries/stats ──────────────────────────────────────
// MUST be before /:id routes
router.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                               as total,
         COUNT(*) FILTER (WHERE status = 'success')            as successful,
         COUNT(*) FILTER (WHERE status = 'permanently_failed') as permanently_failed,
         COUNT(*) FILTER (WHERE status = 'delivering')         as in_progress,
         COUNT(*) FILTER (WHERE status = 'pending')            as pending,
         ROUND(
           AVG(response_time_ms) FILTER (WHERE status = 'success'), 2
         ) as avg_response_time_ms,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE status = 'success')
           / NULLIF(
               COUNT(*) FILTER (WHERE status IN ('success','permanently_failed')), 0
             ), 2
         ) as overall_success_rate
       FROM deliveries`
    )

    const activity = await pool.query(
      `SELECT
         DATE_TRUNC('hour', created_at) as hour,
         COUNT(*)                       as total,
         COUNT(*) FILTER (WHERE status = 'success') as successful
       FROM deliveries
       WHERE created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY 1
       ORDER BY 1 ASC`
    )

    res.json({
      stats: result.rows[0],
      activity: activity.rows
    })
  } catch (err) {
    logger.error('Failed to fetch stats', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// ── GET /api/deliveries/dead-letter ───────────────────────────────
// MUST be before /:id routes
router.get('/dead-letter', async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  try {
    const result = await pool.query(
      `SELECT
         d.*,
         e.event_type,
         e.payload,
         e.triggered_at,
         ep.name as endpoint_name,
         ep.url  as endpoint_url
       FROM deliveries d
       JOIN events    e  ON d.event_id    = e.id
       JOIN endpoints ep ON d.endpoint_id = ep.id
       WHERE d.status = 'permanently_failed'
       ORDER BY d.updated_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )

    const count = await pool.query(
      `SELECT COUNT(*) FROM deliveries WHERE status = 'permanently_failed'`
    )

    res.json({
      dead_letters: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (err) {
    logger.error('Failed to fetch dead letter queue', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch dead letter queue' })
  }
})

// ── GET /api/deliveries ────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, endpoint_id, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let where = 'WHERE 1=1'
  const params = []

  if (status) {
    params.push(status)
    where += ` AND d.status = $${params.length}`
  }

  if (endpoint_id) {
    params.push(endpoint_id)
    where += ` AND d.endpoint_id = $${params.length}`
  }

  try {
    const result = await pool.query(
      `SELECT
         d.*,
         e.event_type,
         e.payload,
         ep.name as endpoint_name,
         ep.url  as endpoint_url
       FROM deliveries d
       JOIN events    e  ON d.event_id    = e.id
       JOIN endpoints ep ON d.endpoint_id = ep.id
       ${where}
       ORDER BY d.created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    )

    const count = await pool.query(
      `SELECT COUNT(*) FROM deliveries d ${where}`,
      params
    )

    res.json({
      deliveries: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (err) {
    logger.error('Failed to fetch deliveries', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch deliveries' })
  }
})

// ── POST /api/deliveries/:id/retry ────────────────────────────────
// MUST be after named routes
router.post('/:id/retry',
  param('id').isUUID().withMessage('Invalid delivery ID'),
  validate,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT d.*, e.event_type
         FROM deliveries d
         JOIN events e ON d.event_id = e.id
         WHERE d.id = $1`,
        [req.params.id]
      )

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Delivery not found' })
      }

      const delivery = result.rows[0]

      if (!['failed', 'permanently_failed'].includes(delivery.status)) {
        return res.status(400).json({
          error: `Cannot retry a delivery with status "${delivery.status}"`
        })
      }

      await pool.query(
        `UPDATE deliveries
         SET status         = 'pending',
             attempt_number = 0,
             error_message  = NULL,
             next_retry_at  = NULL,
             updated_at     = NOW()
         WHERE id = $1`,
        [req.params.id]
      )

      await deliveryQueue.add(
        'deliver',
        {
          deliveryId: delivery.id,
          endpointId: delivery.endpoint_id,
          eventId:    delivery.event_id
        },
        { jobId: `manual-retry-${delivery.id}-${Date.now()}` }
      )

      logger.info('Manual retry initiated', { deliveryId: delivery.id })
      res.json({ message: 'Delivery queued for retry', delivery_id: delivery.id })

    } catch (err) {
      logger.error('Retry failed', { error: err.message })
      res.status(500).json({ error: 'Failed to retry delivery' })
    }
  }
)

module.exports = router