const STRUCTURE = [
  {
    name: "webhook-engine/",
    type: "root",
    children: [
      {
        name: "src/",
        type: "folder",
        desc: "All backend source code",
        children: [
          {
            name: "index.js",
            type: "file",
            tag: "Entry",
            color: "#6366f1",
            desc: "Starts server + boots worker + graceful shutdown",
          },
          {
            name: "app.js",
            type: "file",
            tag: "Express",
            color: "#6366f1",
            desc: "Creates Express app, wires middleware + all routes",
          },
          {
            name: "db/",
            type: "folder",
            desc: "Database layer",
            children: [
              {
                name: "pool.js",
                type: "file",
                tag: "DB",
                color: "#0891b2",
                desc: "Shared PostgreSQL connection pool",
              },
              {
                name: "migrate.js",
                type: "file",
                tag: "DB",
                color: "#0891b2",
                desc: "Creates all 4 tables — endpoints, events, deliveries, endpoint_health",
              },
            ],
          },
          {
            name: "api/routes/",
            type: "folder",
            desc: "Express route handlers",
            children: [
              {
                name: "endpoints.js",
                type: "file",
                tag: "Route",
                color: "#059669",
                desc: "CRUD for webhook endpoints + secret rotation + delivery logs",
              },
              {
                name: "events.js",
                type: "file",
                tag: "Route",
                color: "#059669",
                desc: "Trigger events → save → find endpoints → create deliveries → push to queue",
              },
              {
                name: "deliveries.js",
                type: "file",
                tag: "Route",
                color: "#059669",
                desc: "Stats, dead letter queue, manual retry",
              },
            ],
          },
          {
            name: "workers/",
            type: "folder",
            desc: "Background job processing",
            children: [
              {
                name: "queue.js",
                type: "file",
                tag: "Queue",
                color: "#d97706",
                desc: "BullMQ queue + Redis connection — shared across app",
              },
              {
                name: "deliveryWorker.js",
                type: "file",
                tag: "Worker",
                color: "#d97706",
                desc: "Dequeues jobs → HTTP POST → HMAC sign → retry with backoff → update health",
              },
            ],
          },
          {
            name: "services/",
            type: "folder",
            desc: "Shared business logic",
            children: [
              {
                name: "signature.js",
                type: "file",
                tag: "Service",
                color: "#7c3aed",
                desc: "generateSecret(), generateSignature(), verifySignature()",
              },
              {
                name: "health.js",
                type: "file",
                tag: "Service",
                color: "#7c3aed",
                desc: "Calculates healthy/degraded/failing from last 10 deliveries",
              },
              {
                name: "logger.js",
                type: "file",
                tag: "Service",
                color: "#7c3aed",
                desc: "Winston logger instance shared across app",
              },
            ],
          },
          {
            name: "middleware/",
            type: "folder",
            desc: "Express middleware",
            children: [
              {
                name: "rateLimiter.js",
                type: "file",
                tag: "Middleware",
                color: "#be185d",
                desc: "apiLimiter (100/min) + triggerLimiter (30/min)",
              },
            ],
          },
        ],
      },
      {
        name: "ui/",
        type: "folder",
        desc: "React frontend (Vite)",
        children: [
          {
            name: "src/",
            type: "folder",
            desc: "Frontend source",
            children: [
              {
                name: "main.jsx",
                type: "file",
                tag: "Entry",
                color: "#6366f1",
                desc: "Mounts React app into #root",
              },
              {
                name: "App.jsx",
                type: "file",
                tag: "Root",
                color: "#6366f1",
                desc: "Nav bar, tab switching, TriggerModal control",
              },
              {
                name: "api.js",
                type: "file",
                tag: "API",
                color: "#0891b2",
                desc: "Axios client — endpointsAPI, eventsAPI, deliveriesAPI",
              },
              {
                name: "index.css",
                type: "file",
                tag: "Style",
                color: "#be185d",
                desc: "All global CSS — buttons, table, badges, modal, nav",
              },
              {
                name: "pages/",
                type: "folder",
                desc: "Full page components",
                children: [
                  {
                    name: "Dashboard.jsx",
                    type: "file",
                    tag: "Page",
                    color: "#059669",
                    desc: "Stats cards + endpoints table, auto-refreshes every 5s",
                  },
                  {
                    name: "DeadLetter.jsx",
                    type: "file",
                    tag: "Page",
                    color: "#059669",
                    desc: "All permanently_failed deliveries with retry button",
                  },
                  {
                    name: "SystemDiagram.jsx",
                    type: "file",
                    tag: "Page",
                    color: "#059669",
                    desc: "Interactive DB queries, backend + frontend architecture diagrams",
                  },
                  {
                    name: "Structure.jsx",
                    type: "file",
                    tag: "Page",
                    color: "#059669",
                    desc: "This file — project structure tree",
                  },
                ],
              },
              {
                name: "components/",
                type: "folder",
                desc: "Reusable modal components",
                children: [
                  {
                    name: "TriggerModal.jsx",
                    type: "file",
                    tag: "Modal",
                    color: "#d97706",
                    desc: "Fire a webhook event with custom payload",
                  },
                  {
                    name: "RegisterModal.jsx",
                    type: "file",
                    tag: "Modal",
                    color: "#d97706",
                    desc: "Register new endpoint + show one-time secret",
                  },
                  {
                    name: "LogsModal.jsx",
                    type: "file",
                    tag: "Modal",
                    color: "#d97706",
                    desc: "Paginated delivery logs per endpoint with retry",
                  },
                ],
              },
            ],
          },
          {
            name: "vite.config.js",
            type: "file",
            tag: "Config",
            color: "#be185d",
            desc: "Vite config — proxies /api to localhost:3000",
          },
        ],
      },
      {
        name: "docker-compose.yml",
        type: "file",
        tag: "Docker",
        color: "#0891b2",
        desc: "Redis container on port 6379",
      },
      {
        name: ".env",
        type: "file",
        tag: "Config",
        color: "#6b7280",
        desc: "DB credentials, Redis host, retry settings, timeouts",
      },
      {
        name: "package.json",
        type: "file",
        tag: "Config",
        color: "#6b7280",
        desc: "Dependencies + npm scripts: start, dev, migrate",
      },
      {
        name: "README.md",
        type: "file",
        tag: "Docs",
        color: "#16a34a",
        desc: "Architecture, setup, API reference, 4 improvements, scaling answer",
      },
    ],
  },
]

