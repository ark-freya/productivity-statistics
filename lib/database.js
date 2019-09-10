class Database {
    constructor (app) {
        this.databasePath = `${process.env.CORE_PATH_DATA}/productivity-statistics.sqlite`;
        this.logger = app.resolvePlugin("logger");
        this.cache = {};
        setInterval(() => {
            const now = new Date().getTime() / 1000;
            for(const key in this.cache) {
                const cachedObject = this.cache[key];
                if (now - cachedObject.time > 3600) {
                    this.purgeCache(key);
                }
            }
        }, 900000);
    };

    getCache (key) {
        return this.cache[key];
    };

    getGeneratorAtHeight (height) {
        const response = this.database.prepare("SELECT delegate FROM forged_blocks WHERE height = ?").pluck().get(height);
        return response ? response : "";
    };

    getHeight () {
        const response = this.database.prepare("SELECT height FROM forged_blocks ORDER BY height DESC LIMIT 1").pluck().get();
        return response ? response : 0;
    };

    getMissed (type, username, height) {
        const result = [];
        if (type === "slots") {
            result.push(...this.database.prepare("SELECT height, timestamp FROM missed_blocks WHERE delegate = ?").all(username));
        } else {
            result.push(...this.database.prepare("SELECT missed_blocks.height, missed_blocks.timestamp FROM missed_blocks LEFT OUTER JOIN forged_blocks ON missed_blocks.delegate = forged_blocks.delegate AND missed_blocks.round = forged_blocks.round WHERE missed_blocks.delegate = ? AND missed_blocks.height < ? AND forged_blocks.delegate IS NULL").all(username, height));
        }
        return result;
    };

    getStatistics (username, statistics, height, Slots, force = false) {
        if (!force) {
            const cache = this.getCache(username);
            if (cache && cache.data) {
                return cache.data;
            }
        }
        const now = Slots.getTime();
        const forgedQuery = this.database.prepare("SELECT COUNT() FROM forged_blocks WHERE delegate = ? AND timestamp >= ?").pluck();
        const missedQuery = {
            slots: this.database.prepare("SELECT COUNT() FROM missed_blocks WHERE delegate = ? AND timestamp >= ?").pluck(),
            rounds: this.database.prepare("SELECT COUNT() FROM missed_rounds WHERE delegate = ? AND timestamp > ? AND height < ?").pluck()
        };
        const types = ["slots", "rounds"];
        const response = {};
        if (statistics && typeof statistics === "object") {
            Object.keys(statistics).forEach(key => {
                const metric = statistics[key];
                if (typeof metric.time === "number" && ["exact", "rolling"].includes(metric.type)) {
                    const timestamp = metric.type === "exact" ? Slots.getTime(metric.time * 1000) : now - metric.time;
                    const forged = forgedQuery.get(username, timestamp);
                    response[key] = { forged };
                    for(const type of types) {
                        const missed = type === "slots" ? missedQuery[type].get(username, timestamp) : missedQuery[type].get(username, timestamp, height);
                        const productivityCalculation = 1 - (missed / forged);
                        const productivity = productivityCalculation > 0 ? productivityCalculation : 0;
                        response[key][type] = {
                            missed,
                            productivity
                        };
                    }
                }
            });
        }
        this.setCache(username, { data: response, time: new Date().getTime() / 1000 });
        return response;
    };

    init () {
        const SQLite3 = require("better-sqlite3");
        this.database = new SQLite3(this.databasePath);
        this.database.exec(`
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS forged_blocks (round INTEGER NOT NULL, height INTEGER NOT NULL PRIMARY KEY, delegate TEXT NOT NULL, timestamp NUMERIC NOT NULL) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS missed_blocks (round INTEGER NOT NULL, height INTEGER NOT NULL, delegate TEXT NOT NULL, timestamp NUMERIC PRIMARY KEY NOT NULL) WITHOUT ROWID;
            CREATE VIEW IF NOT EXISTS missed_rounds AS SELECT missed_blocks.* FROM missed_blocks LEFT OUTER JOIN forged_blocks ON missed_blocks.delegate = forged_blocks.delegate AND missed_blocks.round = forged_blocks.round WHERE forged_blocks.delegate IS NULL;

            CREATE INDEX IF NOT EXISTS forged_blocks_delegate_timestamp ON forged_blocks (delegate, timestamp);
            CREATE INDEX IF NOT EXISTS forged_blocks_delegate_round on forged_blocks (delegate, round);
            CREATE INDEX IF NOT EXISTS missed_blocks_delegate on missed_blocks (delegate);
        `);
        this.triggers(true);
    };

    insert (forgedBlocks, missedBlocks) {
        const insertForged = this.database.prepare("INSERT INTO forged_blocks VALUES (:round, :height, :delegate, :timestamp)");
        const insertMissed = this.database.prepare("INSERT INTO missed_blocks VALUES (:round, :height, :delegate, :timestamp)");
        const deleteForged = this.database.prepare("DELETE FROM forged_blocks WHERE height >= :height");
        const deleteMissed = this.database.prepare("DELETE FROM missed_blocks WHERE height >= :height");

        try {
            this.database.transaction(() => {
                deleteForged.run({ height: forgedBlocks[0].height });
                deleteMissed.run({ height: forgedBlocks[0].height });
                for (const block of forgedBlocks) {
                    insertForged.run(block);
                }
                for (const block of missedBlocks) {
                    insertMissed.run(block);
                }
            })();
        } catch (error) {
            this.logger.error(error.message);
        }
    };

    purgeCache (key) {
        delete this.cache[key];
    };

    purgeFrom (processor, height) {
        const deleteForged = this.database.prepare("DELETE FROM forged_blocks WHERE height >= :height");
        const deleteMissed = this.database.prepare("DELETE FROM missed_blocks WHERE height >= :height");
        this.database.transaction(() => {
            deleteForged.run({ height });
            deleteMissed.run({ height });
        })();
    };

    setCache (key, value) {
        this.cache[key] = value;
    };

    triggers (create) {
        if (create) {
            this.database.exec("CREATE TRIGGER IF NOT EXISTS monotonic_blocks BEFORE INSERT ON forged_blocks BEGIN SELECT CASE WHEN (SELECT height FROM forged_blocks ORDER BY height DESC LIMIT 1) != NEW.height - 1 THEN RAISE (ABORT,'Forged block height did not increment monotonically') END; END");
            this.database.exec("CREATE TRIGGER IF NOT EXISTS forged_for_missed BEFORE INSERT ON missed_blocks BEGIN SELECT CASE WHEN (SELECT height FROM forged_blocks WHERE height = NEW.height) != NEW.height THEN RAISE (ABORT,'Missed block height did not have a matching forged height') END; END");
        } else {
            this.database.exec("DROP TRIGGER IF EXISTS monotonic_blocks");
            this.database.exec("DROP TRIGGER IF EXISTS forged_for_missed");
        }
    };

    truncate () {
        this.triggers(false);
        const truncateForged = this.database.prepare("DELETE FROM forged_blocks");
        const truncateMissed = this.database.prepare("DELETE FROM missed_blocks");
        this.database.transaction(() => {
            truncateForged.run();
            truncateMissed.run();
        })();
        this.triggers(true);
    };

    async warmUp (statistics, height, Slots) {
        const delay = require("delay");
        const delegates = this.database.prepare("SELECT delegate FROM (SELECT delegate FROM forged_blocks UNION SELECT delegate FROM missed_blocks)").pluck().all();
        for (const delegate of delegates) {
            setImmediate(() => {
                this.getStatistics(delegate, statistics, height, Slots, true);
            });
            await delay(100);
        }
    };
};

module.exports = Database;
