const pool = require('../db/pool')
const logger = require('./logger')

async function updateEndpointHealth(endpointId) {
  const client = await pool.connect()

  try {
    // Get last 10 completed deliveries for this endpoint
    const result = await client.query(
      `SELECT status FROM deliveries
       WHERE endpoint_id = $1
         AND status IN ('success', 'failed', 'permanently_failed')
       ORDER BY created_at DESC
       LIMIT 10`,
      [endpointId]
    )

    const deliveries = result.rows

    // No deliveries yet — mark as unknown
    if (deliveries.length === 0) {
      await client.query(
        `INSERT INTO endpoint_health (endpoint_id, health_status, last_checked_at)
         VALUES ($1, 'unknown', NOW())
         ON CONFLICT (endpoint_id) DO UPDATE SET
           health_status   = 'unknown',
           last_checked_at = NOW()`,
        [endpointId]
      )
      return 'unknown'
    }

    // Calculate success rate from last 10
    const successCount = deliveries.filter(d => d.status === 'success').length
    const successRate  = (successCount / deliveries.length) * 100

    // Determine health status
    let healthStatus
    if      (successRate >= 80) healthStatus = 'healthy'
    else if (successRate >= 40) healthStatus = 'degraded'
    else                        healthStatus = 'failing'

    // Get all-time totals
    const totals = await client.query(
      `SELECT
         COUNT(*)                                                    AS total,
         COUNT(*) FILTER (WHERE status = 'success')                 AS successful,
         COUNT(*) FILTER (WHERE status IN ('failed','permanently_failed')) AS failed,
         MAX(created_at)                                             AS last_delivery
       FROM deliveries
       WHERE endpoint_id = $1`,
      [endpointId]
    )

    const { total, successful, failed, last_delivery } = totals.rows[0]

    // UPSERT — works whether row exists or not
    await client.query(
      `INSERT INTO endpoint_health (
         endpoint_id,
         health_status,
         success_rate,
         total_deliveries,
         successful_deliveries,
         failed_deliveries,
         last_checked_at,
         last_delivery_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (endpoint_id) DO UPDATE SET
         health_status         = EXCLUDED.health_status,
         success_rate          = EXCLUDED.success_rate,
         total_deliveries      = EXCLUDED.total_deliveries,
         successful_deliveries = EXCLUDED.successful_deliveries,
         failed_deliveries     = EXCLUDED.failed_deliveries,
         last_checked_at       = NOW(),
         last_delivery_at      = EXCLUDED.last_delivery_at`,
      [
        endpointId,
        healthStatus,
        parseFloat(successRate.toFixed(1)),
        total,
        successful,
        failed,
        last_delivery,
      ]
    )

    logger.info('Health updated', {
      endpointId,
      healthStatus,
      successRate: `${successRate.toFixed(1)}%`,
    })

    return healthStatus

  } catch (err) {
    logger.error('Failed to update health', {
      endpointId,
      error: err.message,
    })
  } finally {
    client.release()
  }
}

module.exports = { updateEndpointHealth }