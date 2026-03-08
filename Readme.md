# ⚡ Webhook Delivery Engine

A production-ready webhook delivery system with reliable event delivery,
exponential backoff retries, HMAC signature verification, and a real-time
monitoring dashboard.

---

## Project Overview

This system lets users register webhook endpoints and receive reliable
event deliveries. When an event is triggered, the system immediately queues
delivery jobs and returns — a background worker handles all HTTP delivery,
retries, and logging.

### Architecture
```
Client → Express API → PostgreSQL (store event)
                     → Redis Queue (enqueue job) → return 202 immediately
                              ↓
                       Delivery Worker
                              ↓
                       HTTP POST to endpoint URL
                       + HMAC-SHA256 signature header
                              ↓
                    Success → mark delivered
                    Failure → exponential backoff retry
                    5 fails → permanently_failed
```

### How The Delivery Engine Works

1. Event is triggered via POST /api/events/trigger
2. API finds all active endpoints subscribed to that event type
3. API creates one delivery record per endpoint in PostgreSQL
4. API pushes one job per endpoint into Redis queue
5. API returns 202 immediately — does not wait for delivery
6. Background worker picks up each job
7. Worker generates HMAC-SHA256 signature from payload + endpoint secret
8. Worker sends HTTP POST with signature header to endpoint URL
9. On non-2xx or timeout → re-enqueues with exponential backoff delay
10. After MAX_RETRY_ATTEMPTS → marks as permanently_failed

### Exponential Backoff Formula
```
delay = BASE_DELAY_MS × (2 ^ attemptNumber) + random_jitter

Attempt 1 failed → wait ~20s
Attempt 2 failed → wait ~40s
Attempt 3 failed → wait ~80s
Attempt 4 failed → wait ~160s
Attempt 5 failed → permanently_failed
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| API | Node.js + Express | Fast, you know it |
| Database | PostgreSQL | Relational, great for logs |
| Queue | Redis + BullMQ | Fast, handles retries |
| HTTP Client | Axios | Timeout support |
| Frontend | React + Vite | Component-based UI |

---

## Setup & Run

### Prerequisites
- Node.js 18+
- PostgreSQL (local)
- Redis (Docker or local)

### 1. Clone and install
```bash
git clone <your-repo>
cd webhook-engine
npm install
cd ui && npm install && cd ..
```

### 2. Create .env
```bash
cp .env.example .env
```

Fill in your local Postgres credentials.

### 3. Start Redis
```bash
docker run -d -p 6379:6379 --name webhook_redis redis:7-alpine
```

### 4. Create database and run migrations
```bash
# In psql
CREATE DATABASE webhook_engine;

# Then
npm run migrate
```

### 5. Start backend
```bash
npm run dev
```

### 6. Start frontend
```bash
cd ui
npm run dev
```

Open http://localhost:5173

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| PORT | 3000 | Server port |
| DB_HOST | localhost | PostgreSQL host |
| DB_NAME | webhook_engine | Database name |
| DB_USER | postgres | DB username |
| DB_PASSWORD | postgres | DB password |
| REDIS_HOST | localhost | Redis host |
| MAX_RETRY_ATTEMPTS | 5 | Max delivery attempts |
| BASE_RETRY_DELAY_MS | 10000 | Base backoff delay |
| DELIVERY_TIMEOUT_MS | 10000 | HTTP timeout per request |

---

## API Reference

### Endpoints
| Method | Path | Description |
|---|---|---|
| GET | /api/endpoints | List all endpoints |
| POST | /api/endpoints | Register new endpoint |
| PATCH | /api/endpoints/:id | Update endpoint |
| DELETE | /api/endpoints/:id | Delete endpoint |
| GET | /api/endpoints/:id/logs | Get delivery logs |
| POST | /api/endpoints/:id/rotate-secret | Rotate HMAC secret |

### Events
| Method | Path | Description |
|---|---|---|
| POST | /api/events/trigger | Trigger an event |
| GET | /api/events | List recent events |
| GET | /api/events/types | List known event types |

### Deliveries
| Method | Path | Description |
|---|---|---|
| GET | /api/deliveries/stats | Global stats |
| GET | /api/deliveries/dead-letter | Dead letter queue |
| POST | /api/deliveries/:id/retry | Retry failed delivery |

---

## Step-by-Step: Register → Trigger → Observe

### 1. Register an endpoint
```bash
curl -X POST http://localhost:3000/api/endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Service",
    "url": "http://localhost:4000/webhook",
    "event_types": ["payment.created"]
  }'
```

Save the secret from the response.

### 2. Trigger an event
```bash
curl -X POST http://localhost:3000/api/events/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "payment.created",
    "payload": { "amount": 4999, "order_id": "ORD-001" }
  }'
