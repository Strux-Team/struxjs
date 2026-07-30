import fs   from "fs";
import path from "path";
import crypto from "crypto";
import { CacheDriver } from "./CacheDriver.js";

interface FileEntry {
    value: any;
    expiresAt: number | null;
}

/**
 * FileDriver — stores each cache key as a JSON file on disk.
 *
 * Directory layout:
 *   <storagePath>/
 *     <hashed-key>.json
 *
 * Best for: single-server setups without Redis/DB.
 */
export class FileDriver implements CacheDriver {
    private storagePath: string;

    constructor(storagePath?: string) {
        this.storagePath = storagePath
            || path.join(process.cwd(), "storage", "framework", "cache");
        this.ensureDir();
    }

    /* ---------------------------------------------------------------------- */
    /*  Path helpers                                                           */
    /* ---------------------------------------------------------------------- */

    private ensureDir(): void {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    private filePath(key: string): string {
        const hash = crypto.createHash("sha256").update(key).digest("hex");
        return path.join(this.storagePath, `${hash}.json`);
    }

    private read(key: string): FileEntry | null {
        const fp = this.filePath(key);
        if (!fs.existsSync(fp)) return null;
        try {
            return JSON.parse(fs.readFileSync(fp, "utf-8")) as FileEntry;
        } catch {
            return null;
        }
    }

    private write(key: string, entry: FileEntry): void {
        fs.writeFileSync(this.filePath(key), JSON.stringify(entry), "utf-8");
    }

    /* ---------------------------------------------------------------------- */
    /*  CacheDriver implementation                                             */
    /* ---------------------------------------------------------------------- */

    public async get<T = any>(key: string): Promise<T | null> {
        const entry = this.read(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            fs.unlinkSync(this.filePath(key));
            return null;
        }
        return entry.value as T;
    }

    public async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
        const result: Record<string, T | null> = {};
        for (const key of keys) result[key] = await this.get<T>(key);
        return result;
    }

    public async put<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        this.write(key, {
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
        const fp = this.filePath(key);
        if (!fs.existsSync(fp)) return false;
        fs.unlinkSync(fp);
        return true;
    }

    public async flush(): Promise<void> {
        const files = fs.readdirSync(this.storagePath).filter(f => f.endsWith(".json"));
        for (const file of files) {
            fs.unlinkSync(path.join(this.storagePath, file));
        }
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
