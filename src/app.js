const express = require('express')
const cors = require('cors')
require('dotenv').config()
const  endpointsRouter = require('./api/routes/endpoint')
const eventRouter = require('./api/routes/events')
const deliveriesRouter = require('./api/routes/deliveries')

const app = express()

app.use(
  cors({
    origin: "http://localhost:5174",
  })
);
app.use(express.json())

//Routes
app.use('/api/endpoints',endpointsRouter)
app.use('/api/events',eventRouter)
app.use('/api/deliveries', deliveriesRouter)

// Health check route — just to confirm server is alive
app.get('/health',(req,res)=>{
    res.json({status:"OK",time:new Date().toISOString()})
})

module.exports = app