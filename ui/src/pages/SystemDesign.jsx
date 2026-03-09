import { useState } from "react"

const DB_FLOWS = [
  {
    trigger: "POST /api/endpoints",
    color: "#6366f1",
    bg: "#eef2ff",
    icon: "📋",
    label: "Register Endpoint",
    queries: [
      {
        step: 1,
        action: "INSERT into endpoints",
        sql: `INSERT INTO endpoints (id, name, url, secret, event_types, is_active, description)\nVALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5)\nRETURNING *`,
        why: "Creates the webhook endpoint record with its HMAC secret and subscribed event types",
        table: "endpoints",
      },
      {
        step: 2,
        action: "INSERT into endpoint_health",
        sql: `INSERT INTO endpoint_health (endpoint_id, health_status)\nVALUES ($1, 'unknown')`,
        why: "Creates the health tracking row — status starts as 'unknown' until first delivery",
        table: "endpoint_health",
      },
    ],
  },
  {
    trigger: "POST /api/events/trigger",
    color: "#0891b2",
    bg: "#ecfeff",
    icon: "⚡",
    label: "Trigger Event",
    queries: [
      {
        step: 1,
        action: "INSERT into events",
        sql: `INSERT INTO events (id, event_type, payload, triggered_at)\nVALUES (gen_random_uuid(), $1, $2, NOW())\nRETURNING *`,
        why: "Persists the event so it can be replayed or referenced in delivery logs",
        table: "events",
      },
      {
        step: 2,
        action: "SELECT subscribed endpoints",
        sql: `SELECT * FROM endpoints\nWHERE is_active = true\n  AND $1 = ANY(event_types)`,
        why: "Finds all active endpoints listening for this event type using PostgreSQL ANY()",
        table: "endpoints",
      },
      {
        step: 3,
        action: "INSERT delivery records (per endpoint)",
        sql: `INSERT INTO deliveries\n  (id, endpoint_id, event_id, status, attempt_number, max_attempts)\nVALUES\n  (gen_random_uuid(), $1, $2, 'pending', 0, 5)`,
        why: "One delivery row per endpoint — tracks the full lifecycle of each attempt",
        table: "deliveries",
      },
      {
        step: 4,
        action: "Push job to Redis queue",
        sql: `// Not a DB query — BullMQ\ndeliveryQueue.add('deliver', {\n  deliveryId, endpointId, eventId\n})`,
        why: "Fire-and-forget to queue — API returns 202 immediately without waiting",
        table: "redis",
      },
    ],
  },
  {
    trigger: "Background Worker",
    color: "#059669",
    bg: "#ecfdf5",
    icon: "⚙️",
    label: "Worker Delivers",
    queries: [
      {
        step: 1,
        action: "SELECT delivery + endpoint + event",
        sql: `SELECT * FROM deliveries WHERE id = $1\nSELECT * FROM endpoints  WHERE id = $1\nSELECT * FROM events     WHERE id = $1`,
        why: "Fetches all data needed to build the HTTP request — runs in parallel with Promise.all()",
        table: "deliveries / endpoints / events",
      },
      {
        step: 2,
        action: "UPDATE status → delivering",
        sql: `UPDATE deliveries\nSET status = 'delivering',\n    attempt_number = $1,\n    updated_at = NOW()\nWHERE id = $2`,
        why: "Marks in-progress so the dashboard shows live delivery state",
        table: "deliveries",
      },
      {
        step: 3,
        action: "HTTP POST to endpoint URL",
        sql: `// Not a DB query — axios\naxios.post(endpoint.url, payload, {\n  headers: { 'X-Webhook-Signature': hmac }\n})`,
        why: "Sends signed webhook. HMAC-SHA256 signature lets receiver verify authenticity",
        table: "external http",
      },
      {
        step: 4,
        action: "UPDATE status → success / failed",
        sql: `-- On success:\nUPDATE deliveries SET status='success',\n  response_code=$1, response_time_ms=$2,\n  delivered_at=NOW() WHERE id=$3\n\n-- On failure:\nUPDATE deliveries SET status='failed',\n  error_message=$1, next_retry_at=$2\n  WHERE id=$3`,
        why: "Records final outcome. On failure also sets next_retry_at for backoff scheduling",
        table: "deliveries",
      },
      {
        step: 5,
        action: "UPSERT endpoint_health",
        sql: `INSERT INTO endpoint_health (...)\nVALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)\nON CONFLICT (endpoint_id) DO UPDATE SET\n  health_status = EXCLUDED.health_status,\n  success_rate  = EXCLUDED.success_rate,\n  ...`,
        why: "Recalculates health after every attempt. Looks at last 10 deliveries to decide healthy/degraded/failing",
        table: "endpoint_health",
      },
    ],
  },
  {
    trigger: "POST /api/deliveries/:id/retry",
    color: "#d97706",
    bg: "#fffbeb",
    icon: "↺",
    label: "Manual Retry",
    queries: [
      {
        step: 1,
        action: "SELECT delivery",
        sql: `SELECT d.*, e.event_type FROM deliveries d\nJOIN events e ON d.event_id = e.id\nWHERE d.id = $1`,
        why: "Fetches delivery to validate it exists and is in a retryable state",
        table: "deliveries",
      },
      {
        step: 2,
        action: "UPDATE → reset to pending",
        sql: `UPDATE deliveries SET\n  status = 'pending',\n  attempt_number = 0,\n  error_message = NULL,\n  next_retry_at = NULL,\n  updated_at = NOW()\nWHERE id = $1`,
        why: "Resets delivery completely so worker treats it as a fresh attempt",
        table: "deliveries",
      },
      {//jobId: `manual-retry-${id}-${Date.now()}`
        step: 3,
        action: "Push to queue",
        sql: `deliveryQueue.add('deliver', {\n  deliveryId, endpointId, eventId\n}, {\n  jobId: 'manual-retry-{id}-{timestamp}'\n})`,
        why: "New job in Redis — worker picks it up immediately with no delay",
        table: "redis",
      },
    ],
  },
]

