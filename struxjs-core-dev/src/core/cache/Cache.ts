import { CacheDriver } from "./drivers/CacheDriver.js";
import { MemoryDriver } from "./drivers/MemoryDriver.js";
import { FileDriver } from "./drivers/FileDriver.js";
import { DatabaseDriver } from "./drivers/DatabaseDriver.js";
import { RedisDriver } from "./drivers/RedisDriver.js";
import { Container } from "../container/Container.js";

export interface CacheStoreConfig {
    driver: "memory" | "file" | "database" | "redis";
    storagePath?: string;
    table?: string;
    connection?: string;
    redisConnection?: string;
    prefix?: string;
}


export interface CacheConfig {
    default: string;
    stores: {
        [name: string]: CacheStoreConfig;
    };
    prefix?: string; // Global key prefix applied to all drivers
}

/**
 * Cache — multi-store cache manager.
 *
 * Use the global helper:
 *   import { cache } from "struxjs";
 *
 *   await cache().put("key", value, 60);          // store for 60 seconds
 *   const val = await cache().get("key");
 *   const val = await cache().remember("key", 60, () => expensiveQuery());
 *
 * Use a specific store:
 *   await cache("redis").put("key", value, 3600);
 */
export class Cache {
    private static drivers: Map<string, CacheDriver> = new Map();
    private static container: Container | null = null;
    private static defaultStore = "memory";

    /* ---------------------------------------------------------------------- */
    /*  Bootstrap                                                              */
    /* ---------------------------------------------------------------------- */

