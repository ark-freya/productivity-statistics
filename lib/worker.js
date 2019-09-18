process.on("message", data => {
    const { Crypto } = require(`${data.scope}/crypto`);
    const { Slots } = Crypto;

    const Database = require(`${__dirname}/database`);
    const database = new Database();
    database.init();
    database.warmUp(data.statistics, data.height, Slots);
    process.send(database.cache);
    process.exit(0);
});
