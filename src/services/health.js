const pool = require("../db/pool");
const logger = require("./logger");

async function updateEndpointHealth(endpointId) {
  const client = await pool.connect();
  try {
    //STEP 1: Fetch last 10 completed deliveries
    const result = await client.query(
      `SELECT status FROM deliveries
             WHERE endpoint_id = $1
               AND status IN ('success','failed','permanently_failed')
             ORDER BY created_at DESC
             LIMIT 10
            `,
      [endpointId],
    );

    const deliveries = result.rows;
    //STEP 2: Handle edge case — no deliveries exist yet
    if (deliveries.length === 0) {
      await client.query(
        `UPDATE endpoint_health
             SET health_status = 'unknown',
                 last_checked_at = NOW()
             WHERE endpoint_id = $1`,
        [endpointId],
      );
      return "unknown";
    }

    //STEP 3: Calculate success rate

    const successCount = deliveries.filter(
      (d) => d.status === "success",
    ).length;

    //convert to percentage
    const successRate = (successCount / deliveries.length) * 100;

    //STEP 4: Determine endpoint health classification
    let healthStatus;
    if (successRate >= 80) healthStatus = "healthy";
    else if (successRate >= 40) healthStatus = "degraded";
    else healthStatus = "failing";

    //STEP 5: Fetch ALL-TIME delivery metrics

    const totals = await client.query(
      `
            SELECT 
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'success')
               as successful,
              COUNT (*) FILTER (WHERE status IN ('failed','permanently_failed')) as failed,
              MAX(created_at) as last_delivery
            FROM deliveries
            WHERE endpoint_id = $1
            `,
      [endpointId],
    );

    const { total, successful, failed, last_delivery } = totals.rows[0];

    // STEP 6: Update endpoint_health table

    await client.query(
      `UPDATE endpoint_health
       SET health_status         = $1,
           success_rate          = $2,
           total_deliveries      = $3,
           successful_deliveries = $4,
           failed_deliveries     = $5,
           last_checked_at       = NOW(),
           last_delivery_at      = $6
       WHERE endpoint_id = $7`,
      [
        healthStatus,

        // Round to 1 decimal for cleaner metrics display
        parseFloat(successRate.toFixed(1)),

        total,
        successful,
        failed,
        last_delivery,
        endpointId,
      ],
    );

    logger.info("Health updated", {
      endpointId,
      healthStatus,
      successRate: `${successRate.toFixed(1)}%`,
    });

    return healthStatus;
  } catch (err) {
    logger.error("Failed to update health", {
      endpointId,
      error: err.message,
    });
  } finally {
    client.release();
  }
}

// Export function so workers and services can call it
module.exports = { updateEndpointHealth };
