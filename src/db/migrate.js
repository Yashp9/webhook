require("dotenv").config();
const pool = require("./pool");

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("Rinning migration...");

    await client.query(`
            -- Enable UUID generation
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    //TABLE 1: endpoits
    await client.query(`
                CREATE TABLE IF NOT EXISTS endpoints(
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                name VARCHAR(255) NOT NULL,

                url TEXT NOT NULL,

                secret VARCHAR(255) NOT NULL,

                event_types TEXT[] NOT NULL DEFAULT '{}',

                is_active BOOLEAN NOT NULL DEFAULT true,

                description TEXT,
 
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )`);

    console.log("endpoint table ready");

    // TABLE 2: events gen_random_uuid()
    await client.query(`
        CREATE TABLE IF NOT EXISTS events (

        -- Unique event ID
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Name/type of event
        -- Example: "order.created"
        event_type VARCHAR(255) NOT NULL,

        -- JSON payload sent to webhook
        -- Example: { orderId: 123, amount: 200 }
        payload JSONB NOT NULL DEFAULT '{}',

        -- When the event was triggered
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log(" events table ready");

    // TABLE 3: deliveries
    await client.query(`
      CREATE TABLE IF NOT EXISTS deliveries (

        -- Unique delivery ID
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Which endpoint we are delivering to
        endpoint_id UUID NOT NULL
          REFERENCES endpoints(id)
          ON DELETE CASCADE,

        -- Which event triggered this delivery
        event_id UUID NOT NULL
          REFERENCES events(id)
          ON DELETE CASCADE,

        -- Current status of delivery
        -- pending → delivering → success/failed
        status VARCHAR(50) NOT NULL DEFAULT 'pending',

        -- Number of attempts made
        attempt_number INTEGER NOT NULL DEFAULT 0,

        -- Maximum retry attempts allowed
        max_attempts INTEGER NOT NULL DEFAULT 5,

        -- HTTP response status code from endpoint
        -- Example: 200, 500, 404
        response_code INTEGER,

        -- Time taken for request in milliseconds
        response_time_ms INTEGER,

        -- Error message if request fails
        error_message TEXT,

        -- Next retry time (for exponential backoff)
        next_retry_at TIMESTAMPTZ,

        -- Timestamp when delivery finally succeeded
        delivered_at TIMESTAMPTZ,

        -- Record creation time
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- Last update time
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- Restrict allowed values for status
        CONSTRAINT valid_status CHECK (
          status IN (
            'pending',
            'delivering',
            'success',
            'failed',
            'permanently_failed'
          )
        )
      );
    `);

    console.log(" deliveries table ready");

    // TABLE 4: endpoint_health
    await client.query(`
      CREATE TABLE IF NOT EXISTS endpoint_health (

        -- Unique ID
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Each endpoint has one health record
        endpoint_id UUID NOT NULL UNIQUE
          REFERENCES endpoints(id)
          ON DELETE CASCADE,

        -- Overall health status
        -- healthy / degraded / failing
        health_status VARCHAR(50) NOT NULL DEFAULT 'unknown',

        -- Total delivery attempts
        total_deliveries INTEGER NOT NULL DEFAULT 0,

        -- Successful deliveries
        successful_deliveries INTEGER NOT NULL DEFAULT 0,

        -- Failed deliveries
        failed_deliveries INTEGER NOT NULL DEFAULT 0,

        -- Success rate percentage
        success_rate FLOAT NOT NULL DEFAULT 0,

        -- Last time health was calculated
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- Last delivery attempt time
        last_delivery_at TIMESTAMPTZ,

        -- Restrict health status values
        CONSTRAINT valid_health CHECK (
          health_status IN ('healthy', 'degraded', 'failing', 'unknown')
        )
      );
    `);

    console.log(" endpoint_health table ready");

    await client.query(`

      -- Speed up filtering deliveries by endpoint
      CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint_id
        ON deliveries(endpoint_id);

      -- Speed up queries filtering by delivery status
      CREATE INDEX IF NOT EXISTS idx_deliveries_status
        ON deliveries(status);

      -- Fast sorting of deliveries by creation time
      CREATE INDEX IF NOT EXISTS idx_deliveries_created_at
        ON deliveries(created_at DESC);

      -- Fast lookup of events by event type
      CREATE INDEX IF NOT EXISTS idx_events_event_type
        ON events(event_type);
    `);

    console.log("indexes ready");

    console.log("All migrations complete!");
  } catch (error) {
    // If anything fails, print error and stop
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    // Release connection back to pool
    client.release();

    // Close pool connection
    await pool.end();
  }
}

migrate()
