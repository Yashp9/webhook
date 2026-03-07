const crypto = require('crypto')

// Generate a random secret for a new endpoint
// This is given to the endpoint owner once — they use it to verify incoming webhook
function generateSecret(){
    return crypto.randomBytes(32).toString('hex')
}

//sign a payload woth a secret 
// worker calls this before sending each HTTP request

function generateSignature(payload,secret){
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)

    const hmac = crypto.createHmac('sha256',secret)

    hmac.update(body,'utf8')
    return `sha256=${hmac.digest('hex')}`
}

// Verify an incoming signature
// The endpoint owner calls this on their server to trust our request

function verifySignature(payload,signature,secret){
    const expected = generateSignature(payload,secret)
    try {
        return crypto.timingSafeEqual(
            Buffer.from(expected,'utf8'),
            Buffer.from(signature,'utf8')
        )
    } catch (error) {
        return false
    }
}

module.exports = {generateSecret,generateSignature,verifySignature,}

