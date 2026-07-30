import { env } from "struxjs";

const driver = env("DB_DRIVER", "mysql");

export default {
    driver: driver,
    host: env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", driver === "postgres" ? 5432 : 3306)),
    user: env("DB_USER", "root"),
    password: env("DB_PASSWORD", ""),
    database: env("DB_DATABASE", "struxjs"),
    filename: env("DB_FILENAME", "./database/database.sqlite"),
    log_queries: env("DB_LOG_QUERIES", false),

    redis: {
        client: "ioredis",
        default: {
            host: env("REDIS_HOST", "127.0.0.1"),
            password: env("REDIS_PASSWORD", undefined),
            port: Number(env("REDIS_PORT", 6379)),
            db: Number(env("REDIS_DB", 0)),
        },
    }
};