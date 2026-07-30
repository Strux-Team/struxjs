import { CacheDriver } from "./CacheDriver.js";

/**
 * DatabaseDriver — stores cache items in a SQL table via knex.
 *
 * Table schema (created by `strux cache:table` + migrate):
 *
 *   cache
 *     key        VARCHAR(255) PRIMARY KEY
 *     value      TEXT NOT NULL
 *     expires_at BIGINT NULL   (unix timestamp ms, null = forever)
 */
export class DatabaseDriver implements CacheDriver {
    constructor(
        private knex: any,
        private table: string = "cache"
    ) {}

    /* ---------------------------------------------------------------------- */
    /*  Internal helpers                                                       */
    /* ---------------------------------------------------------------------- */

    private async getRow(key: string): Promise<any | null> {
        const row = await this.knex(this.table).where("key", key).first();
        if (!row) return null;

        if (row.expires_at !== null && Date.now() > Number(row.expires_at)) {
            await this.knex(this.table).where("key", key).delete();
            return null;
        }
        return row;
    }

    /* ---------------------------------------------------------------------- */
    /*  CacheDriver implementation                                             */
    /* ---------------------------------------------------------------------- */

    public async get<T = any>(key: string): Promise<T | null> {
        const row = await this.getRow(key);
        if (!row) return null;
        try { return JSON.parse(row.value) as T; } catch { return row.value as T; }
    }

    public async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
        const result: Record<string, T | null> = {};
        for (const key of keys) result[key] = await this.get<T>(key);
        return result;
    }

    public async put<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        const serialized = JSON.stringify(value);
        const expiresAt  = ttl && ttl > 0 ? Date.now() + ttl * 1000 : null;

        const exists = await this.knex(this.table).where("key", key).first();
        if (exists) {
            await this.knex(this.table).where("key", key).update({
                value:      serialized,
                expires_at: expiresAt,
            });
        } else {
            await this.knex(this.table).insert({
                key,
                value:      serialized,
                expires_at: expiresAt,
            });
        }
    }

    public async putMany<T = any>(values: Record<string, T>, ttl?: number): Promise<void> {
        for (const [key, value] of Object.entries(values)) {
            await this.put(key, value, ttl);
        }
    }

    public async has(key: string): Promise<boolean> {
        return (await this.getRow(key)) !== null;
    }

    public async forget(key: string): Promise<boolean> {
        const deleted = await this.knex(this.table).where("key", key).delete();
        return deleted > 0;
    }

    public async flush(): Promise<void> {
        await this.knex(this.table).delete();
    }

    public async increment(key: string, by = 1): Promise<number> {
        const current = (await this.get<number>(key)) ?? 0;
        const next    = current + by;
        await this.put(key, next);
        return next;
    }

    public async decrement(key: string, by = 1): Promise<number> {
        return this.increment(key, -by);
    }
}
