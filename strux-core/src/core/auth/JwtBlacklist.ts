import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { createHash } from "crypto";
import { config, env } from "../config/Config.js";

/**
 * JwtBlacklist — pluggable blacklist backend for invalidated JWT tokens.
 *
 * Two drivers available:
 *   - "memory"  (default) — in-process Set, lost on restart
 *   - "redis"             — persisted in Redis with automatic TTL expiry
 *
 * Configure via JwtGuard.configure({ blacklist: 'redis' }) or
 * JwtGuard.configure({ blacklist: 'redis', redisOptions: { host, port, ... } })
 */

export type BlacklistDriver = "memory" | "redis";

export interface BlacklistRedisOptions {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    prefix?: string;
}

export class JwtBlacklist {
    private driver: BlacklistDriver = "memory";
    private memoryStore: Set<string> = new Set();
    private redisClient: RedisClient | null = null;
    private keyPrefix: string = "strux_jwt_blacklist:";

    /* ---------------------------------------------------------------------- */
    /*  Configuration                                                          */
    /* ---------------------------------------------------------------------- */

    public useMemory(): void {
        this.driver = "memory";
        this.redisClient = null;
    }

    public useRedis(options?: BlacklistRedisOptions): void {
        this.driver = "redis";
        this.keyPrefix = options?.prefix || config("redis.jwt.prefix") || env("REDIS_JWT_PREFIX", "strux_jwt_blacklist:");

        const host     = options?.host     || config("redis.default.host")     || env("REDIS_HOST", "127.0.0.1");
        const port     = Number(options?.port     || config("redis.default.port") || env("REDIS_PORT", 6379));
        const password = options?.password || config("redis.default.password") || env("REDIS_PASSWORD", undefined);
        const db       = Number(options?.db       || config("redis.cache.db")     || env("REDIS_DB", 0));

        this.redisClient = new (Redis as any)({
            host,
            port,
            password,
            db,
            lazyConnect: false
        }) as RedisClient;
    }

    public useRedisClient(client: RedisClient, prefix?: string): void {
        this.driver      = "redis";
        this.keyPrefix   = prefix || config("redis.jwt.prefix") || env("REDIS_JWT_PREFIX", "strux_jwt_blacklist:");
        this.redisClient = client;
    }

    /* ---------------------------------------------------------------------- */
    /*  Private Redis helpers                                                  */
    /* ---------------------------------------------------------------------- */

    private async getRedis(): Promise<RedisClient> {
        if (!this.redisClient) throw new Error("[StruxJS JWT Blacklist]: Redis client not initialized.");
        return this.redisClient;
    }

    private redisKey(token: string): string {
        const fingerprint = createHash("sha256").update(token).digest("hex");
        return `${this.keyPrefix}${fingerprint}`;
    }

    /* ---------------------------------------------------------------------- */
    /*  Public API                                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Add a token to the blacklist.
     * @param token     — raw JWT string
     * @param ttlSeconds — remaining lifetime in seconds (Redis TTL); ignored for memory driver
     */
    public async add(token: string, ttlSeconds: number): Promise<void> {
        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const key = this.redisKey(token);
                // Value "1" is just a marker; TTL ensures auto-cleanup when the token would expire anyway
                await redis.set(key, "1", "EX", Math.max(1, ttlSeconds));
            } catch (err: any) {
                console.error("[StruxJS JWT Blacklist]: Redis add failed, falling back to memory.", err.message);
                this.memoryStore.add(token);
            }
        } else {
            this.memoryStore.add(token);
        }
    }

    /**
     * Check whether a token has been blacklisted.
     * Returns true if the token should be rejected.
     */
    public async has(token: string): Promise<boolean> {
        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const key = this.redisKey(token);
                const val = await redis.get(key);
                return val !== null;
            } catch (err: any) {
                console.error("[StruxJS JWT Blacklist]: Redis has() failed, falling back to memory.", err.message);
                return this.memoryStore.has(token);
            }
        }
        return this.memoryStore.has(token);
    }

    /**
     * Remove a token from the blacklist (rarely needed, prefer TTL expiry).
     */
    public async remove(token: string): Promise<void> {
        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                await redis.del(this.redisKey(token));
            } catch {}
        } else {
            this.memoryStore.delete(token);
        }
    }

    /**
     * Flush the entire blacklist (memory driver only; Redis keys expire on their own).
     */
    public flush(): void {
        this.memoryStore.clear();
    }
}

// Singleton instance shared across JwtGuard
export const jwtBlacklist = new JwtBlacklist();
