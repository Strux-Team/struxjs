import type { Redis as RedisClient } from "ioredis";
import { CacheDriver } from "./CacheDriver.js";

/**
 * RedisDriver — uses ioredis for cache storage.
 * TTL is enforced natively by Redis via SETEX / EXPIRE.
 */
export class RedisDriver implements CacheDriver {
    constructor(
        private redis: RedisClient,
        private prefix: string = "strux:cache:"
    ) {}

    private k(key: string): string {
        return `${this.prefix}${key}`;
    }

    /* ---------------------------------------------------------------------- */

    public async get<T = any>(key: string): Promise<T | null> {
        const raw = await this.redis.get(this.k(key));
        if (raw === null) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return raw as unknown as T;
        }
    }

    public async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
        if (keys.length === 0) return {};
        const redisKeys = keys.map(k => this.k(k));
        const values    = await this.redis.mget(...redisKeys);
        const result: Record<string, T | null> = {};
        keys.forEach((key, i) => {
            const raw = values[i];
            result[key] = raw !== null && raw !== undefined
                ? (() => { try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; } })()
                : null;
        });
        return result;
    }

    public async put<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        const serialized = JSON.stringify(value);
        if (ttl && ttl > 0) {
            await this.redis.setex(this.k(key), ttl, serialized);
        } else {
            await this.redis.set(this.k(key), serialized);
        }
    }

    public async putMany<T = any>(values: Record<string, T>, ttl?: number): Promise<void> {
        const pipeline = this.redis.pipeline();
        for (const [key, value] of Object.entries(values)) {
            const serialized = JSON.stringify(value);
            if (ttl && ttl > 0) {
                pipeline.setex(this.k(key), ttl, serialized);
            } else {
                pipeline.set(this.k(key), serialized);
            }
        }
        await pipeline.exec();
    }

    public async has(key: string): Promise<boolean> {
        return (await this.redis.exists(this.k(key))) > 0;
    }

    public async forget(key: string): Promise<boolean> {
        const deleted = await this.redis.del(this.k(key));
        return deleted > 0;
    }

    public async flush(): Promise<void> {
        const keys = await this.redis.keys(`${this.prefix}*`);
        if (keys.length > 0) {
            await this.redis.del(...keys);
        }
    }

    public async increment(key: string, by = 1): Promise<number> {
        const result = by === 1
            ? await this.redis.incr(this.k(key))
            : await this.redis.incrby(this.k(key), by);
        return result;
    }

    public async decrement(key: string, by = 1): Promise<number> {
        const result = by === 1
            ? await this.redis.decr(this.k(key))
            : await this.redis.decrby(this.k(key), by);
        return result;
    }
}
