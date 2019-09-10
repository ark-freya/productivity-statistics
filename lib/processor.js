class Processor {
    constructor (app, database, options, scope) {
        this.app = app;
        this.options = options;
        this.sqlite = database;
        this.scope = scope;

        this.database = this.app.resolvePlugin("database");
        this.logger = this.app.resolvePlugin("logger");

        this.active = true;
        this.initial = false;
        this.interval = null;
        this.lastBlockId = null;
        this.syncing = false;
        this.timer = null;

        const { Crypto } = require(`${this.scope}/crypto`);
        const { roundCalculator } = require(`${this.scope}/core-utils`);
        const { Slots } = Crypto;

        this.delay = require("delay");
        this.roundCalculator = roundCalculator;
        this.Slots = Slots;
    };

    finishedInitialSync () {
        clearInterval(this.interval);
        this.setInitialSync(false);
        this.sqlite.warmUp(this.options.statistics, this.getHeight(), this.Slots);
        this.logger.info("Productivity statistics are up to date");
    };

    getHeight () {
        return this.roundCalculator.calculateRound(this.sqlite.getHeight()).roundHeight;
    };

    async getGeneratorAtHeight (height) {
        const block = await this.database.blocksBusinessRepository.findByHeight(height);
        return block ? this.database.walletManager.findByPublicKey(block.generatorPublicKey).username : "";
    };

    async getLastBlockHeight () {
        const response = await this.database.blocksBusinessRepository.search({ orderBy: "height", limit: 1, transform: false });
        return response.rows[0].height;
    };

    async init() {
        const lastChainedBlockHeight = await this.getLastBlockHeight();
        let lastStoredBlockHeight = this.sqlite.getHeight();

        if (lastStoredBlockHeight > lastChainedBlockHeight) {
            this.sqlite.purgeFrom(lastChainedBlockHeight + 1);
            lastStoredBlockHeight = this.sqlite.getHeight();
        }

        const lowestCommonHeight = Math.min(lastStoredBlockHeight, lastChainedBlockHeight);

        if (lowestCommonHeight > 1) {
            const storedGenerator = this.sqlite.getGeneratorAtHeight(lowestCommonHeight);
            const chainedGenerator = await this.getGeneratorAtHeight(lowestCommonHeight);
            if (storedGenerator !== chainedGenerator) {
                this.logger.info("Productivity statistics consistency mismatch - recalculating");
                this.sqlite.truncate();
            }
        }

        if (lastChainedBlockHeight !== this.sqlite.getHeight()) {
            this.setInitialSync(true);
            this.interval = setInterval(async () => {
                const newStoredBlockHeight = this.sqlite.getHeight();
                const newChainedBlockHeight = await this.getLastBlockHeight();
                if (newStoredBlockHeight !== lastStoredBlockHeight) {
                    this.logger.info(`Calculating productivity statistics (${newStoredBlockHeight.toLocaleString()} of ${newChainedBlockHeight.toLocaleString()}): ${((newStoredBlockHeight) / newChainedBlockHeight * 100).toFixed(2)}% complete`);
                }
            }, 10000);
            this.sync();
        } else {
            this.sqlite.warmUp(this.options.statistics, this.getHeight(), this.Slots);
        }

        const emitter = this.app.resolvePlugin("event-emitter");

        const { ApplicationEvents } = require(`${this.scope}/core-event-emitter`);

        emitter.on(ApplicationEvents.BlockApplied, async block => {
            while (block.height > await this.getLastBlockHeight()) {
                await this.delay(100);
            }
            this.sync();
        });
    };

    isActive () {
        return this.active;
    };

    isInitialSync () {
        return this.initial;
    };

    isSyncing () {
        return this.syncing;
    };

    lastBlockProcessed (id) {
        const response = this.lastBlockId === id;
        this.lastBlockId = id;
        return response;
    };

    async processBlocks (blocks) {
        const forgedBlocks = [];
        const missedBlocks = [];
        const calculatedRounds = {};
        const updates = new Set();
        const genesisRound = await this.database.getActiveDelegates(this.roundCalculator.calculateRound(1));
        if (!genesisRound[0].username) {
            return;
        }
        for (let blockCounter = 0; blockCounter < blocks.length; blockCounter++) {
            const block = blocks[blockCounter];
            const round = this.roundCalculator.calculateRound(block.height);
            const blockTime = this.app.getConfig().getMilestone(round.roundHeight).blocktime;
            const generator = this.database.walletManager.findByPublicKey(block.generatorPublicKey);
            let delegate = block.height == 1 ? generator.address : generator.username;
            if (!calculatedRounds[round.round]) {
                const delegatesInThisRound = await this.database.getActiveDelegates(round);
                calculatedRounds[round.round] = delegatesInThisRound.map(delegate => delegate.username);
                if (!calculatedRounds[round.round].length) {
                    this.logger.error(`Cannot calculate productivity statistics: The rounds table in your database has no entries for round ${round.round}. You must roll back to height ${round.roundHeight - round.maxDelegates}.`);
                    this.setInitialSync(false);
                    this.setActive(false);
                    return;
                }
            }

            if (block.height > 2) {
                const delegates = calculatedRounds[round.round];
                let lastBlock = blockCounter > 0 ? blocks[blockCounter - 1] : await this.database.blocksBusinessRepository.findByHeight(block.height - 1);
                const thisSlot = this.Slots.getSlotNumber(block.timestamp);
                const lastSlot = lastBlock ? this.Slots.getSlotNumber(lastBlock.timestamp) + 1 : 0;
                const missedSlots = thisSlot - lastSlot;
                if (missedSlots > 0) {
                    let missedSlotCounter = 0;
                    for (let slotCounter = lastSlot; slotCounter < thisSlot; slotCounter++) {
                        missedSlotCounter++;
                        const missedDelegate = delegates[slotCounter % delegates.length];
                        missedBlocks.push({ round: round.round, height: block.height, delegate: missedDelegate, timestamp: this.Slots.getSlotTime(this.Slots.getSlotNumber(lastBlock.timestamp)) + (blockTime * missedSlotCounter) });
                        updates.add(missedDelegate);
                    }
                }
            }
            forgedBlocks.push({ round: round.round, height: block.height, delegate, timestamp: block.timestamp });
            updates.add(delegate);
        }
        this.sqlite.insert(forgedBlocks, missedBlocks);
        const height = this.getHeight();
        updates.forEach(delegate => {
            this.sqlite.getStatistics(delegate, this.options.statistics, height, this.Slots, true);
        });
        updates.clear();
    };

    resetLastBlock () {
        this.lastBlockId = null;
    };

    setActive (state) {
        this.active = state;
    };

    setInitialSync (state) {
        this.initial = state;
    };

    setSyncing (state) {
        this.syncing = state;
    };

    start () {
        if (!this.isActive()) {
            return;
        }

        this.logger.info("Productivity statistics calculator loaded");
        this.init();
    };

    async sync () {
        if (this.isSyncing() || !this.isActive()) {
            return;
        }
        this.setSyncing(true);
        this.resetLastBlock();
        let loop = true;
        while (loop) {
            const lastStoredBlockHeight = this.sqlite.getHeight();
            const lastChainedBlockHeight = await this.getLastBlockHeight();
            const height = lastStoredBlockHeight < lastChainedBlockHeight ? lastStoredBlockHeight : lastChainedBlockHeight;
            const batchSize = 10000;
            const blocks = await this.database.getBlocksForDownload(height + 1, batchSize, true);
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
    };
};

module.exports = Processor;
