const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()

app.use(cors())
app.use(express.json())

// Health check route — just to confirm server is alive
app.get('/health',(req,res)=>{
    res.json({status:"OK",time:new Date().toISOString()})
})

module.exports = app