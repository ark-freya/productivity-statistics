import { Providers } from "@arkecosystem/core-kernel";

import { Controller } from "./controller";
import { Database } from "./database";
import { Processor } from "./processor";

export class ServiceProvider extends Providers.ServiceProvider {
    private controllerSymbol = Symbol.for("ProductivityStatistics<Controller>");
    private databaseSymbol = Symbol.for("ProductivityStatistics<Database>");
    private processorSymbol = Symbol.for("ProductivityStatistics<Processor>");

    public async register(): Promise<void> {
        await this.build();
    }

    public async bootWhen(): Promise<boolean> {
        return !!this.config().get("enabled");
    }

    public async boot(): Promise<void> {
        this.app.get<Controller>(this.controllerSymbol).boot();
        this.app.get<Database>(this.databaseSymbol).boot();
        this.app.get<Processor>(this.processorSymbol).boot();
    }

    private async build(): Promise<void> {
        this.app.bind<Controller>(this.controllerSymbol).to(Controller).inSingletonScope();
        this.app.bind<Database>(this.databaseSymbol).to(Database).inSingletonScope();
        this.app.bind<Processor>(this.processorSymbol).to(Processor).inSingletonScope();
    }
}
