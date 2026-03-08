const { Queue, QueueEvents } = require("bullmq");

const IORedis = require('ioredis');
const logger = require('../services/logger');
// console.log/error imports unused, drop them


// ── REDIS CONNECTION ────────────────────────────────────────────────
// maxRetriesPerRequest: null is REQUIRED by BullMQ
// Without it BullMQ throws an error

const connection = new IORedis({
    host:process.env.REDIS_HOST || 'localhost',
    port:parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest:null,
})

connection.on('connect',()=>{
    logger.info('Redis connected')
})

connection.on('error',(err)=>{
    logger.error('Redis connection error',{error: err.message});
});



//---------- THE QUEUE ------------------------
// Named channel where jobs live
//--- pipeline between API and worker------------

const deliveryQueue = new Queue('webhook-deliveries',{
    connection,
    defaultJobOptions:{
        removeOnComplete:100, // Keep last 100 completed jobs in Redis
        removeOnFail:500,  // Keep last 500 failed jobs in Redis
    }
})

logger.info('Delivery queue ready')

module.exports = {deliveryQueue,connection}