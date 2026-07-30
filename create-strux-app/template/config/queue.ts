import type { QueueConfig } from "struxjs";
import { env } from "struxjs";

const queueConfig: QueueConfig = {
    default: env("QUEUE_CONNECTION", "sync"),

    connections: {
        sync: {
            driver: "sync",
        },
        redis: {
            driver: "redis",
            connection: "queue",  // Use the "queue" Redis connection (DB 2)
            queue: "default",
        },
        database: {
            driver: "database",
            table: "jobs",
            failedTable: "failed_jobs",
            reservationTimeout: 90,
            queue: "default",
        },
        file: {
            driver: "file",
            storagePath: undefined,
            queue: "default",
        },
    },
};

export default queueConfig;
