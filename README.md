# Productivity Statistics

## Introduction

This repository contains the Productivity Statistics plugin. It augments the `delegates` API endpoints within Core for ARK and ARK-powered blockchains by including statistics to display the number of missed rounds and slots for each delegate, along with a productivity score (`1 - missed ÷ forged`).

The time periods are fully configurable and, by default, there are daily (24 hours), weekly (7 days), monthly (30 days) and quarterly (90 days) statistics.

The statistics are generated and stored in a separate SQLite3 database. This is significantly more performant than running queries on the live Core PostgreSQL database and it also means the Core database remains untouched. However, there must be sufficient disk space to hold the database. The ARK Public Network, with a height of almost 10 million blocks, requires ~750 MB of disk space for the SQLite3 database.

## Installation

Execute the following:

```yarn global add @alessiodf/productivity-statistics```

Once the plugin is installed, we must configure it by modifying `plugins.js`. This file is found in `~/.config/ark-core/{mainnet|devnet|testnet|unitnet}/plugins.js` depending on network.

Add a new section to the `module.exports` block for the configuration options. **Add it as the last section inside the `module.exports` block, after all the other sections.** An example configuration using the default time periods is below:

```
    "@alessiodf/productivity-statistics": {
        "enabled": true
    }
```

If you wish to set up different time periods, see the Configuration Options section below.

## Running

After installation, make sure the `plugins.js` file is correctly configured and restart Core. If you are using the CLI, this will probably be `ark core:restart` (or `ark relay:restart` if you wish to use the separate processes rather than the unified Core), although `ark` may be different in the case of bridgechains. If using Core Control, run `ccontrol restart relay`.

The plugin will start whenever the Core or Relay process is running, as long as the `enabled` configuration option is `true`. When the process starts, historical productivity statistics will be calculated, which may take a few minutes to complete for the first run as it must calculate statistics from the genesis block until the current height. Periodic status updates will be printed to the console during this time. It takes approximately 15 minutes to calculate statistics for the ARK Public Network on first load, however future runs will append to the existing database so should only take a few seconds or less.

It is normal for the CPU usage to reach 100% during this calculation process, but this will not affect the node's ability to receive and process blocks.

Once calculated, statistics can be viewed using the `/api/delegates` endpoint as well as `/api/delegates/{username}` for statistics about a single delegate. Furthermore, `/api/delegates/{username}/missed/{slots|rounds}` will show the individual slots or rounds that were missed, including heights and timestamps.

Statistics are also continually updated in real time after every new block is applied.

Examples of some API calls are as follows:

`/api/delegates?limit=2`:

>[{"username":"biz_classic","address":"AKdr5d9AMEnsKYxpDcoHdyyjSCKVx3r9Nj","publicKey":"020431436cf94f3c6a6ba566fe9e42678db8486590c732ca6c3803a10a86f50b92","votes":"297493958946084","rank":1,"blocks":{"produced":168670,"last":{"id":"8693ad13751af253e27e7eec1d2bedcbd457e04cf31fd8c45e186c8b46984f32","height":9611717,"timestamp":{"epoch":78023800,"unix":1568125000,"human":"2019-09-10T14:16:40.000Z"}}},"production":{"approval":2.36},"forged":{"fees":"1173040419815","rewards":"33734000000000","total":"34907040419815"},"statistics":{"day":{"forged":213,"slots":{"missed":0,"productivity":1},"rounds":{"missed":0,"productivity":1}},"week":{"forged":1483,"slots":{"missed":0,"productivity":1},"rounds":{"missed":0,"productivity":1}},"month":{"forged":6353,"slots":{"missed":0,"productivity":1},"rounds":{"missed":0,"productivity":1}},"quarter":{"forged":19062,"slots":{"missed":5,"productivity":0.9997376980379813},"rounds":{"missed":4,"productivity":0.9997901584303851}},"year":{"forged":76517,"slots":{"missed":774,"productivity":0.9898846008076636},"rounds":{"missed":43,"productivity":0.9994380333782036}}}},{"username":"biz_private","address":"AaAy8BZkjV86YN7xUtZ35iwyXRMQKtKoAy","publicKey":"02fa6902e91e127d6d3410f6abc271a79ae24029079caa0db5819757e3c1c1c5a4","votes":"198969760676414","rank":2,"blocks":{"produced":142492,"last":{"id":"ce6281712e223a3e377799895437509ffecff7a4f459d61028e098bcc250fefc","height":9611783,"timestamp":{"epoch":78024328,"unix":1568125528,"human":"2019-09-10T14:25:28.000Z"}}},"production":{"approval":1.58},"forged":{"fees":"1909120101399","rewards":"28498400000000","total":"30407520101399"},"statistics":{"day":{"forged":213,"slots":{"missed":0,"productivity":1},"rounds":{"missed":0,"productivity":1}},"week":{"forged":1482,"slots":{"missed":1,"productivity":0.9993252361673415},"rounds":{"missed":1,"productivity":0.9993252361673415}},"month":{"forged":6352,"slots":{"missed":5,"productivity":0.9992128463476071},"rounds":{"missed":5,"productivity":0.9992128463476071}},"quarter":{"forged":19025,"slots":{"missed":41,"productivity":0.9978449408672799},"rounds":{"missed":36,"productivity":0.998107752956636}},"year":{"forged":76437,"slots":{"missed":841,"productivity":0.9889974750448082},"rounds":{"missed":101,"productivity":0.9986786503918259}}}}]


