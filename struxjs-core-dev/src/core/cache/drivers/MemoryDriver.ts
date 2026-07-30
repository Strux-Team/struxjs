import { CacheDriver } from "./CacheDriver.js";

interface MemoryEntry {
    value: any;
    expiresAt: number | null; // null = never
}

/**
 * MemoryDriver — in-process Map with TTL support.
 * Items are lost when the process restarts.
 * Best for: unit testing, single-request caching.
 */
export class MemoryDriver implements CacheDriver {
    private store: Map<string, MemoryEntry> = new Map();

    /* ---------------------------------------------------------------------- */

    public async get<T = any>(key: string): Promise<T | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value as T;
    }

    public async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
        const result: Record<string, T | null> = {};
        for (const key of keys) {
            result[key] = await this.get<T>(key);
        }
        return result;
    }

    public async put<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttl && ttl > 0 ? Date.now() + ttl * 1000 : null,
        });
    }

    public async putMany<T = any>(values: Record<string, T>, ttl?: number): Promise<void> {
        for (const [key, value] of Object.entries(values)) {
            await this.put(key, value, ttl);
        }
    }

    public async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== null;
    }

    public async forget(key: string): Promise<boolean> {
        return this.store.delete(key);
    }

    public async flush(): Promise<void> {
        this.store.clear();
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

    /** Return current item count (includes potentially expired entries). */
    public size(): number {
        return this.store.size;
    }
}
