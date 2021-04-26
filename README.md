# nginx-replay
A simple tool for replaying requests from nginx log file to the custom server.

[![MIT License][license-image]][license-url]

## Installation

```
npm i -g https://github.com/egorvas/nginx-replay
```

## Usage

```
Usage of nginx-replay:

Options:
  -f, --filePath <path>                        path of the nginx logs file
  -p, --prefix <url>                           url for sending requests
  -r, --ratio <number>                         acceleration / deceleration rate of sending requests, eg: 2, 0.5 (default: "1")
  --format <string>                            format of the nginx log (default: "$remote_addr - $remote_user [$time_local] \"$request\" $status $body_bytes_sent \"$http_referer\" \"$http_user_agent\"")
  -d --debug                                   show debug messages in console (default: false)
  -l, --logFile <path>                         save results to the logs file (default: "")
  -t, --timeout <int>                          timeout fo the requests
  --username <string>                          username for basic auth
  --password <string>                          password  for basic auth
  --scaleMode                                  experimental mode for the changing requests order (default: false)
  --skipSleep                                  remove pauses between requests. Attention: will ddos your server (default: false)
  --skipSsl                                    skip ssl errors (default: false)
  -s, --stats                                  show stats of the requests (default: false)
  --deleteQueryStats <comma separated string>  delete some query for calculating stats, eg: "page,limit,size" (default: "")
  --statsOnlyPath                              keep only endpoints for showing stats (default: false)
  --hideStatsLimit <int>                       limit number of stats
  -h, --help                                   display help for command

```

```bash
# Replay access log
nginx-replay -f nginx-acces.log -p localhost -d -l out.log -s
```

## Output log format

Log is 5 spaces separated values:
```
replay-status   original-status   start-time-at-log   replay-start-time   duration   url

     403              200           1619052383000       1619433520324       0.32     /enpoint?page=1
```

* replay-status is integer
* original-status is integer
* start-time-at-log is unix timestamp in ms
* replay-start-time is unix timestamp in ms
* duration is in seconds
* url is string like in nginx log file

## What is stats?

Calculated list of top urls. You can hide some rare requests by passing hideStatsLimit option.
Also you can remove some or all query by passing deleteQueryStats or statsOnlyPath options.

## What is final info?

Some useful information and statistic about requests, rps, errors end etc.

## License

[MIT](LICENSE)

[license-url]: LICENSE

[license-image]: https://img.shields.io/github/license/mashape/apistatus.svg

[capture]: capture.png
