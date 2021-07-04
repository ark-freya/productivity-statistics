import process from "process";

process.on("message", (data) => {
    const { Database } = require(`${__dirname}/database`);
    const database = new Database();
    database.boot();
    database.warmUp(data.statistics, data.height);
    if (process.send) {
        process.send(database.cache);
    }
    process.exit(0);
});
