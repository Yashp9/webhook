const winston = require('winston')

const logger = winston.createLogger({
    level:'debug',
    format:winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({timestamp,level,message,...meta})=>{
            const metaStr = Object.keys(meta).length?`\n${JSON.stringify(meta,null,2)}`:''
            return `[${timestamp}] ${level}: ${message}${metaStr}`
        })
    ),
    transports:[
        new winston.transports.Console(),
    ],
})

module.exports = logger