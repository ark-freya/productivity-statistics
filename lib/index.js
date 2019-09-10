exports.plugin = {
    defaults: {
        enabled: false,
        statistics: {
            day: {
                time: 86400,
                type: "rolling"
            },
            week: {
                time: 604800,
                type: "rolling"
            },
            month: {
                time: 2592000,
                type: "rolling"
            },
            quarter: {
                time: 7776000,
                type: "rolling"
            }
        }
    },
    pkg: require("../package.json"),
    async register (app, options) {
        if (!options.enabled) {
            return;
        }

        const scopes = Object.keys(app.plugins.plugins).filter(
            scope => scope.endsWith("/core-api") ||
                scope.endsWith("/core-blockchain") ||
                scope.endsWith("/core-event-emitter") ||
                scope.endsWith("/core-p2p") ||
                scope.endsWith("/core-state") ||
                scope.endsWith("/core-transaction-pool")
        ).map(
            scope => scope.substring(0, scope.lastIndexOf("/"))
        ).reduce((count, current) => {
            if (current in count) {
                count[current]++;
            } else {
                count[current] = 1;
            }
            return count;
        }, {});

        const scope = Object.keys(scopes).reduce((a, b) => scopes[a] > scopes[b] ? a : b);

        const Processor = require("./processor");
        const Database = require("./database");
        const Server = require("./server");

        const database = new Database(app);
        database.init();

        const processor = new Processor(app, database, options, scope);
        processor.start();

        const server = new Server(app, database, options, scope);
        server.start();
    },
};