const BACKEND_FILES = [
  {
    path: "src/index.js",
    color: "#6366f1",
    role: "Entry Point",
    what: "Starts the Express server. Imports and boots the delivery worker. Registers SIGTERM/SIGINT handlers for graceful shutdown.",
    responsibilities: ["Start HTTP server on PORT", "Boot delivery worker process", "Graceful shutdown — waits for worker to finish"],
  },
  {
    path: "src/app.js",
    color: "#6366f1",
    role: "Express App",
    what: "Creates the Express app. Wires up all middleware and mounts all route handlers.",
    responsibilities: ["cors + json middleware", "Rate limiting middleware", "Mount /api/endpoints, /api/events, /api/deliveries", "Request logger middleware"],
  },
  {
    path: "src/db/pool.js",
    color: "#0891b2",
    role: "DB Connection",
    what: "Creates and exports a single shared PostgreSQL connection pool using pg. All queries across the app go through this pool.",
    responsibilities: ["Single pool instance shared app-wide", "Reads DB config from .env", "Handles connection reuse automatically"],
  },
  {
    path: "src/db/migrate.js",
    color: "#0891b2",
    role: "Schema Migration",
    what: "Creates all 4 database tables on first run. Uses IF NOT EXISTS so it's safe to run multiple times.",
    responsibilities: ["Create endpoints table", "Create events table", "Create deliveries table", "Create endpoint_health table + indexes"],
  },
  {
    path: "src/api/routes/endpoints.js",
    color: "#059669",
    role: "Endpoints API",
    what: "All CRUD for webhook endpoints. Handles registration, listing, updating, deleting, delivery logs per endpoint, and secret rotation.",
    responsibilities: ["POST / — register endpoint + generate secret", "GET / — list all with health JOIN", "PATCH /:id — partial update", "DELETE /:id — cascade deletes", "GET /:id/logs — paginated delivery history", "POST /:id/rotate-secret — new HMAC secret"],
  },
  {
    path: "src/api/routes/events.js",
    color: "#059669",
    role: "Events API",
    what: "Handles event triggering. Saves event, finds subscribed endpoints, creates delivery records, pushes to queue, returns 202.",
    responsibilities: ["POST /trigger — full trigger flow", "GET / — paginated event list", "GET /types — known event types from active endpoints"],
  },
  {
    path: "src/api/routes/deliveries.js",
    color: "#059669",
    role: "Deliveries API",
    what: "Read and manage delivery records. Stats, dead letter queue, and manual retry.",
    responsibilities: ["GET /stats — global counts + success rate", "GET /dead-letter — permanently failed", "GET / — filtered delivery list", "POST /:id/retry — reset + re-enqueue"],
  },
  {
    path: "src/workers/queue.js",
    color: "#d97706",
    role: "Queue Setup",
    what: "Creates the BullMQ queue and Redis connection. Exported and shared between the event trigger route and the worker.",
    responsibilities: ["IORedis connection to Redis", "BullMQ Queue named 'webhook-deliveries'", "Exported for use in events.js and deliveryWorker.js"],
  },
  {
    path: "src/workers/deliveryWorker.js",
    color: "#d97706",
    role: "Delivery Worker",
    what: "The background engine. Processes jobs from Redis queue. Sends HTTP requests, handles retries with exponential backoff, updates delivery status.",
    responsibilities: ["Dequeue job from Redis", "Fetch delivery + endpoint + event from DB", "Generate HMAC signature", "HTTP POST to endpoint URL", "On success → mark delivered", "On failure → backoff retry or permanently_failed", "Always update endpoint health after attempt"],
  },
  {
    path: "src/services/signature.js",
    color: "#7c3aed",
    role: "HMAC Signing",
    what: "Generates and verifies HMAC-SHA256 signatures. Used by the worker to sign every outgoing request.",
    responsibilities: ["generateSecret() — random 32-byte hex", "generateSignature(payload, secret) → sha256=...", "verifySignature() — timing-safe comparison"],
  },
  {
    path: "src/services/health.js",
    color: "#7c3aed",
    role: "Health Calculator",
    what: "Looks at last 10 deliveries for an endpoint and calculates health status. Called after every delivery attempt.",
    responsibilities: ["Query last 10 completed deliveries", "≥80% success → healthy", "40-79% → degraded, <40% → failing", "UPSERT endpoint_health table"],
  },
  {
    path: "src/services/logger.js",
    color: "#7c3aed",
    role: "Logger",
    what: "Winston logger instance shared across the app. Logs to console with timestamps.",
    responsibilities: ["Structured JSON logging", "info / warn / error / debug levels", "Used in worker, routes, services"],
  },
  {
    path: "src/middleware/rateLimiter.js",
    color: "#be185d",
    role: "Rate Limiter",
    what: "Two-tier rate limiting. General API limit and stricter limit on event triggering.",
    responsibilities: ["apiLimiter — 100 req/min on all routes", "triggerLimiter — 30 req/min on /events/trigger"],
  },
]

