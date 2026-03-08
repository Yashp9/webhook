// Import Express framework to create HTTP routes
const express = require('express')

// Import validation helpers from express-validator
// These help validate request parameters before executing business logic
const { param, validationResult } = require('express-validator')

// PostgreSQL connection pool for database queries
const pool = require('../../db/pool')

// Queue used to push delivery jobs to background workers
// Typically implemented using Redis + BullMQ
const { deliveryQueue } = require('../../workers/queue')

// Centralized structured logger
const logger = require('../../services/logger')

// Create a router instance for grouping delivery-related routes
const router = express.Router()


/*
  Middleware: validate()

  Purpose:
  Check if express-validator detected validation errors in the request.

  Flow:
  - express-validator stores validation results in request object
  - validationResult(req) retrieves them
  - if errors exist → return HTTP 400
  - otherwise → continue to next middleware
*/
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


// ── GET /api/deliveries ─────────────────────────────────────────────
/*
  Purpose:
  Fetch all webhook deliveries across all endpoints.

  Supports filtering + pagination.

  Query parameters:
  - status       → filter by delivery status
  - endpoint_id  → filter deliveries belonging to a specific endpoint
  - page         → pagination page number
  - limit        → items per page

  Example request:

  GET /api/deliveries?status=failed&page=2&limit=20
*/
router.get('/', async (req, res) => {

  // Extract filters from query parameters
  const { status, endpoint_id, page = 1, limit = 20 } = req.query

  // Calculate SQL offset for pagination
  const offset = (page - 1) * limit

  /*
    Build dynamic WHERE clause.

    "WHERE 1=1" is a common SQL trick that makes it easy
    to append additional conditions dynamically.
  */
  let where = 'WHERE 1=1'
  const params = []

  // Optional status filter
  if (status) {
    params.push(status)
    where += ` AND d.status = $${params.length}`
  }

  // Optional endpoint filter
  if (endpoint_id) {
    params.push(endpoint_id)
    where += ` AND d.endpoint_id = $${params.length}`
  }

  try {

    /*
      Main query fetching delivery data.

      Tables involved:

      deliveries  → delivery execution record
      events      → original webhook event
      endpoints   → destination webhook endpoint

      JOIN allows enriching delivery data with event + endpoint info.
    */
    const result = await pool.query(
      `SELECT
         d.*,
         e.event_type,
         e.payload,
         ep.name  as endpoint_name,
         ep.url   as endpoint_url
       FROM deliveries d
       JOIN events    e  ON d.event_id    = e.id
       JOIN endpoints ep ON d.endpoint_id = ep.id
       ${where}
       ORDER BY d.created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    )

    /*
      Separate query to compute total records
      for pagination metadata.
    */
    const count = await pool.query(
      `SELECT COUNT(*) FROM deliveries d ${where}`,
      params
    )

    // Send response
    res.json({
      deliveries: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })

  } catch (err) {

    // Generic error response
    res.status(500).json({ error: 'Failed to fetch deliveries' })
  }
})


// ── POST /api/deliveries/:id/retry ──────────────────────────────────
/*
  Purpose:
  Manually retry a failed webhook delivery.

  Use case:
  - endpoint fixed their server
  - developer wants to reattempt delivery

  Validation:
  - delivery ID must be a valid UUID
*/
router.post('/:id/retry',

  // Validate route parameter
  param('id').isUUID().withMessage('Invalid delivery ID'),

  validate,

  async (req, res) => {

    try {

      /*
        Fetch delivery record along with event type.
      */
      const result = await pool.query(
        `SELECT d.*, e.event_type
         FROM deliveries d
         JOIN events e ON d.event_id = e.id
         WHERE d.id = $1`,
        [req.params.id]
      )

      // If delivery does not exist
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Delivery not found' })
      }

      const delivery = result.rows[0]

      /*
        Business rule:

        Only deliveries that FAILED can be retried.

        Allowed statuses:
        - failed
        - permanently_failed
      */
      if (!['failed', 'permanently_failed'].includes(delivery.status)) {
        return res.status(400).json({
          error: `Cannot retry a delivery with status "${delivery.status}". Only failed or permanently_failed deliveries can be retried.`
        })
      }

      /*
        Reset delivery state so worker can process it again.

        Fields reset:
        - status → pending
        - attempt_number → 0
        - error_message → cleared
        - next_retry_at → cleared
      */
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

      /*
        Push job back to delivery queue.

        Worker will pick it up and attempt delivery again.
      */
      await deliveryQueue.add(
        'deliver',
        {
          deliveryId:  delivery.id,
          endpointId:  delivery.endpoint_id,
          eventId:     delivery.event_id
        },
        {
          // Unique job id prevents collisions
          jobId: `manual-retry-${delivery.id}-${Date.now()}`
        }
      )

      // Log retry event
      logger.info('Manual retry initiated', { deliveryId: delivery.id })

      res.json({
        message: 'Delivery queued for retry',
        delivery_id: delivery.id
      })

    } catch (err) {

      logger.error('Retry failed', { error: err.message })

      res.status(500).json({ error: 'Failed to retry delivery' })
    }
  }
)


// ── GET /api/deliveries/dead-letter ─────────────────────────────────
/*
  Purpose:
  Fetch permanently failed deliveries.

  This acts as a **Dead Letter Queue (DLQ)**.

  DLQ is used in distributed systems to store
  jobs that failed all retry attempts.
*/
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

    res.status(500).json({ error: 'Failed to fetch dead letter queue' })
  }
})


// ── GET /api/deliveries/stats ────────────────────────────────────────
/*
  Purpose:
  Provide global delivery statistics for dashboard monitoring.

  Metrics include:
  - total deliveries
  - successful deliveries
  - permanently failed deliveries
  - pending jobs
  - jobs in progress
  - average response time
  - overall success rate
*/
router.get('/stats', async (req, res) => {

  try {

    const result = await pool.query(
      `SELECT
         COUNT(*)                                          as total,

         COUNT(*) FILTER (WHERE status = 'success')
           as successful,

         COUNT(*) FILTER (WHERE status = 'permanently_failed')
           as permanently_failed,

         COUNT(*) FILTER (WHERE status = 'delivering')
           as in_progress,

         COUNT(*) FILTER (WHERE status = 'pending')
           as pending,

         ROUND(
           AVG(response_time_ms) FILTER (WHERE status = 'success'),
           2
         ) as avg_response_time_ms,

         ROUND(
           100.0 * COUNT(*) FILTER (WHERE status = 'success')
           / NULLIF(
               COUNT(*) FILTER (WHERE status IN ('success','permanently_failed')),
               0
             ),
           2
         ) as overall_success_rate
       FROM deliveries`
    )


    /*
      Activity analytics for last 24 hours.

      DATE_TRUNC groups timestamps by hour.

      Useful for:
      - charts
      - monitoring spikes
      - detecting failures over time
    */
    const activity = await pool.query(
      `SELECT
         DATE_TRUNC('hour', created_at) as hour,
         COUNT(*)                       as total,
         COUNT(*) FILTER (WHERE status = 'success')
           as successful
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

    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})


// Export router so it can be mounted in the main Express app
module.exports = router