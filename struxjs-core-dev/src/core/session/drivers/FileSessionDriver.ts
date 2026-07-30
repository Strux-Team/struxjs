import fs from "fs";
import path from "path";
import { SessionDriverInterface } from "./SessionDriverInterface.js";

export class FileSessionDriver implements SessionDriverInterface {
    private storageDir: string;

    constructor(customStorageDir?: string) {
        this.storageDir = customStorageDir || path.join(process.cwd(), "storage", "framework", "sessions");
    }

    public async read(id: string): Promise<Record<string, any> | null> {
        const filePath = path.join(this.storageDir, `${id}.json`);
        if (!fs.existsSync(filePath)) return null;

        try {
            const raw = await fs.promises.readFile(filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
                await this.destroy(id);
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    public async write(id: string, data: Record<string, any>, lifetimeMinutes: number): Promise<void> {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }

        const filePath = path.join(this.storageDir, `${id}.json`);
        const expiresAt = Date.now() + (lifetimeMinutes * 60 * 1000);
        const payload = JSON.stringify({ ...data, expiresAt });

        await fs.promises.writeFile(filePath, payload, "utf8");
    }

    public async destroy(id: string): Promise<void> {
        const filePath = path.join(this.storageDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
            try {
                await fs.promises.unlink(filePath);
            } catch {}
        }
    }
}
