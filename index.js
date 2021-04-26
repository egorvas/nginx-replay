#!/usr/bin/env node
const Moment = require('moment');
const fs = require('fs');
const NginxParser = require('nginxparser');
const axios = require('axios').default;
const https = require('https');
const Winston = require('winston');
const { program } = require('commander');
program.version(process.env.npm_package_version);

const defaultFormat = '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';

program
    .requiredOption('-f, --filePath <path>', 'path of the nginx logs file')
    .requiredOption('-p, --prefix <url>', 'url for sending requests')
    .option('-r, --ratio <number>', 'acceleration / deceleration rate of sending requests, eg: 2, 0.5', '1')
    .option('--format <string>', 'format of the nginx log', defaultFormat)
    .option('-d --debug', 'show debug messages in console', false)
    .option('-l, --logFile <path>', 'save results to the logs file', '')
    .option('-t, --timeout <int>', 'timeout fo the requests')
    .option('--username <string>', 'username for basic auth')
    .option('--password <string>', 'password  for basic auth')
    .option('--scaleMode', 'experimental mode for the changing requests order', false)
    .option('--skipSleep', 'remove pauses between requests. Attention: will ddos your server', false)
    .option('--skipSsl', 'skip ssl errors', false)
    .option('-s, --stats', 'show stats of the requests', false)
    .option('--deleteQueryStats <comma separated string>', 'delete some query for calculating stats, eg: "page,limit,size"', '')
    .option('--statsOnlyPath', 'keep only endpoints for showing stats', false)
    .option('--hideStatsLimit <int>', 'limit number of stats');

program.parse(process.argv);
const args = program.opts();
Object.entries(args).forEach(arg => {
    if (typeof arg[1] === "string" && arg[1].startsWith('=')) args[arg[0]]=arg[1].replace('=','');
})

const parser = new NginxParser(args.format);
const debugLogger = Winston.createLogger({
    format: Winston.format.simple(),
    silent: !args.debug,
    transports: [
        new Winston.transports.Console(),
    ]
});

const mainLogger = Winston.createLogger({
    format: Winston.format.simple(),
    transports: [
        new Winston.transports.Console(),
    ]
});

let resultLoggerTransports = [
    new Winston.transports.Console({
        level: 'info',
        format: Winston.format.combine(
            Winston.format.colorize(),
            Winston.format.printf(
                (info) => {
                    return `${info.message}`;
                })
        )
    }),
];
if (args.logFile !== '') {
    resultLoggerTransports.push(new Winston.transports.File({
        filename: args.logFile,
        level: 'info',
        format: Winston.format.combine(
            Winston.format.colorize(),
            Winston.format.printf(
                (info) => {
                    return `${info.message}`;
                })
        )
    }));
}

const resultLogger = Winston.createLogger({
    format: Winston.format.simple(),
    transports: resultLoggerTransports,
});

const dataArray = [];
let numberOfSuccessfulEvents = 0;
let numberOfFailedEvents = 0;
let totalResponseTime = 0;
let startTime = 0;
let finishTime = 0;
let totalSleepTime = 0;

const deleteQuery = args.deleteQueryStats.split(",");
const stats = {};

fs.access(args.filePath, fs.F_OK, (err) => {
    if (err){
        mainLogger.error(`Cannot find file ${args.filePath}`);
        process.exit(1);
    }
});

if (args.logFile){
    if (args.logFile === args.filePath){
        mainLogger.error(`logFile can not be equal to filePath`);
        process.exit(1);
    }
    if (fs.existsSync(args.logFile)) fs.unlinkSync(args.logFile);
}

const secondsRepeats = {};
parser.read(args.filePath, function (row) {
    const timestamp = formatTime(row.time_local) * 1000;
    dataArray.push({
        agent: row.http_user_agent,
        status: row.status,
        req: row.request,
        timestamp
    });
    if (args.scaleMode){
        secondsRepeats[timestamp]?secondsRepeats[timestamp]+=1:secondsRepeats[timestamp]=1;
    }
}, async function (err) {
    if (err) throw err;
    startTime = +new Date();
    for (let i = 0; i < dataArray.length; i++) {
        const now = +new Date();
        if (i===dataArray.length-1) finishTime = now;
        let requestMethod = dataArray[i].req.split(" ")[0];
        let requestUrl = dataArray[i].req.split(" ")[1];
        debugLogger.info(`Sending ${requestMethod} request to ${requestUrl} at ${now}`);
        if (args.stats){
            let statsUrl = new URL(args.prefix+requestUrl);
            if (args.statsOnlyPath){
                statsUrl = statsUrl.pathname;
            }else{
                deleteQuery.forEach(query=> statsUrl.searchParams.delete(query));
                statsUrl = statsUrl.toString().replace(args.prefix, "");
            }
            stats[statsUrl]?stats[statsUrl]+=1:stats[statsUrl]=1;
        }
        sendRequest(requestMethod, requestUrl, now, dataArray[i].agent, dataArray[i].status, dataArray[i].timestamp);
        if (!args.skipSleep && dataArray[i].timestamp !== dataArray[dataArray.length - 1].timestamp){
            if (args.scaleMode){
                const timeToSleep = (Number((1000/secondsRepeats[dataArray[i].timestamp]).toFixed(0)) +
                    (dataArray[i].timestamp===dataArray[i+1].timestamp? 0 : (dataArray[i + 1].timestamp - dataArray[i].timestamp - 1000))) / args.ratio;
                totalSleepTime += timeToSleep;
                debugLogger.info(`Sleeping ${timeToSleep} ms`);
                await sleep(timeToSleep);
            }else{
                if (dataArray[i].timestamp !== dataArray[i + 1].timestamp){
                    const timeToSleep = ((dataArray[i + 1].timestamp - dataArray[i].timestamp) / args.ratio);
                    debugLogger.info(`Sleeping ${timeToSleep} ms`);
                    totalSleepTime += timeToSleep;
                    await sleep(timeToSleep);
                }
            }
        }
    }
});


