const express = require("express");
const { body, validationResult } = require("express-validator");
const pool = require("../../db/pool");
const logger = require("../../services/logger");
const { route } = require("./endpoint");

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array(),
    });
  }
  next();
}

router.post(
  "/trigger",
  body("event_type").trim().notEmpty().withMessage("Event type is required"),
  body("payload").notEmpty().withMessage("Payload is required"),
  validate,
  async (req, res) => {
    const { event_type, payload = {} } = req.body;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // ── STEP 1: Save the event
      const eventResult = await client.query(
        `INSERT INTO events (event_type, payload)
         VALUES ($1, $2)
         RETURNING *`,
        [event_type, JSON.stringify(payload)],
      );
      const event = eventResult.rows[0];

      logger.info("Event created", {
        eventId: event.id,
        eventType: event_type,
      });

      // ── STEP 2: Find all subscribed endpoints ─────────────────────
      // ANY(event_types) checks if event_type exists in the array
      const endpointResult = await client.query(
        `SELECT id, url , name FROM endpoints 
         WHERE is_active = true
         AND $1 = ANY(event_types)
        `,
        [event_type],
      );

      const endpoints = endpointResult.rows;

      logger.info("Found subscribed endpoints", {
        eventType: event_type,
        count: endpoints.length,
        endpoints: endpoints.map((e) => e.name),
      });

      // ── STEP 3: Create a delivery record for each endpoint ─────────
      const deliveryIds = [];

      for (const endpoint of endpoints) {
        const deliveryResult = await client.query(
          `INSERT INTO deliveries (endpoint_id, event_id, status, max_attempts)
             VALUES ($1, $2, 'pending' , $3)
             RETURNING id
            `,
          [
            endpoint.id,
            event.id,
            parseInt(process.env.MAX_RETRY_ATTEMPTS) || 5,
          ],
        );

        const deliveryId = deliveryResult.rows[0].id;
        deliveryIds.push(deliveryId);

        logger.info("STUB would enque delivery job", {
          deliveryId,
          endpointId: endpoint.id,
          endpointName: endpoint.name,
          endpointUrl: endpoint.url,
        });
      }

      await client.query("COMMIT");

      res.status(202).json({
        message: `Event received. Queued for delivery to ${endpoints.length} endpoint(s).`,
        event: {
          id: event.id,
          type: event.event_type,
          triggered_at: event.triggered_at,
        },
        deliveries_queued: endpoints.length,
        delivery_ids: deliveryIds,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Failed to trigger event", { error: error.message });
      res.status(500).json({ error: "Failed to trigger event" });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/events ─────────────────────────────────────────────────
// List recent events with delivery summary

router.get("/", async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const result = await pool.query(
      `SELECT
         e.*,
         COUNT(d.id) as total_deliveries,
         COUNT(d.id) FILTER (WHERE d.status = 'success') as successful,
         COUNT(d.id) FILTER (WHERE d.status = 'permanently_failed') as failed
       FROM events e
       LEFT JOIN deliveries d ON e.id = d.event_id
       GROUP BY e.id
       ORDER BY e.triggered_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const count = await pool.query('SELECT COUNT(*) FROM events')

    res.json({
      events: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' })
  }
});


router.get('/types',async(req,res)=>{
    try {
        const result = await pool.query(
            `SELECT DISTINCT unnest(event_types) as event_type
             FROM endpoints
             WHERE is_active = true
             ORDER BY event_type
            `
        )
        res.json({
            event_types:result.rows.map(r => r.event_type)
        })
    } catch (error) {
         res.status(500).json({ error: 'Failed to fetch event types' })
    }
})

module.exports = router