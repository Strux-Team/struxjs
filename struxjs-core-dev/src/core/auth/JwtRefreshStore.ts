import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { createHash, randomBytes } from "crypto";
import { config, env } from "../config/Config.js";

/**
 * JwtRefreshStore — persists issued refresh tokens in Redis.
 *
 * Storage layout:
 *   strux_rt:<jti>           → JSON token record (TTL = refreshTtl)
 *   strux_rt:user:<userId>   → Redis SET of active jti values for the user
 *
 * Each refresh token is identified by a unique JTI (JWT ID) claim embedded
 * at issuance time so we can look it up and revoke it individually.
 *
 * Drivers:
 *   "memory"  — Map-based fallback, useful for tests / single-process apps
 *   "redis"   — production-grade, shared across instances
 */

export type RefreshStoreDriver = "memory" | "redis";

export interface RefreshTokenRecord {
    jti: string;
    userId: any;
    guard: string;
    expiresAt: number;   // Unix timestamp (seconds)
    createdAt: number;
}

export interface RefreshStoreRedisOptions {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    prefix?: string;
}

export class JwtRefreshStore {
    private driver: RefreshStoreDriver = "memory";
    private redisClient: RedisClient | null = null;
    private keyPrefix: string = "strux_rt:";

    // Memory fallback stores
    private memoryTokens: Map<string, RefreshTokenRecord> = new Map();
    private memoryUserIndex: Map<string, Set<string>> = new Map();

    /* ---------------------------------------------------------------------- */
    /*  Driver configuration                                                   */
    /* ---------------------------------------------------------------------- */

    public useMemory(): void {
        this.driver = "memory";
        this.redisClient = null;
    }

    public useRedis(options?: RefreshStoreRedisOptions): void {
        this.driver = "redis";
        this.keyPrefix = options?.prefix || config("redis.jwt_refresh.prefix") || env("REDIS_JWT_REFRESH_PREFIX", "strux_rt:");

        const host     = options?.host     || config("redis.default.host")     || env("REDIS_HOST", "127.0.0.1");
        const port     = Number(options?.port  || config("redis.default.port") || env("REDIS_PORT", 6379));
        const password = options?.password || config("redis.default.password")  || env("REDIS_PASSWORD", undefined);
        const db       = Number(options?.db    || config("redis.cache.db")   || env("REDIS_DB", 0));

        this.redisClient = new (Redis as any)({ host, port, password, db, lazyConnect: false }) as RedisClient;
    }

    public useRedisClient(client: RedisClient, prefix?: string): void {
        this.driver      = "redis";
        this.keyPrefix   = prefix || config("redis.jwt_refresh.prefix") || env("REDIS_JWT_REFRESH_PREFIX", "strux_rt:");
        this.redisClient = client;
    }

    /* ---------------------------------------------------------------------- */
    /*  Internal helpers                                                       */
    /* ---------------------------------------------------------------------- */

    private async getRedis(): Promise<RedisClient> {
        if (!this.redisClient) throw new Error("[StruxJS JWT RefreshStore]: Redis client not initialized.");
        return this.redisClient;
    }

    /** Redis key for a single refresh token record */
    private tokenKey(jti: string): string {
        return `${this.keyPrefix}${jti}`;
    }

    /** Redis key for the user → JTI index set */
    private userKey(userId: any): string {
        return `${this.keyPrefix}user:${userId}`;
    }

    /* ---------------------------------------------------------------------- */
    /*  Public API                                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Generate a unique JTI for a new refresh token.
     */
    public generateJti(): string {
        return createHash("sha256")
            .update(randomBytes(32))
            .digest("hex");
    }