const FLOW_LINES = [
  { from: "index.js",          to: "app.js",              label: "imports" },
  { from: "index.js",          to: "deliveryWorker.js",   label: "boots" },
  { from: "app.js",            to: "endpoints.js",        label: "mounts /api/endpoints" },
  { from: "app.js",            to: "events.js",           label: "mounts /api/events" },
  { from: "app.js",            to: "deliveries.js",       label: "mounts /api/deliveries" },
  { from: "events.js",         to: "queue.js",            label: "pushes job" },
  { from: "deliveryWorker.js", to: "queue.js",            label: "reads from" },
  { from: "deliveryWorker.js", to: "signature.js",        label: "signs request" },
  { from: "deliveryWorker.js", to: "health.js",           label: "updates after delivery" },
  { from: "endpoints.js",      to: "signature.js",        label: "generates secret" },
  { from: "pool.js",           to: "endpoints.js",        label: "DB queries" },
  { from: "pool.js",           to: "events.js",           label: "DB queries" },
  { from: "pool.js",           to: "deliveries.js",       label: "DB queries" },
  { from: "pool.js",           to: "deliveryWorker.js",   label: "DB queries" },
  { from: "pool.js",           to: "health.js",           label: "DB queries" },
]

import { useState } from "react"

function FileTree({ nodes, depth = 0 }) {
  const [collapsed, setCollapsed] = useState({})

  function toggle(name) {
    setCollapsed(c => ({ ...c, [name]: !c[name] }))
  }

  return (
    <div>
      {nodes.map((node, i) => (
        <div key={i}>
          <div
            onClick={() => node.children && toggle(node.name)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 8px",
              marginLeft: depth * 20,
              borderRadius: 6,
              cursor: node.children ? "pointer" : "default",
              transition: "background 0.1s",
              borderLeft: depth > 0 ? "1px solid #2a2a3e" : "none",
              marginBottom: 2,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#1a1a2e"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            {/* Icon */}
            <span style={{ fontSize: 14, flexShrink: 0 }}>
              {node.children
                ? collapsed[node.name] ? "📁" : "📂"
                : node.name.endsWith(".js") || node.name.endsWith(".jsx")
                  ? "📄"
                  : node.name.endsWith(".css")
                    ? "🎨"
                    : node.name.endsWith(".md")
                      ? "📝"
                      : node.name.endsWith(".env") || node.name.endsWith(".yml") || node.name.endsWith(".json")
                        ? "⚙️"
                        : "📄"
              }
            </span>

            {/* Name */}
            <span style={{
              fontSize: 13,
              fontFamily: "'DM Mono', monospace",
              color: node.children ? "#e2e8f0" : "#cbd5e1",
              fontWeight: node.children ? 600 : 400,
            }}>
              {node.name}
            </span>

            {/* Tag */}
            {node.tag && (
              <span style={{
                padding: "1px 7px",
                borderRadius: 99,
                fontSize: 10,
                fontWeight: 700,
                background: node.color + "22",
                color: node.color,
                letterSpacing: "0.05em",
                flexShrink: 0,
              }}>
                {node.tag}
              </span>
            )}

            {/* Description */}
            {node.desc && (
              <span style={{
                fontSize: 11,
                color: "#6b7280",
                marginLeft: 4,
              }}>
                — {node.desc}
              </span>
            )}
          </div>

          {/* Children */}
          {node.children && !collapsed[node.name] && (
            <FileTree nodes={node.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function Structure() {
  const [tab, setTab] = useState("tree")

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Fira Code', monospace",
      background: "#0f0f13",
      minHeight: "100%",
      color: "#e2e8f0",
      margin: "-24px",
      borderRadius: 8,
      padding: 28,
    }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#a78bfa", marginBottom: 4 }}>
          📁 Project Structure
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Click folders to collapse/expand
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {[["tree", "File Tree"], ["flow", "Data Flow"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "6px 16px", borderRadius: 6, fontSize: 12,
            fontFamily: "inherit", fontWeight: tab === id ? 700 : 400,
            cursor: "pointer", border: "none",
            background: tab === id ? "#a78bfa" : "#1e1e2e",
            color: tab === id ? "#0f0f13" : "#6b7280",
            transition: "all 0.15s",
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* File Tree */}
      {tab === "tree" && (
        <div style={{
          background: "#0a0a12",
          border: "1px solid #2a2a3e",
          borderRadius: 10,
          padding: 20,
        }}>
          <FileTree nodes={STRUCTURE} />
        </div>
      )}

      {/* Data Flow */}
      {tab === "flow" && (
        <div>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 16, letterSpacing: "0.1em" }}>
            HOW FILES CONNECT TO EACH OTHER
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {FLOW_LINES.map((line, i) => (
              <div key={i} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "#0a0a12",
                border: "1px solid #2a2a3e",
                borderRadius: 8,
                padding: "10px 16px",
              }}>
                <span style={{
                  fontSize: 12,
                  color: "#a78bfa",
                  fontWeight: 600,
                  minWidth: 180,
                }}>
                  {line.from}
                </span>
                <span style={{ color: "#2a2a3e", fontSize: 18 }}>→</span>
                <span style={{
                  fontSize: 11,
                  color: "#6b7280",
                  background: "#1a1a2e",
                  padding: "2px 10px",
                  borderRadius: 99,
                  minWidth: 160,
                  textAlign: "center",
                }}>
                  {line.label}
                </span>
                <span style={{ color: "#2a2a3e", fontSize: 18 }}>→</span>
                <span style={{
                  fontSize: 12,
                  color: "#34d399",
                  fontWeight: 600,
                }}>
                  {line.to}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}