import fs from "fs";
import path from "path";
import { QueueDriver } from "./QueueDriver.js";
import { JobEnvelope } from "../Job.js";

/**
 * FileDriver — persists jobs as JSON files on disk.
 *
 * Directory layout:
 *   <storagePath>/
 *     <queue>/
 *       <id>.json          — pending / reserved jobs
 *     failed/
 *       <id>.json          — permanently failed jobs
 *
 * Each file contains a single serialised JobEnvelope.
 * Useful for single-server setups and local development without Redis/DB.
 */
export class FileDriver implements QueueDriver {
    private storagePath: string;

    constructor(storagePath?: string) {
        this.storagePath = storagePath
            || path.join(process.cwd(), "storage", "framework", "queue");
    }

    /* ---------------------------------------------------------------------- */
    /*  Path helpers                                                           */
    /* ---------------------------------------------------------------------- */

    private queueDir(queue: string): string {
        return path.join(this.storagePath, queue);
    }

    private failedDir(): string {
        return path.join(this.storagePath, "failed");
    }

    private jobPath(queue: string, id: string): string {
        return path.join(this.queueDir(queue), `${id}.json`);
    }

    private failedPath(id: string): string {
        return path.join(this.failedDir(), `${id}.json`);
    }

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    /* ---------------------------------------------------------------------- */
    /*  QueueDriver implementation                                             */
    /* ---------------------------------------------------------------------- */

    public async push(envelope: JobEnvelope, queue: string): Promise<void> {
        this.ensureDir(this.queueDir(queue));
        const filePath = this.jobPath(queue, envelope.id);
        fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), "utf-8");
    }

    public async pop(queue: string): Promise<JobEnvelope | null> {
        const dir = this.queueDir(queue);
        this.ensureDir(dir);

        const now   = Date.now();
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith(".json") && !f.endsWith(".reserved.json"));

        // Read and filter available (non-reserved, non-delayed) jobs
        const candidates: Array<{ file: string; envelope: JobEnvelope }> = [];

        for (const file of files) {
            const fullPath = path.join(dir, file);
            try {
                const envelope = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as JobEnvelope;

                // Skip if reserved
                if ((envelope as any)._reservedAt) continue;

                // Skip if delayed
                const availableAt = (envelope as any)._availableAt || envelope.createdAt;
                if (availableAt > now) continue;

                candidates.push({ file, envelope });
            } catch {
                // Corrupt file — skip
            }
        }

        if (candidates.length === 0) return null;

        // Pick the oldest job
        candidates.sort((a, b) =>
            ((a.envelope as any)._availableAt || a.envelope.createdAt) -
            ((b.envelope as any)._availableAt || b.envelope.createdAt)
        );

        const { file, envelope } = candidates[0];

        // Mark as reserved
        (envelope as any)._reservedAt = now;
        const fullPath = path.join(dir, file);
        fs.writeFileSync(fullPath, JSON.stringify(envelope, null, 2), "utf-8");

        return envelope;
    }

    public async ack(envelope: JobEnvelope, queue: string): Promise<void> {
        const filePath = this.jobPath(queue, envelope.id);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    public async nack(envelope: JobEnvelope, queue: string): Promise<void> {
        envelope.attempts++;
        delete (envelope as any)._reservedAt;
        (envelope as any)._availableAt = Date.now();

        const filePath = this.jobPath(queue, envelope.id);
        fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), "utf-8");
    }

    public async fail(envelope: JobEnvelope, queue: string): Promise<void> {
        // Remove from queue dir
        const jobFile = this.jobPath(queue, envelope.id);
        if (fs.existsSync(jobFile)) fs.unlinkSync(jobFile);

        // Write to failed dir
        this.ensureDir(this.failedDir());
        envelope.failedAt = Date.now();
        delete (envelope as any)._reservedAt;
        fs.writeFileSync(this.failedPath(envelope.id), JSON.stringify(envelope, null, 2), "utf-8");
    }

    public async getFailed(queue?: string): Promise<JobEnvelope[]> {
        const dir = this.failedDir();
        this.ensureDir(dir);

        const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
        const envelopes: JobEnvelope[] = [];

        for (const file of files) {
            try {
                const envelope = JSON.parse(
                    fs.readFileSync(path.join(dir, file), "utf-8")
                ) as JobEnvelope;
                if (!queue || envelope.queue === queue) {
                    envelopes.push(envelope);
                }
            } catch {
                // Corrupt file — skip
            }
        }

        // Sort newest-first
        return envelopes.sort((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0));
    }

    public async retryFailed(id: string): Promise<boolean> {
        const failedFile = this.failedPath(id);
        if (!fs.existsSync(failedFile)) return false;

        const envelope = JSON.parse(fs.readFileSync(failedFile, "utf-8")) as JobEnvelope;

        // Remove from failed
        fs.unlinkSync(failedFile);

        // Reset and re-queue
        envelope.attempts = 0;
        delete (envelope as any).failedAt;
        delete (envelope as any).lastError;
        delete (envelope as any)._reservedAt;
        (envelope as any)._availableAt = Date.now();

        await this.push(envelope, envelope.queue);
        return true;
    }

    public async flushFailed(): Promise<void> {
        const dir = this.failedDir();
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
        for (const file of files) {
            fs.unlinkSync(path.join(dir, file));
        }
    }

    public async size(queue: string): Promise<number> {
        const dir = this.queueDir(queue);
        if (!fs.existsSync(dir)) return 0;

        const now = Date.now();
        const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
        let count = 0;

        for (const file of files) {
            try {
                const envelope = JSON.parse(
                    fs.readFileSync(path.join(dir, file), "utf-8")
                ) as JobEnvelope;
                // Count only available (non-reserved, non-delayed) jobs
                if (!(envelope as any)._reservedAt) {
                    const availableAt = (envelope as any)._availableAt || envelope.createdAt;
                    if (availableAt <= now) count++;
                }
            } catch { /* skip */ }
        }

        return count;
    }
}
