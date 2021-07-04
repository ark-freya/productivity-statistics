import { Identifiers } from "@arkecosystem/core-api/dist/identifiers";
import { DelegateCriteria, delegateCriteriaSchemaObject } from "@arkecosystem/core-api/dist/resources-new";
import { SchemaObject } from "@arkecosystem/core-api/dist/schemas";
import { Server } from "@arkecosystem/core-api/dist/server";
import { DelegateSearchService, WalletSearchService } from "@arkecosystem/core-api/dist/services";
import { Container, Contracts, Providers, Utils } from "@arkecosystem/core-kernel";
import { notFound } from "@hapi/boom";
import Hapi from "@hapi/hapi";

import { Database } from "./database";

@Container.injectable()
export class Controller {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@alessiodf/productivity-statistics")
    private readonly configuration!: Providers.PluginConfiguration;

    @Container.inject(Identifiers.DelegateSearchService)
    private readonly delegateSearchService!: DelegateSearchService;

    @Container.inject(Identifiers.WalletSearchService)
    private readonly walletSearchService!: WalletSearchService;

    private sqlite!: Database;

    public async boot(): Promise<void> {
        this.sqlite = this.app.get<Database>(Symbol.for("ProductivityStatistics<Database>"));
        const servers: Server[] = [];
        if (this.app.isBound(Identifiers.HTTP)) {
            servers.push(this.app.get<Server>(Identifiers.HTTP));
        }
        if (this.app.isBound(Identifiers.HTTPS)) {
            servers.push(this.app.get<Server>(Identifiers.HTTPS));
        }

        for (const { server } of servers as any) {
            server.route({
                method: "GET",
                path: "/api/delegates/{id}/missed/slots",
                handler: (request) => missed("slots", request),
                options: {
                    plugins: {
                        pagination: { enabled: true },
                    },
                },
            });

            server.route({
                method: "GET",
                path: "/api/delegates/{id}/missed/rounds",
                handler: (request) => missed("rounds", request),
                options: {
                    plugins: {
                        pagination: { enabled: true },
                    },
                },
            });

            const table = server.table();

            table.filter((routes) => routes.path === "/api/delegates/{id}")[0].settings.handler = (request) => {
                const walletId = request.params.id as string;

                const walletResource = this.walletSearchService.getWallet(walletId);
                if (!walletResource) {
                    return notFound("Wallet not found");
                }

                const delegateResource = this.delegateSearchService.getDelegate(walletResource.address);
                if (!delegateResource) {
                    return notFound("Delegate not found");
                }

                this.inject(delegateResource);

                return { data: delegateResource };
            };

            table.filter((routes) => routes.path === "/api/delegates")[0].settings.handler = (request) => {
                const pagination = this.getQueryPagination(request.query);
                const sorting = request.query.orderBy as Contracts.Search.Sorting;
                const criteria = this.getQueryCriteria(request.query, delegateCriteriaSchemaObject) as DelegateCriteria;
                const response = this.delegateSearchService.getDelegatesPage(pagination, sorting, criteria);
                response.results.forEach((row) => {
                    this.inject(row);
                });
                return response;
            };
        }

        const missed = (type: string, request: Hapi.Request) => {
            const walletId = request.params.id as string;

            const walletResource = this.walletSearchService.getWallet(walletId);
            if (!walletResource) {
                return notFound("Wallet not found");
            }

            const delegateResource = this.delegateSearchService.getDelegate(walletResource.address);
            if (!delegateResource) {
                return notFound("Delegate not found");
            }

            const pagination = this.getQueryPagination(request.query);

            const rows = this.getMissed(type, delegateResource.username);
            const paginated = rows.slice(pagination.offset, pagination.offset + pagination.limit);
            return {
                results: paginated.map((d) => transform(d)),
                totalCount: rows.length,
            };
        };

        const transform = (row) => {
            const data = {
                height: row.height,
                timestamp: Utils.formatTimestamp(row.timestamp),
            };
            return data;
        };
    }

    private getQueryCriteria(query: Hapi.RequestQuery, schemaObject: SchemaObject): unknown {
        const schemaObjectKeys = Object.keys(schemaObject);
        const criteria = {};
        for (const [key, value] of Object.entries(query)) {
            if (schemaObjectKeys.includes(key)) {
                criteria[key] = value;
            }
        }
        return criteria;
    }

    private getQueryPagination(query: Hapi.RequestQuery): Contracts.Search.Pagination {
        const pagination = {
            offset: (query.page - 1) * query.limit || 0,
            limit: query.limit,
        };

        if (query.offset) {
            pagination.offset = query.offset;
        }

        return pagination;
    }

    private getHeight(): number {
        return Utils.roundCalculator.calculateRound(this.sqlite.getHeight()).roundHeight;
    }

    private getMissed(type: string, delegate: string) {
        return this.sqlite.getMissed(type, delegate, type === "rounds" ? this.getHeight() : 0);
    }

    private getStatistics(delegate) {
        return this.sqlite.getStatistics(delegate, this.configuration.get("statistics"), this.getHeight());
    }

    private inject(object): void {
        const statistics = this.getStatistics(object.username);
        object.statistics = statistics;
    }
}
