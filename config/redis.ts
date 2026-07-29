import { env } from "struxjs";

export default {
    default: {
        host: env("REDIS_HOST", "127.0.0.1"),
        port: Number(env("REDIS_PORT", 6379)),
        password: env("REDIS_PASSWORD", undefined),
        database: Number(env("REDIS_DB", 0)),
        prefix: env("REDIS_PREFIX", ""),
    },

    cache: {
        host: env("REDIS_HOST", "127.0.0.1"),
        port: Number(env("REDIS_PORT", 6379)),
        password: env("REDIS_PASSWORD", undefined),
        database: Number(env("REDIS_CACHE_DB", 1)),
        prefix: "",
    },

    queue: {
        host: env("REDIS_HOST", "127.0.0.1"),
        port: Number(env("REDIS_PORT", 6379)),
        password: env("REDIS_PASSWORD", undefined),
        database: Number(env("REDIS_QUEUE_DB", 2)),
        prefix: "",
    },
};
