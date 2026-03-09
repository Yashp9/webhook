const http = require('http')
const crypto = require('crypto')

// ── CONFIG ──────────────────────────────────────────────────────────
const PORT = 4000

// Paste your endpoint secret here after you register it
// You get this from the POST /api/endpoints response
const SECRET = '87199b76cfe2b016f4b7f8a072e427eb1826563352dc0a4cc6c2bdc011367c9b'

// ── SIGNATURE VERIFIER ──────────────────────────────────────────────
function verifySignature(body, signatureHeader) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signatureHeader)
    )
  } catch {
    return false
  }
}

// ── SERVER ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // Only handle POST /webhook
  if (req.method === 'POST' && req.url === '/order') {

    let body = ''

    // Collect the request body
    req.on('data', chunk => { body += chunk.toString() })

    req.on('end', () => {
      console.log('\n========================================')
      console.log('Webhook Received!')
      console.log('========================================')

      // Show all headers
      console.log('\n Headers:')
      console.log('  Content-Type:        ', req.headers['content-type'])
      console.log('  X-Webhook-Signature: ', req.headers['x-webhook-signature'])
      console.log('  X-Webhook-ID:        ', req.headers['x-webhook-id'])
      console.log('  X-Webhook-Timestamp: ', req.headers['x-webhook-timestamp'])
      console.log('  X-Webhook-Attempt:   ', req.headers['x-webhook-attempt'])

      // Verify signature
      const signature = req.headers['x-webhook-signature']
      const isValid = verifySignature(body, signature)

      console.log('\nSignature Valid:', isValid ? 'YES' : ' NO')

      // Show the body
      try {
        const parsed = JSON.parse(body)
        console.log('\n Payload:')
        console.log('  Event Type: ', parsed.type)
        console.log('  Event ID:   ', parsed.id)
        console.log('  Timestamp:  ', parsed.timestamp)
        console.log('  Data:       ', JSON.stringify(parsed.payload, null, 2))
      } catch {
        console.log('\n Raw Body:', body)
      }

      console.log('\n========================================\n')

      // Return 200 so webhook engine marks it as success
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ received: true }))
    })

  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`\nTest webhook server running on http://localhost:${PORT}`)
  console.log(` Listening for webhooks at http://localhost:${PORT}/webhook`)
  console.log(`\nRegister this URL in your webhook engine:`)
  console.log(`  http://localhost:4000/webhook\n`)
})