    /**
     * Persist a newly issued refresh token.
     *
     * @param jti         — unique token identifier (embedded in JWT claims)
     * @param userId      — owner's primary key
     * @param guard       — guard name
     * @param ttlSeconds  — token lifetime in seconds
     */
    public async store(jti: string, userId: any, guard: string, ttlSeconds: number): Promise<void> {
        const record: RefreshTokenRecord = {
            jti,
            userId,
            guard,
            expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
            createdAt: Math.floor(Date.now() / 1000)
        };

        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();

                // Store the record with TTL
                await redis.set(
                    this.tokenKey(jti),
                    JSON.stringify(record),
                    "EX",
                    ttlSeconds
                );

                // Add JTI to the user's active set (set TTL slightly longer than token)
                await redis.sadd(this.userKey(userId), jti);
                await redis.expire(this.userKey(userId), ttlSeconds + 60);
            } catch (err: any) {
                console.error("[StruxJS JWT RefreshStore]: Redis store failed, using memory fallback.", err.message);
                this.memoryTokens.set(jti, record);
                this._memoryUserIndexAdd(String(userId), jti);
            }
        } else {
            this.memoryTokens.set(jti, record);
            this._memoryUserIndexAdd(String(userId), jti);
        }
    }

    /**
     * Look up a refresh token by JTI.
     * Returns null if not found or already expired.
     */
    public async find(jti: string): Promise<RefreshTokenRecord | null> {
        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const raw = await redis.get(this.tokenKey(jti));
                if (!raw) return null;
                return JSON.parse(raw) as RefreshTokenRecord;
            } catch (err: any) {
                console.error("[StruxJS JWT RefreshStore]: Redis find failed, checking memory.", err.message);
            }
        }

        const record = this.memoryTokens.get(jti);
        if (!record) return null;

        // Memory: manual TTL check
        if (record.expiresAt < Math.floor(Date.now() / 1000)) {
            this.memoryTokens.delete(jti);
            return null;
        }

        return record;
    }

    /**
     * Revoke a specific refresh token by JTI.
     */
    public async revoke(jti: string): Promise<void> {
        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const raw = await redis.get(this.tokenKey(jti));
                if (raw) {
                    const record: RefreshTokenRecord = JSON.parse(raw);
                    await redis.del(this.tokenKey(jti));
                    await redis.srem(this.userKey(record.userId), jti);
                }
                return;
            } catch (err: any) {
                console.error("[StruxJS JWT RefreshStore]: Redis revoke failed, removing from memory.", err.message);
            }
        }

        const record = this.memoryTokens.get(jti);
        if (record) {
            this.memoryTokens.delete(jti);
            this.memoryUserIndex.get(String(record.userId))?.delete(jti);
        }
    }

    /**
     * Revoke ALL refresh tokens for a given user.
     * Use after password change, account compromise, or forced global logout.
     *
     * await Auth.jwt().revokeAllTokens(userId);
     */
    public async revokeAll(userId: any): Promise<void> {
        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const jtis = await redis.smembers(this.userKey(userId));

                if (jtis.length > 0) {
                    const pipeline = redis.pipeline();
                    for (const jti of jtis) {
                        pipeline.del(this.tokenKey(jti));
                    }
                    pipeline.del(this.userKey(userId));
                    await pipeline.exec();
                }
                return;
            } catch (err: any) {
                console.error("[StruxJS JWT RefreshStore]: Redis revokeAll failed, flushing memory.", err.message);
            }
        }

        const jtis = this.memoryUserIndex.get(String(userId));
        if (jtis) {
            for (const jti of jtis) {
                this.memoryTokens.delete(jti);
            }
            this.memoryUserIndex.delete(String(userId));
        }
    }

    /**
     * List all active refresh token records for a given user.
     *
     * const sessions = await Auth.jwt().getActiveSessions(userId);
     */
    public async listByUser(userId: any): Promise<RefreshTokenRecord[]> {
        const records: RefreshTokenRecord[] = [];
        const now = Math.floor(Date.now() / 1000);

        if (this.driver === "redis") {
            try {
                const redis = await this.getRedis();
                const jtis = await redis.smembers(this.userKey(userId));

                for (const jti of jtis) {
                    const raw = await redis.get(this.tokenKey(jti));
                    if (raw) {
                        const record: RefreshTokenRecord = JSON.parse(raw);
                        if (record.expiresAt > now) records.push(record);
                    }
                }

                return records;
            } catch (err: any) {
                console.error("[StruxJS JWT RefreshStore]: Redis listByUser failed, reading from memory.", err.message);
            }
        }

        const jtis = this.memoryUserIndex.get(String(userId));
        if (jtis) {
            for (const jti of jtis) {
                const record = this.memoryTokens.get(jti);
                if (record && record.expiresAt > now) {
                    records.push(record);
                }
            }
        }

        return records;
    }

    /* ---------------------------------------------------------------------- */
    /*  Memory index helpers                                                   */
    /* ---------------------------------------------------------------------- */

    private _memoryUserIndexAdd(userId: string, jti: string): void {
        if (!this.memoryUserIndex.has(userId)) {
            this.memoryUserIndex.set(userId, new Set());
        }
        this.memoryUserIndex.get(userId)!.add(jti);
    }
}

// Singleton instance shared by JwtGuard
export const jwtRefreshStore = new JwtRefreshStore();
