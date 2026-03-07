const express = require("express");
const { body, param, validationResult } = require("express-validator");
const pool = require("../../db/pool");
const { generateSecret } = require("../../services/signature");
const { route, routes } = require("../../app");
const logger = require("../../services/logger");
const { error } = require("console");

const router = express.Router();

// ── VALIDATION HELPER ───────────────────────────────────────────────
// Checks if validation passed, returns 400 if not

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

// ── POST /api/endpoints ─────────────────────────────────────────────
// Register a new webhook endpoint

router.post(
  "/",
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("url").isURL().withMessage("Valid URL is required"),
  body("event_types")
    .isArray({ min: 1 })
    .withMessage("At least one event type required"),
  body("description").optional().trim(),
  validate,
  async (req, res) => {
    const { name, url, event_types, description } = req.body;

    const secret = generateSecret();
    const client = await pool.connect();
    console.log(name,url,event_types,description,secret)
    try {
      await client.query("BEGIN");
      //Insert the endpoints
      const result = await client.query(
        `INSERT INTO endpoints (name, url, secret, event_types, description)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
        [name, url, secret, event_types, description || null],
      );
      const endpoint = result.rows[0];

      // Create a health record for this endpoint
      // Every endpoint starts as "unknown" health

      await client.query(
        `INSERT INTO endpoint_health (endpoint_id, health_status)
         VALUES ($1, 'unknown')`,
        [endpoint.id],
      );

      await client.query("COMMIT");
      logger.info("Endpoint registered", { endpointId: endpoint.id, url });

      res.status(201).json({
        endpoint,
        message:
          "Endpoint registered. Store the secret safely — it will not be shown again.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Failed to create endpoint", { error: error.message });
      res.status(500).json({ error: "Failed to register endpoints" });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/endpoints ──────────────────────────────────────────────
// List all endpoints with their health status

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
              e.*,
              eh.health_status,
              eh.success_rate,
              eh.total_deliveries,
              eh.successful_deliveries,
              eh.failed_deliveries,
              eh.last_delivery_at
            FROM endpoints e
            LEFT JOIN endpoint_health eh ON e.id = eh.endpoint_id
            ORDER BY e.created_at DESC
            `,
    );
    res.json({ endpoint: result.rows });
  } catch (error) {
    logger.error("Failed to list endpoints", { error: error.message });
    res.status(500).json({ error: "Failed to fetch endpoints" });
  }
});

// ── GET /api/endpoints/:id ──────────────────────────────────────────
// Get a single endpoint by id

router.get(
  "/:id",
  param("id").isUUID().withMessage("Invalid endpoint ID"),
  validate,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
            e.*,
            eh.health_status,
            eh.success_rate,
            eh.total_deliveries,
            eh.successful_deliveries,
            eh.failed_deliveries,
            eh.last_delivery_at
         FROM endpoints e
         LEFT JOIN endpoint_health eh ON e.id = eh.endpoint_id
         WHERE e.id = $1
        `,
        [req.params.id],
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      res.json({ endpoint: result.rows[0] });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch endpoint" });
    }
  },
);

// ── PATCH /api/endpoints/:id ────────────────────────────────────────
// Update an endpoint — only send fields you want to change

router.patch(
  "/:id",
  param("id").isUUID().withMessage("Invalid endpoint ID"),
  body("name").optional().trim().notEmpty(),
  body("url").optional().isURL(),
  body("event_types").optional().isArray({ min: 1 }),
  body("is_active").optional().isBoolean(),
  body("description").optional().trim(),
  validate,
  async (req, res) => {
    const { name, url, event_types, is_active, description } = req.body;

    const updates = [];
    const values = [];
    // Dynamically build the SET clause
    // Only update fields that were actually sent
    let i = 1;

    if (name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(name);
    }
    if (url !== undefined) {
      updates.push(`url = $${i++}`);
      values.push(url);
    }
    if (event_types !== undefined) {
      updates.push(`event_types = $${i++}`);
      values.push(event_types);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${i++}`);
      values.push(is_active);
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description);
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    //update the Timestamp
    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    try {
      const result = await pool.query(
        `UPDATE endpoints
            SET ${updates.join(", ")}
            WHERE id = $${i}
            RETURNING *`,
        values,
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      res.json({ endpoint: result.rows[0] });
    } catch (error) {
      res.status(500).json({ error: "Failed to update endpoint" });
    }
  },
);

// ── DELETE /api/endpoints/:id ───────────────────────────────────────
// Delete an endpoint — cascades to deliveries and health automatically

router.delete(
  "/:id",
  param("id").isUUID().withMessage("Invalid endpoint ID"),
  validate,
  async (req, res) => {
    try {
      const result = await pool.query(
        `DELETE FROM endpoints WHERE id = $1 RETURNING id`,
        [req.params.id],
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Endpoint not found" });
      }
      res.json({ message: "Endpoint deleted", id: req.params.id });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete the endpoint" });
    }
  },
);

// ── GET /api/endpoints/:id/logs ─────────────────────────────────────
// Get delivery logs for a specific endpoint

router.get(
  "/:id/logs",
  param("id").isUUID().withMessage("Invalid endpoint ID"),
  validate,
  async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    try {
      let whereClause = "WHERE d.endpoint_id = $1";
      const params = [req.params.id];

      if (status) {
        params.push(status);
        whereClause += `AND d.status = $${params.length}`;
      }

      const logs = await pool.query(
        `SELECT
           d.*,
           e.event_type,
           e.payload,
           e.triggered_at
         FROM deliveries d
         JOIN events e ON d.event_id = e.id
         ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT $${params.length + 1}
         OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      const count = await pool.query(
        `SELECT COUNT(*) FROM deliveries d ${whereClause}`,
        params,
      );

      res.json({
        logs: logs.rows,
        pagination: {
          total: parseInt(count.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  },
);

module.exports = router
