import { Job, JobEnvelope } from "./Job.js";
import { QueueDriver } from "./drivers/QueueDriver.js";
import { SyncDriver } from "./drivers/SyncDriver.js";
import { RedisDriver } from "./drivers/RedisDriver.js";
import { DatabaseDriver } from "./drivers/DatabaseDriver.js";
import { FileDriver } from "./drivers/FileDriver.js";
import { Container } from "../container/Container.js";

export type QueueDriverName = "sync" | "redis" | "database" | "file";

export interface QueueConnectionConfig {
    driver: QueueDriverName;

    // Redis driver
    connection?: string;     // Redis connection name from config/redis.ts

    // Database driver
    table?: string;          // Jobs table name (default: "jobs")
    failedTable?: string;    // Failed jobs table name (default: "failed_jobs")
    reservationTimeout?: number; // Seconds before a reserved job is released (default: 90)

    // File driver
    storagePath?: string;    // Absolute path for job files (default: storage/framework/queue)

    queue?: string;          // Default queue name
}

export interface QueueConfig {
    default: string;
    connections: {
        [key: string]: QueueConnectionConfig;
    };
}

/**
 * Queue manager — dispatches jobs to the configured driver.
 *
 * Configure during bootstrap:
 *   Queue.boot(container);
 *
 * Dispatch:
 *   await dispatch(new SendEmailJob(...));
 *   await Queue.push(new SendEmailJob(...), { queue: 'emails', delay: 30 });
 */
export class Queue {
    private static drivers: Map<string, QueueDriver> = new Map();
    private static container: Container | null = null;
    private static defaultConnection = "sync";

    /* ---------------------------------------------------------------------- */
    /*  Bootstrap                                                              */
    /* ---------------------------------------------------------------------- */