This shows the productivity statistics for the top 2 delegates by rank.

Similarly for an individual delegate:

`/api/delegates/therock`:

>{"username":"therock","address":"AJC9TuRXGxmqiCs3wmtt9CowfC8s2vMhEF","publicKey":"023a4015f921d8d0248f40362db44e856769a7291224cbd8f2fc14d61be2138174","votes":"705206420619","rank":71,"blocks":{"produced":167891,"last":{"id":"f28a5d9b90a5397c867ba1e01e73a2d2a7e86cc5ac0637cb4fdf456686a7369b","height":9393698,"timestamp":{"epoch":76279200,"unix":1566380400,"human":"2019-08-21T09:40:00.000Z"}}},"production":{"approval":0.01},"forged":{"fees":"315609079238","rewards":"33578200000000","total":"33893809079238"},"statistics":{"day":{"forged":0,"slots":{"missed":0,"productivity":0},"rounds":{"missed":0,"productivity":0}},"week":{"forged":0,"slots":{"missed":0,"productivity":0},"rounds":{"missed":0,"productivity":0}},"month":{"forged":2078,"slots":{"missed":0,"productivity":1},"rounds":{"missed":0,"productivity":1}},"quarter":{"forged":14712,"slots":{"missed":79,"productivity":0.9946302338227297},"rounds":{"missed":70,"productivity":0.995241979336596}},"year":{"forged":70495,"slots":{"missed":2543,"productivity":0.9639265196113199},"rounds":{"missed":1964,"productivity":0.97213986807575}}}}

Here we can see the productivity statistics for `therock`.

If we want to go deeper, we can see the individual rounds or slots missed by a delegate:

`/api/delegates/doc/missed/rounds`:

