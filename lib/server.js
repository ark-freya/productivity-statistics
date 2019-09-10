class Server {
    constructor (app, database, options, scope) {
        this.app = app;
        this.database = database;
        this.options = options;
        this.scope = scope;

        const { Crypto } = require(`${this.scope}/crypto`);
        const { roundCalculator } = require(`${this.scope}/core-utils`);
        const { Slots } = Crypto;

        this.roundCalculator = roundCalculator;
        this.Slots = Slots;
    }

    getHeight () {
        return this.roundCalculator.calculateRound(this.database.getHeight()).roundHeight;
    };

    getMissed (type, delegate) {
        return this.database.getMissed(type, delegate, type === "rounds" ? this.getHeight() : null);
    };

    getStatistics (delegate) {
        return this.database.getStatistics(delegate, this.options.statistics, this.getHeight(), this.Slots);
    };

    inject (object) {
        const statistics = this.getStatistics(object.username);
        object.statistics = statistics;
    }

    start() {
        const api = this.app.resolvePlugin("api");

        if (!api) {
            return;
        }

        const boom = require("@hapi/boom");
        const database = this.app.resolvePlugin("database");
        const http = api.instance("http");
        const getPath = dir => path.join(path.dirname(process.mainModule.filename), dir);
        const path = require("path");
        const table = http.table();

        const { paginate, respondWithResource, toPagination } = require(getPath("/../../core-api/dist/handlers/utils"));
        const { formatTimestamp } = require(`${this.scope}/core-utils`);

        const transform = row => {
            const data = {
                height: row.height,
                timestamp: formatTimestamp(row.timestamp)
            };
            return data;
        };

        table.filter(routes => routes.path === "/api/delegates/{id}")[0].settings.handler = request => {
            const delegate = database.delegates.findById(request.params.id);
            if (!delegate) {
                return boom.notFound("Delegate not found");
            }
            const response = respondWithResource(delegate, "delegate");
            this.inject(response.data);
            return response;
        };

        table.filter(routes => routes.path === "/api/delegates")[0].settings.handler = request => {
            const delegates = database.delegates.search({
                ...request.query,
                ...paginate(request)
            });
            const response = toPagination(delegates, "delegate");
            response.results.forEach(row => {
                this.inject(row);
            });
            return response;
        };

        const missed = (type, request) => {
            const delegate = database.delegates.findById(request.params.id);
            if (!delegate) {
                return boom.notFound("Delegate not found");
            }
            const pagination = paginate(request);
            const rows = this.getMissed(type, delegate.username);
            const paginated = rows.slice(pagination.offset, pagination.offset + pagination.limit);
            return {
                results: paginated.map(d => transform(d)),
                totalCount: rows.length
            };
        };

        http.route({
            method: "GET",
            path: "/api/delegates/{id}/missed/slots",
            handler: request => missed("slots", request),
            config: {
                plugins: {
                    pagination: {
                        enabled: true
                    }
                }
            }
        });

        http.route({
            method: "GET",
            path: "/api/delegates/{id}/missed/rounds",
            handler: request => missed("rounds", request),
            config: {
                plugins: {
                    pagination: {
                        enabled: true
                    }
                }
            }
        });
    }
}

module.exports = Server;