function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function formatTime(nTime) {
    let timeSplit = nTime.split(" ")[0].split(":");
    return Moment(timeSplit[0], "DD/MMM/YYYY").hours(Number(timeSplit[1])).minutes(Number(timeSplit[2])).seconds(Number(timeSplit[3])).unix();
}

function sendRequest(method, url, sendTime, agent, originalStatus, timestamp) {
    const httpsAgent = new https.Agent({
        rejectUnauthorized: !args.skipSsl
    });
    let config = {httpsAgent, method, url:args.prefix+url};
    if (args.username) config.auth.username = args.username;
    if (args.password) config.auth.password = args.password;
    if (args.timeout) config.timeout = args.timeout;
    if (agent) config.headers = {'User-Agent': agent};
    axios(config)
        .then(function (response) {
            debugLogger.info(`Response for ${url} with status code ${response.status} done with ${+new Date() - sendTime} ms`)
            if (originalStatus !== response.status.toString()) {
                debugLogger.info(`Response for ${url} has different status code: ${response.status} and ${originalStatus}`);
                numberOfFailedEvents += 1;
            } else {
                numberOfSuccessfulEvents += 1;
            }
            let responseTime = +new Date() - sendTime;
            totalResponseTime += responseTime;
            resultLogger.info(`${response.status}     ${originalStatus}     ${timestamp}     ${sendTime}     ${(responseTime/1000).toFixed(2)}     ${url}`)
        })
        .catch(function (error) {
            if (!error.response) {
                mainLogger.error(`Invalid request to ${url} : ${error}`)
                numberOfFailedEvents += 1;
            } else {
                if (originalStatus !== error.response.status.toString()) {
                    debugLogger.info(`Response for ${url} has different status code: ${error.response.status} and ${originalStatus}`);
                    numberOfFailedEvents += 1;
                } else {
                    numberOfSuccessfulEvents += 1;
                }
                let responseTime = +new Date() - sendTime;
                totalResponseTime += responseTime;
                resultLogger.info(`${error.response.status}     ${originalStatus}     ${timestamp}     ${sendTime}     ${(responseTime/1000).toFixed(2)}     ${url}`)
            }
        }).then(function () {
        if (numberOfFailedEvents + numberOfSuccessfulEvents === dataArray.length) {
            mainLogger.info('___________________________________________________________________________');
            mainLogger.info(`Total number of events: ${dataArray.length}. Number of the failed events: ${numberOfFailedEvents}. Percent of the successful events: ${(100 * numberOfSuccessfulEvents / dataArray.length).toFixed(2)}%.`);
            mainLogger.info(`Total response time: ${(totalResponseTime/1000).toFixed(2)} seconds. Total requests time: ${(finishTime-startTime)/1000} seconds. Total sleep time: ${(totalSleepTime/1000).toFixed(2)} seconds.`);
            mainLogger.info(`Original time: ${(dataArray[dataArray.length-1].timestamp-dataArray[0].timestamp)/1000} seconds. Original rps: ${(1000*dataArray.length/(dataArray[dataArray.length-1].timestamp-dataArray[0].timestamp)).toFixed(4)}. Replay rps: ${(dataArray.length*1000/(finishTime-startTime)).toFixed(4)}.`);
            if (args.getStats){
                const hiddenStats = {};
                let sortedStats = Object.keys(stats).sort((a, b) => stats[b] - stats[a]);
                mainLogger.info('___________________________________________________________________________');
                mainLogger.info('Stats results:');
                sortedStats.forEach(x=>{
                    if (stats[x]>args.hideStatsLimit){
                        mainLogger.info(`${x} : ${stats[x]}`)
                    }else{
                        hiddenStats[stats[x]]?hiddenStats[stats[x]]+=1:hiddenStats[stats[x]]=1;
                    }
                });
                if (Object.keys(hiddenStats)>0) mainLogger.info(`Hidden stats: ${JSON.stringify(hiddenStats)}`);
            }

        }
    });
}