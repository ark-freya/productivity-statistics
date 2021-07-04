import { DatabaseService, Repositories } from "@arkecosystem/core-database";
import { Container, Contracts, Enums, Providers, Services, Utils } from "@arkecosystem/core-kernel";
import { Crypto, Interfaces, Managers } from "@arkecosystem/crypto";
import { fork } from "child_process";
import { ChildProcess } from "child_process";
import delay from "delay";

import { Database } from "./database";

@Container.injectable()
export class Processor {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.DatabaseBlockRepository)
    private readonly blockRepository!: Repositories.BlockRepository;

    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@alessiodf/productivity-statistics")
    private readonly configuration!: Providers.PluginConfiguration;

    @Container.inject(Container.Identifiers.DatabaseService)
    private readonly database!: DatabaseService;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.WalletRepository)
    @Container.tagged("state", "blockchain")
    private readonly walletRepository!: Contracts.State.WalletRepository;

    private active: boolean = true;
    private initial: boolean = false;
    private interval!: ReturnType<typeof setInterval>;
    private lastBlockId!: string;
    private sqlite!: Database;
    private syncing: boolean = false;
    private worker: ChildProcess = fork(`${__dirname}/worker.js`);

    public async boot(): Promise<void> {
        this.sqlite = this.app.get<Database>(Symbol.for("ProductivityStatistics<Database>"));
        this.logger.info("Productivity statistics calculator loaded");
        this.init();
    }

    private finishedInitialSync(): void {
        clearInterval(this.interval);
        this.setInitialSync(false);
        this.warmUp();
    }

    private getHeight(): number {
        return Utils.roundCalculator.calculateRound(this.sqlite.getHeight()).roundHeight;
    }

    private async getGeneratorAtHeight(height): Promise<string> {
        const block: Interfaces.IBlockData | undefined = await this.blockRepository.findByHeight(height);
        if (block) {
            const wallet = this.walletRepository.findByPublicKey(block.generatorPublicKey);
            return wallet.getAttribute("delegate.username");
        }
        return "";
    }

    private async getLastBlock(): Promise<Interfaces.IBlockData | undefined> {
        return await this.blockRepository.findLatest();
    }

    private async getLastBlockHeight(): Promise<number> {
        return (await this.getLastBlock())!.height;
    }

    private async init(): Promise<void> {
        const lastChainedBlock: Interfaces.IBlockData | undefined = await this.getLastBlock();
        const lastChainedBlockHeight: number = lastChainedBlock!.height;
        const lastChainedBlockTimestamp: number = lastChainedBlock!.timestamp;

        let lastStoredBlockHeight: number = this.sqlite.getHeight();

        if (lastStoredBlockHeight > lastChainedBlockHeight) {
            this.sqlite.purgeFrom(lastChainedBlockHeight + 1, lastChainedBlockTimestamp + 1);
            lastStoredBlockHeight = this.sqlite.getHeight();
        }

        const lowestCommonHeight: number = Math.min(lastStoredBlockHeight, lastChainedBlockHeight);

        if (lowestCommonHeight > 1) {
            const storedGenerator: string = this.sqlite.getGeneratorAtHeight(lowestCommonHeight);
            const chainedGenerator: string = await this.getGeneratorAtHeight(lowestCommonHeight);
            if (storedGenerator !== chainedGenerator) {
                this.logger.info("Productivity statistics consistency mismatch - recalculating");
                this.sqlite.truncate();
            }
        }

        if (lastChainedBlockHeight !== this.sqlite.getHeight()) {
            this.setInitialSync(true);
            this.interval = setInterval(async () => {
                const newStoredBlockHeight: number = this.sqlite.getHeight();
                const newChainedBlockHeight: number = await this.getLastBlockHeight();
                if (newStoredBlockHeight !== lastStoredBlockHeight) {
                    this.logger.info(
                        `Calculating productivity statistics (${newStoredBlockHeight.toLocaleString()} of ${newChainedBlockHeight.toLocaleString()}): ${(
                            (newStoredBlockHeight / newChainedBlockHeight) *
                            100
                        ).toFixed(2)}% complete`,
                    );
                }
            }, 10000);
            this.sync();
        } else {
            this.warmUp();
        }

        this.events.listen(Enums.BlockEvent.Applied, {
            handle: async ({ data }) => {
                while (data.height > (await this.getLastBlockHeight())) {
                    await delay(100);
                }
                this.sync();
            },
        });
    }

    private isActive(): boolean {
        return this.active;
    }

    private isInitialSync(): boolean {
        return this.initial;
    }

    private isSyncing(): boolean {
        return this.syncing;
    }

    private lastBlockProcessed(id): boolean {
        const response = this.lastBlockId === id;
        this.lastBlockId = id;
        return response;
    }

    private async processBlocks(blocks): Promise<void> {
        const forgedBlocks: { round: number; height: number; delegate: string; timestamp: number }[] = [];
        const missedBlocks: { round: number; height: number; delegate: string; timestamp: number }[] = [];
        const calculatedRounds = {};
        const updates = new Set();
        const initialSync: boolean = this.isInitialSync();
        const genesisRound: Contracts.State.Wallet[] = (await this.app
            .get<Services.Triggers.Triggers>(Container.Identifiers.TriggerService)
            .call("getActiveDelegates", {
                roundInfo: Utils.roundCalculator.calculateRound(1),
            })) as Contracts.State.Wallet[];

        if (!genesisRound[0].hasAttribute("delegate.username")) {
            return;
        }

        for (let blockCounter = 0; blockCounter < blocks.length; blockCounter++) {
            const block: Interfaces.IBlockData = blocks[blockCounter];
            const round = Utils.roundCalculator.calculateRound(block.height);
            const blockTime: number = Managers.configManager.getMilestone(round.roundHeight).blocktime;
            const generator: Contracts.State.Wallet = this.walletRepository.findByPublicKey(block.generatorPublicKey);
            const delegate: string =
                block.height == 1 ? generator.getAddress() : generator.getAttribute("delegate.username");
            if (!calculatedRounds[round.round]) {
                const delegatesInThisRound: Contracts.State.Wallet[] = (await this.app
                    .get<Services.Triggers.Triggers>(Container.Identifiers.TriggerService)
                    .call("getActiveDelegates", { roundInfo: round })) as Contracts.State.Wallet[];

                calculatedRounds[round.round] = delegatesInThisRound.map((delegate) =>
                    delegate.getAttribute("delegate.username"),
                );
                if (!calculatedRounds[round.round].length) {
                    this.logger.error(
                        `Cannot calculate productivity statistics: The rounds table in your database has no entries for round ${
                            round.round
                        }. You must roll back to height ${round.roundHeight - round.maxDelegates}.`,
                    );
                    this.setInitialSync(false);
                    this.setActive(false);
                    return;
                }
            }

            if (block.height > 2) {
                const delegates = calculatedRounds[round.round];
                const lastBlock: Interfaces.IBlockData =
                    blockCounter > 0
                        ? blocks[blockCounter - 1]
                        : await this.blockRepository.findByHeight(block.height - 1);
                const thisSlot: number = Crypto.Slots.getSlotNumber(
                    await Utils.forgingInfoCalculator.getBlockTimeLookup(this.app, block.height),
                    block.timestamp,
                );
                const blockTimeLookup = await Utils.forgingInfoCalculator.getBlockTimeLookup(
                    this.app,
                    lastBlock.height,
                );
                const lastSlot: number = lastBlock
                    ? Crypto.Slots.getSlotNumber(blockTimeLookup, lastBlock.timestamp) + 1
                    : 0;
                const missedSlots: number = thisSlot - lastSlot;
                if (missedSlots > 0) {
                    let missedSlotCounter: number = 0;
                    for (let slotCounter = lastSlot; slotCounter < thisSlot; slotCounter++) {
                        missedSlotCounter++;
                        const missedDelegate: string = delegates[slotCounter % delegates.length];
                        missedBlocks.push({
                            round: round.round,
                            height: block.height,
                            delegate: missedDelegate,
                            timestamp:
                                Crypto.Slots.getSlotTime(
                                    blockTimeLookup,
                                    Crypto.Slots.getSlotNumber(blockTimeLookup, lastBlock.timestamp),
                                ) +
                                blockTime * missedSlotCounter,
                        });
                        if (!initialSync) {
                            updates.add(missedDelegate);
                        }
                    }
                }
            }
            forgedBlocks.push({ round: round.round, height: block.height, delegate, timestamp: block.timestamp });
            if (!initialSync) {
                updates.add(delegate);
            }
        }
        this.sqlite.insert(forgedBlocks, missedBlocks);
        if (!initialSync) {
            const height: number = this.getHeight();
            updates.forEach((delegate) => {
                this.sqlite.getStatistics(delegate as string, this.configuration.get("statistics"), height, true);
            });
            updates.clear();
        }
    }

    private resetLastBlock(): void {
        this.lastBlockId = "";
    }

    private setActive(state): void {
        this.active = state;
    }

    private setInitialSync(state): void {
        this.initial = state;
    }

    private setSyncing(state): void {
        this.syncing = state;
    }

    private async sync(): Promise<void> {
        if (this.isSyncing() || !this.isActive()) {
            return;
        }
        this.setSyncing(true);
        this.resetLastBlock();
        let loop: boolean = true;
        while (loop) {
            const lastStoredBlockHeight: number = this.sqlite.getHeight();
            const lastChainedBlockHeight: number = await this.getLastBlockHeight();
            const height: number =
                lastStoredBlockHeight < lastChainedBlockHeight ? lastStoredBlockHeight : lastChainedBlockHeight;
            const blocks: Contracts.Shared.DownloadBlock[] = await this.database.getBlocksForDownload(
                height + 1,
                10000,
                true,
            );
            if (blocks.length && !this.lastBlockProcessed(blocks[blocks.length - 1].id)) {
                await this.processBlocks(blocks);
            } else {
                if (this.isInitialSync() && lastStoredBlockHeight === lastChainedBlockHeight) {
                    this.finishedInitialSync();
                }
                loop = false;
            }
        }
        this.setSyncing(false);
    }

    private warmUp(): void {
        this.worker.on("message", (data) => {
            this.sqlite.warmedUp(data);
            this.logger.info("Productivity statistics are up to date");
        });
        this.worker.send({ height: this.getHeight(), statistics: this.configuration.get("statistics") });
    }
}
