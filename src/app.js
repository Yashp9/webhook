const express = require('express')
const cors = require('cors')
require('dotenv').config()
const  endpointsRouter = require('./api/routes/endpoint')

const app = express()

app.use(cors())
app.use(express.json())

//Routes
app.use('/api/endpoints',endpointsRouter)

// Health check route — just to confirm server is alive
app.get('/health',(req,res)=>{
    res.json({status:"OK",time:new Date().toISOString()})
})

module.exports = app