```

Returns 202 immediately.

### 3. Observe delivery
```bash
curl http://localhost:3000/api/endpoints/<id>/logs
```

Watch status change from pending → delivering → success.

### 4. Observe retries

Register an endpoint with URL https://httpbin.org/status/500
Trigger an event — watch it retry 5 times with increasing delays.
Final status: permanently_failed.

### 5. Manual retry
```bash
curl -X POST http://localhost:3000/api/deliveries/<delivery-id>/retry
```

---

## 4 Self-Initiated Improvements

### 1. Secret Rotation API
**Problem it solves:** If an HMAC secret is leaked or compromised,
the endpoint owner needs to generate a new one immediately without
losing their endpoint configuration.

**Implementation:** POST /api/endpoints/:id/rotate-secret generates
a fresh secret, updates the database, and returns the new secret once.
Mirrors how Stripe and GitHub handle webhook secret management.

### 2. Rate Limiting
**Problem it solves:** Without rate limiting, a single client could
flood the event trigger endpoint with thousands of fake events, filling
the Redis queue and overwhelming downstream servers.

**Implementation:** Two-tier rate limiting using express-rate-limit.
General API: 100 requests/minute. Event trigger endpoint: 30/minute.

### 3. Request Logging Middleware
**Problem it solves:** In production you need a full audit trail of
every API request for debugging, monitoring, and security investigation.

**Implementation:** Express middleware that logs every request with
method, path, status code, and response time using Winston structured logger.

### 4. Graceful Shutdown
**Problem it solves:** Without graceful shutdown, pressing Ctrl+C
kills the process mid-delivery. The delivery log shows "delivering"
forever and the endpoint never receives the webhook.

**Implementation:** Handles SIGTERM and SIGINT signals. Stops accepting
new requests, waits for the current worker job to finish, then cleanly
closes the DB pool and Redis connection before exiting.

---

## Bonus: Scaling to 100,000+ Events Per Minute

### Current Bottlenecks

**1. Single Redis instance**
One Redis handles all queue operations. At 100k/min that is ~1,667
jobs/second — Redis can handle this but becomes a single point of failure.

**2. Single worker process**
One Node.js worker with concurrency 10 means max 10 simultaneous
HTTP requests. At 100k/min you need ~1,667 deliveries/second — far
beyond one process.

**3. PostgreSQL write contention**
Every delivery attempt writes to the deliveries table. At high volume
this table gets millions of rows fast and insert/query performance degrades.

**4. No circuit breaker**
If one endpoint is completely down, the queue fills with jobs for that
endpoint — wasting worker time on guaranteed failures.

### What Would Change

**Replace BullMQ with Kafka**
Kafka handles millions of messages/second. Partition by endpoint_id
so jobs for the same endpoint are processed in order. Multiple consumer
groups can process independently.

**Horizontal worker scaling**
Run 20-50 worker containers behind Kafka consumer groups. Kubernetes
HPA scales workers up/down based on queue lag metric.

**Batch database writes**
Buffer delivery log inserts in memory and flush every 500ms in batches.
Reduces DB write pressure by 50x.

**Read replicas for dashboard**
All monitoring queries go to a Postgres read replica. Primary handles
only writes from the delivery worker.

**Circuit breaker per endpoint**
Track consecutive failures in Redis. If endpoint fails 5 times in a row
open the circuit — stop sending for 60 seconds, then probe with one request.
Prevents dead endpoints from clogging the queue.

**Partition deliveries table**
Partition by created_at monthly. Archive old partitions to cold storage.
Keeps query performance stable as table grows to billions of rows.
```

---

## Final Checklist Before Submitting
```
✅ Backend
   npm run dev starts without errors
   POST /api/endpoints works
   POST /api/events/trigger returns 202
   Worker delivers to test-server.js
   Retries work with backoff
   Health updates after delivery

✅ Frontend
   Dashboard loads at localhost:5173
   Can register endpoint from UI
   Can trigger event from UI
   Logs show delivery history
   Retry button works
   Dead letter page works

✅ README
   Architecture explanation
   Setup instructions
   API reference
   Step by step guide
   4 improvements with reasoning
   Bonus scaling answer

✅ 4 Improvements
   Secret rotation API
   Rate limiting
   Request logging
   Graceful shutdown
```

---

## You're Done 🎉
```
✅ Step 1  — Mental model
✅ Step 2  — Project setup
✅ Step 3  — Database schema
✅ Step 4  — Endpoints API
✅ Step 5  — Events API
✅ Step 6  — Redis Queue
✅ Step 7  — Delivery Worker
✅ Step 8  — Health + Deliveries API
✅ Step 9  — React UI
✅ Step 10 — 4 Improvements + README