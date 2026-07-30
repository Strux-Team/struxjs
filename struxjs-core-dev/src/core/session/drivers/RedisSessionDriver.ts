import { SessionDriverInterface } from "./SessionDriverInterface.js";
import Redis from "ioredis";
import { config, env } from "../../config/Config.js";

export class RedisSessionDriver implements SessionDriverInterface {
    private static redisClient: any = null;
    private keyPrefix: string;

    constructor(options?: { host?: string; port?: number; password?: string; db?: number; prefix?: string }) {
        this.keyPrefix = options?.prefix || config("redis.session.prefix") || env("REDIS_PREFIX", "strux_session:");

        if (!RedisSessionDriver.redisClient) {
            const host = options?.host || config("redis.default.host") || env("REDIS_HOST", "127.0.0.1");
            const port = Number(options?.port || config("redis.default.port") || env("REDIS_PORT", 6379));
            const password = options?.password || config("redis.default.password") || env("REDIS_PASSWORD", undefined);
            const db = Number(options?.db || config("redis.session.db") || env("REDIS_DB", 0));

            RedisSessionDriver.redisClient = new (Redis as any)({
                host,
                port,
                password,
                db,
                lazyConnect: true
            });
        }
    }

    private getClient(): any {
        return RedisSessionDriver.redisClient;
    }

    public async read(id: string): Promise<Record<string, any> | null> {
        const client = this.getClient();
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            const key = `${this.keyPrefix}${id}`;
            const raw = await client.get(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (error: any) {
            console.error(`[StruxJS Redis Session Error]: Failed reading session ${id}:`, error.message);
            return null;
        }
    }

    public async write(id: string, data: Record<string, any>, lifetimeMinutes: number): Promise<void> {
        const client = this.getClient();
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            const key = `${this.keyPrefix}${id}`;
            const payload = JSON.stringify(data);
            const ttlSeconds = lifetimeMinutes * 60;

            await client.set(key, payload, "EX", ttlSeconds);
        } catch (error: any) {
            console.error(`[StruxJS Redis Session Error]: Failed writing session ${id}:`, error.message);
        }
    }

    public async destroy(id: string): Promise<void> {
        const client = this.getClient();
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            const key = `${this.keyPrefix}${id}`;
            await client.del(key);
        } catch (error: any) {
            console.error(`[StruxJS Redis Session Error]: Failed destroying session ${id}:`, error.message);
        }
    }
}