>[{"height":163954,"timestamp":{"epoch":1350816,"unix":1491452016,"human":"2017-04-06T04:13:36.000Z"}},{"height":163993,"timestamp":{"epoch":1351136,"unix":1491452336,"human":"2017-04-06T04:18:56.000Z"}},{"height":164032,"timestamp":{"epoch":1351456,"unix":1491452656,"human":"2017-04-06T04:24:16.000Z"}},{"height":164116,"timestamp":{"epoch":1352136,"unix":1491453336,"human":"2017-04-06T04:35:36.000Z"}},{"height":164131,"timestamp":{"epoch":1352264,"unix":1491453464,"human":"2017-04-06T04:37:44.000Z"}},{"height":164181,"timestamp":{"epoch":1352672,"unix":1491453872,"human":"2017-04-06T04:44:32.000Z"}},{"height":164231,"timestamp":{"epoch":1353080,"unix":1491454280,"human":"2017-04-06T04:51:20.000Z"}},{"height":164312,"timestamp":{"epoch":1353736,"unix":1491454936,"human":"2017-04-06T05:02:16.000Z"}},{"height":265305,"timestamp":{"epoch":2165936,"unix":1492267136,"human":"2017-04-15T14:38:56.000Z"}},{"height":1168470,"timestamp":{"epoch":9409952,"unix":1499511152,"human":"2017-07-08T10:52:32.000Z"}},{"height":1295906,"timestamp":{"epoch":10434176,"unix":1500535376,"human":"2017-07-20T07:22:56.000Z"}},{"height":1462009,"timestamp":{"epoch":11765896,"unix":1501867096,"human":"2017-08-04T17:18:16.000Z"}},{"height":1897737,"timestamp":{"epoch":15266096,"unix":1505367296,"human":"2017-09-14T05:34:56.000Z"}},{"height":1961858,"timestamp":{"epoch":15789640,"unix":1505890840,"human":"2017-09-20T07:00:40.000Z"}},{"height":1961898,"timestamp":{"epoch":15789984,"unix":1505891184,"human":"2017-09-20T07:06:24.000Z"}},{"height":1961941,"timestamp":{"epoch":15790344,"unix":1505891544,"human":"2017-09-20T07:12:24.000Z"}},{"height":1961995,"timestamp":{"epoch":15790824,"unix":1505892024,"human":"2017-09-20T07:20:24.000Z"}},{"height":1962033,"timestamp":{"epoch":15791144,"unix":1505892344,"human":"2017-09-20T07:25:44.000Z"}},{"height":1962114,"timestamp":{"epoch":15791848,"unix":1505893048,"human":"2017-09-20T07:37:28.000Z"}},{"height":1962163,"timestamp":{"epoch":15792264,"unix":1505893464,"human":"2017-09-20T07:44:24.000Z"}},{"height":1962206,"timestamp":{"epoch":15792640,"unix":1505893840,"human":"2017-09-20T07:50:40.000Z"}},{"height":1962259,"timestamp":{"epoch":15793104,"unix":1505894304,"human":"2017-09-20T07:58:24.000Z"}}]

We can see the height and timestamps of all the missed rounds. By changing `rounds` to `slots` in the above API call the missed slots would be returned instead.

## Slots vs rounds

Most people use the term "missed block" but that is terminology is ambiguous:

Core versions 2.5 and below define a "missed block" as one where a delegate does not forge within the current round. That means, for example, if a delegate is due to forge first in a round but fails to do so, it will get another chance to forge later at the end of the round, and if it forges successfully the second time, it is not considered to have missed a block. Similarly, that delegate will remain green on the explorer and will only be considered to have missed a block if it did not forge at all in the round. This is the definition of a _missed round_ within this plugin.

Core versions 2.6 onwards instead refer to a "missed block" as an incident where a delegate fails to forge within its designated slot, even if it forges successfully later in the same round. This is the definition of a _missed slot_ within this plugin.

Due to the conflicting definitions of "missed block", this plugin avoids that term in its API responses and explicitly refers to missed _rounds_ and _slots_ instead.

## Configuration Options

- `enabled` - Should be `true` to enable the plugin or `false` to disable it. Default: `false`.

- `statistics` - An object containing the granular timescales for the productivity statistics. Examples of some statistics are below:

```
week: {
    time: 604800,
    type: "rolling"
}
```

This will create a new productivity metric called `week` which is calculated by looking back over the last 604800 seconds, which equates to 7 days. The `rolling` type means this refers to the last 604800 seconds on a rolling basis. Contrast with the `exact` type as shown below:

```
thisyear: {
    time: 1546300800,
    type: "exact"
}
```

This would calculate productivity statistics for a metric called `thisyear` which would show statistics since the start of 2019, since the `exact` type means that it will calculate all blocks since the UNIX timestamp stipulated in the `time` value, and 1546300800 is the timestamp for 2019-01-01 00:00:00 UTC.

Note that it is not recommended to create a metric that shows productivity statistics for all time on a publicly accessible API as it may incentivise attackers to target certain delegates with the intention of permanently ruining their productivity statistics. Network outages would also permanently damage such statistics. However, the option remains available for those who may need it.

## Credits

-   [All Contributors](../../contributors)
-   [alessiodf](https://github.com/alessiodf)

## License

[GPLv3](LICENSE) © [alessiodf](https://github.com/alessiodf)