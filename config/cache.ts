import type { CacheConfig } from "struxjs";
import { env } from "struxjs";

const cacheConfig: CacheConfig = {
    default: env("CACHE_DRIVER", "memory"),
    prefix: env("CACHE_PREFIX", "strux_cache_"),

    stores: {
        memory: {
            driver: "memory",
        },
        file: {
            driver: "file",
            storagePath: undefined,
        },
        database: {
            driver: "database",
            table: "cache",
        },
        redis: {
            driver: "redis",
            redisConnection: "cache",
            prefix: env("CACHE_PREFIX", "strux:cache:"),
        },
    },
};

export default cacheConfig;
