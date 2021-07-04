export const defaults = {
    enabled: false,
    statistics: {
        day: {
            time: 86400,
            type: "rolling",
        },
        week: {
            time: 604800,
            type: "rolling",
        },
        month: {
            time: 2592000,
            type: "rolling",
        },
        quarter: {
            time: 7776000,
            type: "rolling",
        },
    },
};
