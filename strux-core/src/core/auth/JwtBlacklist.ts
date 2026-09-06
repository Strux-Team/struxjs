import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { config, env } from "../config/Config.js";
import { parseTtlToSeconds } from "./ttl.js";

/**
 * JwtBlacklist — invalidates JWT tokens before their natural expiry.
 *
 * Used for:
 *   - Logout: Auth.jwt().invalidateRequestToken()
 *   - Manual revocation: Auth.jwt().invalidate(token)
 *   - Token rotation: old refresh token is blacklisted when a new one is issued
 *
 * Drivers:
 *   "memory"  — in-memory Set; suitable for single-instance apps and tests
 *   "redis"   — shared across multiple instances with automatic TTL expiry
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
    private redisClient: RedisClient | null = null;
    private keyPrefix: string = "strux_jwt_blacklist:";

    // Memory driver store
    private memoryStore: Set<string> = new Set();

    /* ---------------------------------------------------------------------- */
    /*  Driver configuration                                                   */
    /* ---------------------------------------------------------------------- */

    public useMemory(): void {
        this.driver = "memory";
        this.redisClient = null;
    }

    public useRedis(options?: BlacklistRedisOptions): void {
        this.driver = "redis";
        const globalPrefix = config("redis.default.prefix") ?? env("REDIS_PREFIX", "");
        this.keyPrefix = options?.prefix || config("redis.jwt.prefix") || env("REDIS_JWT_PREFIX", `${globalPrefix}jwt_blacklist:`);

        const host     = options?.host     || config("redis.default.host")     || env("REDIS_HOST", "127.0.0.1");
        const port     = Number(options?.port  || config("redis.default.port") || env("REDIS_PORT", 6379));
        const password = options?.password || config("redis.default.password")  || env("REDIS_PASSWORD", undefined);
        const db       = Number(options?.db    || config("redis.cache.db")   || env("REDIS_DB", 0));

        this.redisClient = new (Redis as any)({ host, port, password, db, lazyConnect: false }) as RedisClient;
    }

    public useRedisClient(client: RedisClient, prefix?: string): void {
        this.driver      = "redis";
        const globalPrefix = config("redis.default.prefix") ?? env("REDIS_PREFIX", "");
        this.keyPrefix   = prefix || config("redis.jwt.prefix") || env("REDIS_JWT_PREFIX", `${globalPrefix}jwt_blacklist:`);
        this.redisClient = client;
    }

    /* ---------------------------------------------------------------------- */
    /*  Private Redis helpers                                                  */
    /* ---------------------------------------------------------------------- */

    private async getRedis(): Promise<RedisClient> {
        if (!this.redisClient) throw new Error("[StruxJS JWT Blacklist]: Redis client not initialized.");
        return this.redisClient;
    }

    /**
     * Resolve unique identifier: prefers jti claim, otherwise SHA-256 fingerprint.
     */
    private resolveIdentifier(tokenOrJti: string): string {
        if (tokenOrJti.includes(".")) {
            try {
                const decoded = jwt.decode(tokenOrJti) as any;
                if (decoded?.jti) {
                    return decoded.jti;
                }
            } catch {}
            return createHash("sha256").update(tokenOrJti).digest("hex");
        }
        return tokenOrJti;
    }

    private redisKey(tokenOrJti: string): string {
        const id = this.resolveIdentifier(tokenOrJti);
        return `${this.keyPrefix}${id}`;
    }

    /* ---------------------------------------------------------------------- */
    /*  Public API                                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Add a token or JTI to the blacklist.
     * @param tokenOrJti — raw JWT string or JTI identifier
     * @param ttlSeconds — remaining lifetime in seconds (or duration string); ignored for memory driver
     */
    public async add(tokenOrJti: string, ttlSeconds: number | string): Promise<void> {
        const id = this.resolveIdentifier(tokenOrJti);
        const ttl = parseTtlToSeconds(ttlSeconds, 3600);

        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const key = `${this.keyPrefix}${id}`;
                // Value "1" is just a marker; TTL ensures auto-cleanup when the token would expire anyway
                await redis.set(key, "1", "EX", ttl);
            } catch (err: any) {
                console.error("[StruxJS JWT Blacklist]: Redis add failed, falling back to memory.", err.message);
                this.memoryStore.add(id);
            }
        } else {
            this.memoryStore.add(id);
        }
    }

    /**
     * Check whether a token or JTI has been blacklisted.
     * Returns true if the token should be rejected.
     */
    public async has(tokenOrJti: string): Promise<boolean> {
        const id = this.resolveIdentifier(tokenOrJti);

        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const key = `${this.keyPrefix}${id}`;
                const val = await redis.get(key);
                if (val !== null) return true;
            } catch (err: any) {
                console.error("[StruxJS JWT Blacklist]: Redis has() failed, falling back to memory.", err.message);
            }
        }
        return this.memoryStore.has(id);
    }

    /**
     * Remove a token or JTI from the blacklist (rarely needed, prefer TTL expiry).
     */
    public async remove(tokenOrJti: string): Promise<void> {
        const id = this.resolveIdentifier(tokenOrJti);

        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                await redis.del(`${this.keyPrefix}${id}`);
            } catch {}
        }
        this.memoryStore.delete(id);
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