const FRONTEND_FILES = [
  {
    path: "ui/src/main.jsx",
    color: "#6366f1",
    role: "Entry Point",
    what: "Mounts the React app into the #root div in index.html.",
    responsibilities: ["ReactDOM.createRoot()", "Wraps app in StrictMode", "Imports global CSS"],
  },
  {
    path: "ui/src/App.jsx",
    color: "#6366f1",
    role: "Root Component",
    what: "Top-level layout. Renders the nav bar, handles tab switching between Dashboard and Dead Letters, controls the Trigger modal.",
    responsibilities: ["Tab state (dashboard / deadletter)", "Render nav bar", "Render active page component", "Open/close TriggerModal"],
  },
  {
    path: "ui/src/api.js",
    color: "#0891b2",
    role: "API Client",
    what: "Axios instance pointing to /api (proxied to localhost:3000 by Vite). Exports grouped API functions for endpoints, events, deliveries.",
    responsibilities: ["endpointsAPI — list, create, update, remove, logs, rotateSecret", "eventsAPI — trigger, types", "deliveriesAPI — stats, deadLetter, retry"],
  },
  {
    path: "ui/src/pages/Dashboard.jsx",
    color: "#059669",
    role: "Dashboard Page",
    what: "Main page. Shows 4 stat cards at the top, then the endpoints table. Auto-refreshes every 5 seconds. Controls Register and Logs modals.",
    responsibilities: ["Load endpoints + stats on mount", "Auto-refresh every 5s with setInterval", "Toggle endpoint active/inactive", "Delete endpoint", "Open RegisterModal", "Open LogsModal for selected endpoint"],
  },
  {
    path: "ui/src/pages/DeadLetter.jsx",
    color: "#059669",
    role: "Dead Letter Page",
    what: "Shows all permanently failed deliveries across all endpoints. Each row has a Retry button.",
    responsibilities: ["Fetch /deliveries/dead-letter on mount", "Display endpoint name, event type, error, attempts", "↺ Retry button calls POST /deliveries/:id/retry"],
  },
  {
    path: "ui/src/components/TriggerModal.jsx",
    color: "#d97706",
    role: "Trigger Modal",
    what: "Modal for manually triggering a webhook event. Lets you type an event type, enter a JSON payload, and fire it.",
    responsibilities: ["Fetch known event types for autocomplete", "Validate JSON payload before sending", "POST /events/trigger", "Show success with delivery count"],
  },
  {
    path: "ui/src/components/RegisterModal.jsx",
    color: "#d97706",
    role: "Register Modal",
    what: "Modal for registering a new webhook endpoint. Has preset event type chips, custom event input, and shows secret after success.",
    responsibilities: ["Name + URL + description inputs", "Toggle preset event type chips", "Add custom event types", "POST /api/endpoints", "Show one-time secret after registration"],
  },
  {
    path: "ui/src/components/LogsModal.jsx",
    color: "#7c3aed",
    role: "Logs Modal",
    what: "Shows delivery history for one endpoint. Paginated table with status filter. Each failed row has a Retry button.",
    responsibilities: ["GET /endpoints/:id/logs with pagination", "Filter by status (success/failed/etc)", "Show attempt number, response code, time, error", "↺ Retry on failed rows"],
  },
  {
    path: "ui/src/index.css",
    color: "#be185d",
    role: "Global Styles",
    what: "All CSS for the entire app. CSS variables, buttons, inputs, table, badges, modal, nav, cards, chips.",
    responsibilities: ["CSS variables (colors, spacing)", "Button variants (primary/secondary/danger)", "Badge colors per delivery status", "Table, card, modal, overlay styles", "Chip styles for event type selector"],
  },
  {
    path: "ui/vite.config.js",
    color: "#be185d",
    role: "Vite Config",
    what: "Vite dev server config. The proxy is the critical part — forwards all /api requests to the Express backend on port 3000.",
    responsibilities: ["React plugin", "/api → http://localhost:3000 proxy", "Runs UI on port 5173"],
  },
]

