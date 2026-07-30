import { Redis as RedisClient } from "ioredis";
import { config, env } from "../config/Config.js";

export class RedisManager {
    private static connections: Map<string, RedisClient> = new Map();

    /**
     * Get or create a Redis connection instance for a given named configuration
     * @param name Connection name (e.g. 'default', 'cache', 'queue')
     */
    public static connection(name = "default"): RedisClient {
        if (this.connections.has(name)) {
            return this.connections.get(name)!;
        }

        const redisConfig = config(`redis.${name}`) || config(`database.redis.${name}`) || config("redis.default") || config("database.redis.default") || {};

        const host = redisConfig.host || env("REDIS_HOST", "127.0.0.1");
        const port = Number(redisConfig.port || env("REDIS_PORT", 6379));
        const password = redisConfig.password || env("REDIS_PASSWORD", undefined);
        const db = Number(redisConfig.database ?? redisConfig.db ?? env("REDIS_DB", 0));
        const keyPrefix = redisConfig.keyPrefix || redisConfig.prefix || env("REDIS_PREFIX", undefined);

        const options: any = {
            host,
            port,
            password,
            db,
            lazyConnect: false,
            ...redisConfig
        };

        if (keyPrefix) {
            options.keyPrefix = keyPrefix;
        }

        const client = new RedisClient(options);

        this.connections.set(name, client);
        return client;
    }

    /**
     * Alias for Redis.connection(name)
     */
    public static client(name = "default"): RedisClient {
        return this.connection(name);
    }

    /**
     * Disconnect a specific named connection or all open Redis connections
     */
    public static async disconnect(name?: string): Promise<void> {
        if (name) {
            const client = this.connections.get(name);
            if (client) {
                await client.quit();
                this.connections.delete(name);
            }
        } else {
            for (const [key, client] of this.connections.entries()) {
                await client.quit();
                this.connections.delete(key);
            }
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Convenience Proxy Methods (delegates to default connection)           */
    /* ---------------------------------------------------------------------- */

    public static async get(key: string): Promise<string | null> {
        return this.connection().get(key);
    }

    public static async set(key: string, value: string | number, mode?: string, duration?: number): Promise<string | null> {
        if (mode && duration !== undefined) {
            return (this.connection() as any).set(key, value, mode, duration);
        }
        return this.connection().set(key, value);
    }

    public static async setex(key: string, seconds: number, value: string | number): Promise<string> {
        return this.connection().setex(key, seconds, value);
    }

    public static async del(...keys: string[]): Promise<number> {
        return this.connection().del(...keys);
    }

    public static async exists(...keys: string[]): Promise<number> {
        return this.connection().exists(...keys);
    }

    public static async expire(key: string, seconds: number): Promise<number> {
        return this.connection().expire(key, seconds);
    }

    public static async ttl(key: string): Promise<number> {
        return this.connection().ttl(key);
    }

    public static async incr(key: string): Promise<number> {
        return this.connection().incr(key);
    }

    public static async decr(key: string): Promise<number> {
        return this.connection().decr(key);
    }

    public static async incrby(key: string, increment: number): Promise<number> {
        return this.connection().incrby(key, increment);
    }

    public static async decrby(key: string, decrement: number): Promise<number> {
        return this.connection().decrby(key, decrement);
    }

    public static async hget(key: string, field: string): Promise<string | null> {
        return this.connection().hget(key, field);
    }

    public static async hset(key: string, fieldOrObject: string | Record<string, any>, value?: any): Promise<number> {
        if (typeof fieldOrObject === "object") {
            return this.connection().hset(key, fieldOrObject);
        }
        return this.connection().hset(key, fieldOrObject, value);
    }

    public static async hgetall(key: string): Promise<Record<string, string>> {
        return this.connection().hgetall(key);
    }

    public static async hdel(key: string, ...fields: string[]): Promise<number> {
        return this.connection().hdel(key, ...fields);
    }

    public static async lpush(key: string, ...values: (string | number)[]): Promise<number> {
        return this.connection().lpush(key, ...values);
    }

    public static async rpush(key: string, ...values: (string | number)[]): Promise<number> {
        return this.connection().rpush(key, ...values);
    }

    public static async lpop(key: string): Promise<string | null> {
        return this.connection().lpop(key);
    }

    public static async rpop(key: string): Promise<string | null> {
        return this.connection().rpop(key);
    }

    public static async lrange(key: string, start: number, stop: number): Promise<string[]> {
        return this.connection().lrange(key, start, stop);
    }

    public static async sadd(key: string, ...members: (string | number)[]): Promise<number> {
        return this.connection().sadd(key, ...members);
    }

    public static async smembers(key: string): Promise<string[]> {
        return this.connection().smembers(key);
    }

    public static async srem(key: string, ...members: (string | number)[]): Promise<number> {
        return this.connection().srem(key, ...members);
    }

    public static async publish(channel: string, message: string): Promise<number> {
        return this.connection().publish(channel, message);
    }

    public static async subscribe(...channels: string[]): Promise<any> {
        return this.connection().subscribe(...channels);
    }

    public static async flushdb(): Promise<string> {
        return this.connection().flushdb();
    }
}

/**
 * Proxy wrapper enabling direct access to native ioredis commands via Redis.commandName(...)
 */
export const Redis: typeof RedisManager & Record<string, any> = new Proxy(RedisManager, {
    get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
            return Reflect.get(target, prop, receiver);
        }
        const client = target.connection();
        const value = (client as any)[prop];
        if (typeof value === "function") {
            return value.bind(client);
        }
        return value;
    }
}) as any;