    public static boot(container: Container): void {
        this.container = container;
        try {
            const cfg = container.make<CacheConfig>("config.cache");
            if (cfg?.default) this.defaultStore = cfg.default;
        } catch {
            // config.cache not yet loaded — fine, memory driver is the fallback
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Store resolution                                                       */
    /* ---------------------------------------------------------------------- */

    /**
     * Get (or lazily build) the driver for a named store.
     * Falls back to MemoryDriver when container / config is unavailable.
     */
    public static store(name?: string): CacheDriver {
        const storeName = name || this.defaultStore;

        if (this.drivers.has(storeName)) {
            return this.drivers.get(storeName)!;
        }

        // Sync-safe: only memory and file are built synchronously
        // Redis and database are built async via resolveStore()
        const driver = this.buildSyncDriver(storeName);
        this.drivers.set(storeName, driver);
        return driver;
    }

    /**
     * Async version — resolves Redis and Database stores properly.
     * Call this on app boot for async drivers, sync is fine for memory/file.
     */
    public static async resolveStore(name?: string): Promise<CacheDriver> {
        const storeName = name || this.defaultStore;

        if (this.drivers.has(storeName)) {
            return this.drivers.get(storeName)!;
        }

        const driver = await this.buildDriver(storeName);
        this.drivers.set(storeName, driver);
        return driver;
    }

    /** Register a pre-built driver instance manually. */
    public static extend(name: string, driver: CacheDriver): void {
        this.drivers.set(name, driver);
    }

    private static buildSyncDriver(storeName: string): CacheDriver {
        if (!this.container) return new MemoryDriver();

        let cfg: CacheConfig | undefined;
        try { cfg = this.container.make<CacheConfig>("config.cache"); } catch { /* ignore */ }

        const storeCfg = cfg?.stores?.[storeName];
        if (!storeCfg) {
            console.warn(`[StruxJS Cache] Store "${storeName}" not found in config/cache.ts — using MemoryDriver.`);
            return new MemoryDriver();
        }

        switch (storeCfg.driver) {
            case "memory": return new MemoryDriver();
            case "file":   return new FileDriver(storeCfg.storagePath);
            default:
                throw new Error(
                    `[StruxJS Cache] Driver "${storeCfg.driver}" requires async initialization. ` +
                    `Use Cache.resolveStore("${storeName}") instead.`
                );
        }
    }

    private static async buildDriver(storeName: string): Promise<CacheDriver> {
        if (!this.container) return new MemoryDriver();

        let cfg: CacheConfig | undefined;
        try { cfg = this.container.make<CacheConfig>("config.cache"); } catch { /* ignore */ }

        const storeCfg = cfg?.stores?.[storeName];
        if (!storeCfg) {
            console.warn(`[StruxJS Cache] Store "${storeName}" not found — using MemoryDriver.`);
            return new MemoryDriver();
        }

        switch (storeCfg.driver) {
            case "memory": return new MemoryDriver();
            case "file":   return new FileDriver(storeCfg.storagePath);

            case "database": {
                let knex: any;
                try {
                    const mod = await import("../database/BaseModel.js");
                    knex = (mod.BaseModel as any).getConnection?.();
                } catch {
                    throw new Error("[StruxJS Cache] Database connection unavailable. Ensure BaseModel.bootConnection() was called.");
                }
                return new DatabaseDriver(knex, storeCfg.table || "cache");
            }

            case "redis": {
                const redisConnName = storeCfg.redisConnection || "default";
                let redisCfg: any;
                try {
                    const allRedis = this.container.make<any>("config.redis");
                    redisCfg = allRedis?.[redisConnName];
                } catch {
                    throw new Error("[StruxJS Cache] Redis config not found. Ensure config/redis.ts is loaded.");
                }
                if (!redisCfg) {
                    throw new Error(`[StruxJS Cache] Redis connection "${redisConnName}" not found in config/redis.ts`);
                }
                const mod    = await import("ioredis");
                const Redis  = mod.default as any;
                const client = new Redis({
                    host:     redisCfg.host     || "127.0.0.1",
                    port:     redisCfg.port     || 6379,
                    password: redisCfg.password || undefined,
                    db:       redisCfg.database || 0,
                });
                return new RedisDriver(client, storeCfg.prefix || cfg?.prefix || "strux:cache:");
            }

            default:
                throw new Error(`[StruxJS Cache] Unsupported driver: "${(storeCfg as any).driver}"`);
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Proxy methods (use default store)                                      */
    /* ---------------------------------------------------------------------- */

    /** Retrieve an item from the cache. */
    public static async get<T = any>(key: string, fallback?: T | (() => T | Promise<T>)): Promise<T | null> {
        const value = await (await this.resolveStore()).get<T>(key);
        if (value !== null) return value;
        if (fallback === undefined) return null;
        return typeof fallback === "function" ? await (fallback as () => T | Promise<T>)() : fallback;
    }

    /** Retrieve multiple items at once. */
    public static async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
        return (await this.resolveStore()).many<T>(keys);
    }

    /** Store an item (ttl in seconds, 0 = forever). */
    public static async put<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        return (await this.resolveStore()).put(key, value, ttl);
    }

    /** Store multiple items with the same TTL. */
    public static async putMany<T = any>(values: Record<string, T>, ttl?: number): Promise<void> {
        return (await this.resolveStore()).putMany(values, ttl);
    }

    /**
     * Get an item or store the result of the callback if it doesn't exist.
     *
     * const user = await Cache.remember("user:1", 300, () => User.find(1));
     */
    public static async remember<T = any>(
        key: string,
        ttl: number,
        callback: () => T | Promise<T>
    ): Promise<T> {
        const driver = await this.resolveStore();
        const cached = await driver.get<T>(key);
        if (cached !== null) return cached;

        const fresh = await callback();
        await driver.put(key, fresh, ttl);
        return fresh;
    }

    /**
     * Get an item or store forever if it doesn't exist.
     */
    public static async rememberForever<T = any>(
        key: string,
        callback: () => T | Promise<T>
    ): Promise<T> {
        return this.remember(key, 0, callback);
    }

    /**
     * Get an item and immediately delete it (pull).
     */
    public static async pull<T = any>(key: string): Promise<T | null> {
        const driver = await this.resolveStore();
        const value  = await driver.get<T>(key);
        if (value !== null) await driver.forget(key);
        return value;
    }

    /** Check if an item exists and has not expired. */
    public static async has(key: string): Promise<boolean> {
        return (await this.resolveStore()).has(key);
    }

    /** Remove an item. */
    public static async forget(key: string): Promise<boolean> {
        return (await this.resolveStore()).forget(key);
    }

    /** Flush all items from the default store. */
    public static async flush(): Promise<void> {
        return (await this.resolveStore()).flush();
    }

    /** Increment a numeric value. */
    public static async increment(key: string, by = 1): Promise<number> {
        return (await this.resolveStore()).increment(key, by);
    }

    /** Decrement a numeric value. */
    public static async decrement(key: string, by = 1): Promise<number> {
        return (await this.resolveStore()).decrement(key, by);
    }

    /**
     * Store an item only if it does not already exist.
     */
    public static async add<T = any>(key: string, value: T, ttl?: number): Promise<boolean> {
        const driver = await this.resolveStore();
        if (await driver.has(key)) return false;
        await driver.put(key, value, ttl);
        return true;
    }

    /**
     * Store forever.
     */
    public static async forever<T = any>(key: string, value: T): Promise<void> {
        return (await this.resolveStore()).put(key, value, 0);
    }
}

/* -------------------------------------------------------------------------- */
/*  Global helper — cache(storeName?)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Access a cache store instance (global shorthand).
 * Returns a sync driver — only safe for memory/file stores.
 * For redis/database use cacheAsync() or Cache.resolveStore().
 *
 * await cache().put("key", value, 60);   // memory/file only
 * await cacheAsync().then(c => c.put("key", value, 60)); // all drivers
 */
export function cache(store?: string): CacheDriver {
    return Cache.store(store);
}

/**
 * Async version — safe for all drivers including redis and database.
 *
 * const c = await cacheAsync();
 * await c.put("key", value, 60);
 *
 * // Or inline:
 * await (await cacheAsync()).remember("key", 60, () => query());
 */
export function cacheAsync(store?: string): Promise<CacheDriver> {
    return Cache.resolveStore(store);
}