const tableColors = {
  "endpoints":                  { bg: "#eef2ff", color: "#4338ca", border: "#c7d2fe" },
  "events":                     { bg: "#ecfeff", color: "#0e7490", border: "#a5f3fc" },
  "deliveries":                 { bg: "#ecfdf5", color: "#065f46", border: "#6ee7b7" },
  "endpoint_health":            { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
  "redis":                      { bg: "#fef3c7", color: "#b45309", border: "#fcd34d" },
  "external http":              { bg: "#fdf4ff", color: "#7e22ce", border: "#e9d5ff" },
  "deliveries / endpoints / events": { bg: "#fff1f2", color: "#9f1239", border: "#fecdd3" },
}

export default function SystemDesign() {
  const [activeTab,   setActiveTab]   = useState("db")
  const [activeFlow,  setActiveFlow]  = useState(0)
  const [activeQuery, setActiveQuery] = useState(0)
  const [expandedBE,  setExpandedBE]  = useState(null)
  const [expandedFE,  setExpandedFE]  = useState(null)

  const flow  = DB_FLOWS[activeFlow]
  const query = flow.queries[activeQuery]
  const tc    = tableColors[query?.table] || { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" }

  return (
    <div style={{ fontFamily: "'DM Mono', 'Fira Code', monospace", background: "#0f0f13", minHeight: "100vh", color: "#e2e8f0" }}>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#a78bfa", letterSpacing: "0.05em" }}>
          ⚡ WEBHOOK ENGINE — SYSTEM DIAGRAMS
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["db", "DB Queries"], ["be", "Backend"], ["fe", "Frontend"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 12, fontFamily: "inherit",
              fontWeight: activeTab === id ? 700 : 400, cursor: "pointer", border: "none",
              background: activeTab === id ? "#a78bfa" : "#1e1e2e",
              color:      activeTab === id ? "#0f0f13" : "#6b7280",
              transition: "all 0.15s",
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── DB QUERIES TAB ── */}
      {activeTab === "db" && (
        <div style={{ padding: "24px 28px" }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 16, letterSpacing: "0.1em" }}>
            SELECT A FLOW TO SEE ITS DATABASE QUERIES
          </div>

          {/* Flow selector */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
            {DB_FLOWS.map((f, i) => (
              <button key={i} onClick={() => { setActiveFlow(i); setActiveQuery(0) }} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontFamily: "inherit",
                fontWeight: activeFlow === i ? 700 : 500, cursor: "pointer",
                border: `1px solid ${activeFlow === i ? f.color : "#2a2a3e"}`,
                background: activeFlow === i ? f.bg : "#1a1a2e",
                color: activeFlow === i ? f.color : "#9ca3af",
                transition: "all 0.15s",
              }}>
                {f.icon} {f.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>

            {/* Query list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 4 }}>
                SEQUENCE
              </div>
              {flow.queries.map((q, i) => (
                <button key={i} onClick={() => setActiveQuery(i)} style={{
                  padding: "10px 14px", borderRadius: 8, textAlign: "left",
                  fontFamily: "inherit", fontSize: 12, cursor: "pointer",
                  border: `1px solid ${activeQuery === i ? flow.color : "#2a2a3e"}`,
                  background: activeQuery === i ? "#1e1e2e" : "#14141f",
                  color: activeQuery === i ? "#e2e8f0" : "#6b7280",
                  transition: "all 0.15s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: "50%", display: "inline-flex",
                      alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
                      background: activeQuery === i ? flow.color : "#2a2a3e",
                      color: activeQuery === i ? "#fff" : "#6b7280", flexShrink: 0,
                    }}>{q.step}</span>
                    <span style={{ lineHeight: 1.3 }}>{q.action}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Query detail */}
            {query && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                {/* Table badge */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    padding: "3px 12px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                    background: tc.bg, color: tc.color, border: `1px solid ${tc.border}`,
                  }}>
                    TABLE: {query.table.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>Step {query.step} of {flow.queries.length}</span>
                </div>

                {/* SQL block */}
                <div style={{
                  background: "#0a0a12", border: "1px solid #2a2a3e",
                  borderRadius: 10, overflow: "hidden",
                }}>
                  <div style={{ padding: "8px 16px", background: "#14141f", borderBottom: "1px solid #2a2a3e", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f56" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27c93f" }} />
                    <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>{query.action}</span>
                  </div>
                  <pre style={{
                    margin: 0, padding: "16px", fontSize: 12, lineHeight: 1.7,
                    color: "#a5f3fc", overflowX: "auto", whiteSpace: "pre-wrap",
                  }}>
                    {query.sql.split('\n').map((line, i) => {
                      const kws = ['SELECT','INSERT','UPDATE','DELETE','FROM','WHERE','JOIN','INTO','VALUES','SET','ON','AND','OR','LIMIT','OFFSET','ORDER BY','GROUP BY','RETURNING','CONFLICT','DO UPDATE','FILTER','COUNT','ROUND','AVG','MAX','INTERVAL','NULLIF','EXCLUDED']
                      let colored = line
                      kws.forEach(kw => {
                        colored = colored.replace(new RegExp(`\\b${kw}\\b`, 'g'), `§${kw}§`)
                      })
                      return (
                        <span key={i}>
                          {colored.split('§').map((part, j) =>
                            kws.includes(part)
                              ? <span key={j} style={{ color: "#f0abfc", fontWeight: 700 }}>{part}</span>
                              : <span key={j}>{part}</span>
                          )}
                          {'\n'}
                        </span>
                      )
                    })}
                  </pre>
                </div>

                {/* Why box */}
                <div style={{
                  background: "#14141f", border: "1px solid #2a2a3e",
                  borderRadius: 10, padding: "14px 16px",
                }}>
                  <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 6 }}>
                    WHY THIS QUERY
                  </div>
                  <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
                    {query.why}
                  </div>
                </div>

                {/* Flow progress */}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {flow.queries.map((q, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div
                        onClick={() => setActiveQuery(i)}
                        style={{
                          width: i === activeQuery ? 28 : 8, height: 8, borderRadius: 99,
                          background: i <= activeQuery ? flow.color : "#2a2a3e",
                          cursor: "pointer", transition: "all 0.3s",
                        }}
                      />
                      {i < flow.queries.length - 1 && (
                        <div style={{ width: 20, height: 1, background: i < activeQuery ? flow.color : "#2a2a3e" }} />
                      )}
                    </div>
                  ))}
                  <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
                    {activeQuery + 1}/{flow.queries.length} queries
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BACKEND TAB ── */}
      {activeTab === "be" && (
        <div style={{ padding: "24px 28px" }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 20, letterSpacing: "0.1em" }}>
            CLICK ANY FILE TO SEE ITS RESPONSIBILITIES
          </div>

          {/* Layer labels */}
          {[
            { label: "ENTRY", files: ["src/index.js", "src/app.js"], color: "#6366f1" },
            { label: "DATABASE", files: ["src/db/pool.js", "src/db/migrate.js"], color: "#0891b2" },
            { label: "ROUTES", files: ["src/api/routes/endpoints.js", "src/api/routes/events.js", "src/api/routes/deliveries.js"], color: "#059669" },
            { label: "QUEUE + WORKER", files: ["src/workers/queue.js", "src/workers/deliveryWorker.js"], color: "#d97706" },
            { label: "SERVICES", files: ["src/services/signature.js", "src/services/health.js", "src/services/logger.js"], color: "#7c3aed" },
            { label: "MIDDLEWARE", files: ["src/middleware/rateLimiter.js"], color: "#be185d" },
          ].map(layer => (
            <div key={layer.label} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: layer.color, letterSpacing: "0.15em", fontWeight: 700, marginBottom: 8 }}>
                {layer.label}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {layer.files.map(path => {
                  const file = BACKEND_FILES.find(f => f.path === path)
                  if (!file) return null
                  const isOpen = expandedBE === path
                  return (
                    <div key={path} style={{ width: "100%" }}>
                      <button
                        onClick={() => setExpandedBE(isOpen ? null : path)}
                        style={{
                          width: "100%", textAlign: "left", padding: "12px 16px",
                          borderRadius: isOpen ? "8px 8px 0 0" : 8, fontFamily: "inherit",
                          cursor: "pointer", transition: "all 0.15s",
                          border: `1px solid ${isOpen ? file.color : "#2a2a3e"}`,
                          borderBottom: isOpen ? `1px solid ${file.color}` : undefined,
                          background: isOpen ? "#1a1a2e" : "#14141f",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                            background: file.color + "22", color: file.color, letterSpacing: "0.05em",
                          }}>
                            {file.role}
                          </span>
                          <span style={{ fontSize: 12, color: isOpen ? "#e2e8f0" : "#9ca3af", fontFamily: "inherit" }}>
                            {file.path}
                          </span>
                        </div>
                        <span style={{ color: "#6b7280", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {isOpen && (
                        <div style={{
                          background: "#1a1a2e", border: `1px solid ${file.color}`,
                          borderTop: "none", borderRadius: "0 0 8px 8px",
                          padding: "16px", display: "grid",
                          gridTemplateColumns: "1fr 1fr", gap: 16,
                        }}>
                          <div>
                            <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 8 }}>WHAT IT DOES</div>
                            <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.7 }}>{file.what}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 8 }}>RESPONSIBILITIES</div>
                            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                              {file.responsibilities.map((r, i) => (
                                <li key={i} style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8, display: "flex", gap: 8 }}>
                                  <span style={{ color: file.color, flexShrink: 0 }}>→</span>
                                  {r}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── FRONTEND TAB ── */}
      {activeTab === "fe" && (
        <div style={{ padding: "24px 28px" }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 20, letterSpacing: "0.1em" }}>
            CLICK ANY FILE TO SEE ITS RESPONSIBILITIES
          </div>

          {[
            { label: "ENTRY + ROUTING", files: ["ui/src/main.jsx", "ui/src/App.jsx"], color: "#6366f1" },
            { label: "API LAYER", files: ["ui/src/api.js"], color: "#0891b2" },
            { label: "PAGES", files: ["ui/src/pages/Dashboard.jsx", "ui/src/pages/DeadLetter.jsx"], color: "#059669" },
            { label: "COMPONENTS / MODALS", files: ["ui/src/components/TriggerModal.jsx", "ui/src/components/RegisterModal.jsx", "ui/src/components/LogsModal.jsx"], color: "#d97706" },
            { label: "STYLES + CONFIG", files: ["ui/src/index.css", "ui/vite.config.js"], color: "#be185d" },
          ].map(layer => (
            <div key={layer.label} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: layer.color, letterSpacing: "0.15em", fontWeight: 700, marginBottom: 8 }}>
                {layer.label}
              </div>
              {layer.files.map(path => {
                const file = FRONTEND_FILES.find(f => f.path === path)
                if (!file) return null
                const isOpen = expandedFE === path
                return (
                  <div key={path} style={{ marginBottom: 8 }}>
                    <button
                      onClick={() => setExpandedFE(isOpen ? null : path)}
                      style={{
                        width: "100%", textAlign: "left", padding: "12px 16px",
                        borderRadius: isOpen ? "8px 8px 0 0" : 8, fontFamily: "inherit",
                        cursor: "pointer", transition: "all 0.15s",
                        border: `1px solid ${isOpen ? file.color : "#2a2a3e"}`,
                        background: isOpen ? "#1a1a2e" : "#14141f",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: file.color + "22", color: file.color,
                        }}>
                          {file.role}
                        </span>
                        <span style={{ fontSize: 12, color: isOpen ? "#e2e8f0" : "#9ca3af", fontFamily: "inherit" }}>
                          {file.path}
                        </span>
                      </div>
                      <span style={{ color: "#6b7280", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                    </button>

                    {isOpen && (
                      <div style={{
                        background: "#1a1a2e", border: `1px solid ${file.color}`,
                        borderTop: "none", borderRadius: "0 0 8px 8px",
                        padding: "16px", display: "grid",
                        gridTemplateColumns: "1fr 1fr", gap: 16,
                      }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 8 }}>WHAT IT DOES</div>
                          <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.7 }}>{file.what}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 8 }}>RESPONSIBILITIES</div>
                          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                            {file.responsibilities.map((r, i) => (
                              <li key={i} style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8, display: "flex", gap: 8 }}>
                                <span style={{ color: file.color, flexShrink: 0 }}>→</span>
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}