    /**
     * Bind the IoC container so Queue can read config and build Redis clients.
     * Call this in your AppServiceProvider or bootstrap.ts.
     */
    public static boot(container: Container): void {
        this.container = container;

        // Read default connection from config if available
        try {
            const cfg = container.make<QueueConfig>("config.queue");
            if (cfg?.default) this.defaultConnection = cfg.default;
        } catch {
            // config.queue not registered yet — fine, defaults apply
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Driver resolution                                                      */
    /* ---------------------------------------------------------------------- */

    /**
     * Get or lazily create a QueueDriver for the given connection name.
     * @internal — public so QueueWorker can access it without casting
     */
    public static getDriver(connection?: string): QueueDriver {
        const conn = connection || this.defaultConnection;

        if (this.drivers.has(conn)) {
            return this.drivers.get(conn)!;
        }

        const driver = this.buildSyncDriver(conn);
        this.drivers.set(conn, driver);
        return driver;
    }

    /**
     * Async version of getDriver — required when using Redis driver.
     * For RedisDriver, call this before starting the worker.
     */
    public static async resolveDriver(connection?: string): Promise<QueueDriver> {
        const conn = connection || this.defaultConnection;

        if (this.drivers.has(conn)) {
            return this.drivers.get(conn)!;
        }

        const driver = await this.buildDriver(conn);
        this.drivers.set(conn, driver);
        return driver;
    }

    private static buildSyncDriver(conn: string): QueueDriver {
        if (!this.container) {
            return new SyncDriver();
        }

        let queueConfig: QueueConfig | undefined;
        try {
            queueConfig = this.container.make<QueueConfig>("config.queue");
        } catch {
            return new SyncDriver();
        }

        const connConfig = queueConfig?.connections?.[conn];
        if (!connConfig) {
            throw new Error(`[StruxJS Queue] Connection "${conn}" not found in config/queue.ts`);
        }

        if (connConfig.driver === "sync") {
            return new SyncDriver();
        }

        throw new Error(
            `[StruxJS Queue] Driver "${connConfig.driver}" requires async initialization. ` +
            `Use Queue.resolveDriver() instead of Queue.getDriver().`
        );
    }

    private static async buildDriver(conn: string): Promise<QueueDriver> {
        // If no container, fall back to SyncDriver
        if (!this.container) {
            if (process.env.NODE_ENV !== "test") {
                console.error("[StruxJS Queue] Container not booted — using SyncDriver as fallback.");
            }
            return new SyncDriver();
        }

        let queueConfig: QueueConfig | undefined;
        try {
            queueConfig = this.container.make<QueueConfig>("config.queue");
        } catch {
            return new SyncDriver();
        }

        const connConfig = queueConfig?.connections?.[conn];
        if (!connConfig) {
            throw new Error(`[StruxJS Queue] Connection "${conn}" not found in config/queue.ts`);
        }

        switch (connConfig.driver) {
            case "sync":
                return new SyncDriver();

            case "redis": {
                const redisConnName = connConfig.connection || "default";
                let redisConfig: any;
                try {
                    const allRedis = this.container.make<any>("config.redis");
                    redisConfig = allRedis?.[redisConnName];
                } catch {
                    throw new Error(`[StruxJS Queue] Redis config not found. Make sure config/redis.ts is loaded.`);
                }

                if (!redisConfig) {
                    throw new Error(`[StruxJS Queue] Redis connection "${redisConnName}" not found in config/redis.ts`);
                }

                let Redis: any;
                try {
                    const mod = await import("ioredis");
                    Redis = mod.default;
                } catch {
                    throw new Error("[StruxJS Queue] ioredis is not installed. Run: npm install ioredis");
                }

                const client = new Redis({
                    host:     redisConfig.host     || "127.0.0.1",
                    port:     redisConfig.port     || 6379,
                    password: redisConfig.password || undefined,
                    db:       redisConfig.database || 0,
                });

                return new RedisDriver(client);
            }

            case "database": {
                // Reuse the app's existing knex connection via BaseModel
                let knex: any;
                try {
                    const { BaseModel } = await import("../database/BaseModel.js");
                    knex = (BaseModel as any).getConnection();
                } catch {
                    throw new Error("[StruxJS Queue] Could not get database connection. Make sure BaseModel.bootConnection() has been called.");
                }

                if (!knex) {
                    throw new Error("[StruxJS Queue] Database connection is not initialised.");
                }

                return new DatabaseDriver(knex, {
                    jobsTable:          connConfig.table          || "jobs",
                    failedTable:        connConfig.failedTable    || "failed_jobs",
                    reservationTimeout: connConfig.reservationTimeout,
                });
            }

            case "file": {
                return new FileDriver(connConfig.storagePath);
            }

            default:
                throw new Error(`[StruxJS Queue] Unsupported driver: "${(connConfig as any).driver}"`);
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Public API                                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Push a job to the queue.
     *
     * await Queue.push(new SendEmailJob(user), { queue: 'emails' });
     */
    public static async push(
        job: Job,
        options?: {
            queue?: string;
            delay?: number;
            connection?: string;
        }
    ): Promise<void> {
        const driver   = await this.resolveDriver(options?.connection);
        const envelope = job.serialize();

        if (options?.queue)       envelope.queue = options.queue;
        if (options?.delay != null) envelope.delay = options.delay;

        await driver.push(envelope, envelope.queue);
    }

    /**
     * Push a delayed job (syntactic sugar).
     *
     * await Queue.later(60, new SendEmailJob(user)); // run after 60s
     */
    public static async later(
        delay: number,
        job: Job,
        options?: { queue?: string; connection?: string }
    ): Promise<void> {
        return this.push(job, { ...options, delay });
    }

    /** Return approximate pending job count for a queue. */
    public static async size(queue = "default", connection?: string): Promise<number> {
        return (await this.resolveDriver(connection)).size(queue);
    }

    /** List all permanently failed jobs. */
    public static async getFailed(queue?: string, connection?: string): Promise<JobEnvelope[]> {
        return (await this.resolveDriver(connection)).getFailed(queue);
    }

    /** Retry a specific failed job by its ID. */
    public static async retry(id: string, connection?: string): Promise<boolean> {
        return (await this.resolveDriver(connection)).retryFailed(id);
    }

    /** Delete all entries from the failed jobs list. */
    public static async flushFailed(connection?: string): Promise<void> {
        return (await this.resolveDriver(connection)).flushFailed();
    }
}

/* -------------------------------------------------------------------------- */
/*  Global helper                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch a job to the queue (global shorthand).
 *
 * import { dispatch } from 'struxjs';
 * await dispatch(new SendEmailJob(user));
 * await dispatch(new SendEmailJob(user), { queue: 'emails', delay: 30 });
 */
export function dispatch(
    job: Job,
    options?: {
        queue?: string;
        delay?: number;
        connection?: string;
    }
): Promise<void> {
    return Queue.push(job, options);
}
