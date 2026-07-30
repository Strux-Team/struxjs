import { QueueDriver } from "./QueueDriver.js";
import { JobEnvelope } from "../Job.js";

/**
 * DatabaseDriver — persists jobs in a SQL table via knex.
 *
 * Table layout (created by `strux queue:table` migration):
 *
 *   jobs
 *     id          VARCHAR(36) PRIMARY KEY
 *     queue       VARCHAR(255) NOT NULL  DEFAULT 'default'
 *     payload     TEXT NOT NULL          (JSON-serialised JobEnvelope)
 *     attempts    INT  NOT NULL  DEFAULT 0
 *     available_at BIGINT NOT NULL       (unix timestamp ms — for delayed jobs)
 *     reserved_at  BIGINT NULL           (set when a worker pops the job)
 *     created_at  BIGINT NOT NULL
 *
 *   failed_jobs
 *     id          VARCHAR(36) PRIMARY KEY
 *     queue       VARCHAR(255) NOT NULL
 *     payload     TEXT NOT NULL
 *     failed_at   BIGINT NOT NULL
 */
export class DatabaseDriver implements QueueDriver {
    private knex: any;
    private jobsTable: string;
    private failedTable: string;
    /** How long (ms) a reserved job is held before being considered timed out */
    private reservationTimeout: number;

    constructor(knex: any, options: {
        jobsTable?: string;
        failedTable?: string;
        reservationTimeout?: number; // seconds, default 90
    } = {}) {
        this.knex               = knex;
        this.jobsTable          = options.jobsTable      || "jobs";
        this.failedTable        = options.failedTable    || "failed_jobs";
        this.reservationTimeout = (options.reservationTimeout ?? 90) * 1000;
    }

    /* ---------------------------------------------------------------------- */
    /*  QueueDriver implementation                                             */
    /* ---------------------------------------------------------------------- */

    public async push(envelope: JobEnvelope, queue: string): Promise<void> {
        const now       = Date.now();
        const available = envelope.delay && envelope.delay > 0
            ? now + envelope.delay * 1000
            : now;

        await this.knex(this.jobsTable).insert({
            id:           envelope.id,
            queue:        queue,
            payload:      JSON.stringify(envelope),
            attempts:     envelope.attempts,
            available_at: available,
            reserved_at:  null,
            created_at:   now,
        });
    }

    public async pop(queue: string): Promise<JobEnvelope | null> {
        const now = Date.now();

        // Release stale reservations first (timed-out workers)
        await this.knex(this.jobsTable)
            .where("queue", queue)
            .whereNotNull("reserved_at")
            .where("reserved_at", "<", now - this.reservationTimeout)
            .update({ reserved_at: null });

        // Fetch the oldest available, unreserved job
        const row = await this.knex(this.jobsTable)
            .where("queue", queue)
            .whereNull("reserved_at")
            .where("available_at", "<=", now)
            .orderBy("available_at", "asc")
            .first();

        if (!row) return null;

        // Reserve the job atomically
        const updated = await this.knex(this.jobsTable)
            .where("id", row.id)
            .whereNull("reserved_at") // guard against race condition
            .update({ reserved_at: now });

        if (updated === 0) {
            // Another worker grabbed it — try again next tick
            return null;
        }

        return JSON.parse(row.payload) as JobEnvelope;
    }

    public async ack(envelope: JobEnvelope, _queue: string): Promise<void> {
        await this.knex(this.jobsTable).where("id", envelope.id).delete();
    }

    public async nack(envelope: JobEnvelope, queue: string): Promise<void> {
        envelope.attempts++;

        await this.knex(this.jobsTable).where("id", envelope.id).update({
            payload:     JSON.stringify(envelope),
            attempts:    envelope.attempts,
            reserved_at: null,
            available_at: Date.now(), // available immediately
        });
    }

    public async fail(envelope: JobEnvelope, _queue: string): Promise<void> {
        // Remove from jobs table
        await this.knex(this.jobsTable).where("id", envelope.id).delete();

        // Insert into failed_jobs
        await this.knex(this.failedTable).insert({
            id:        envelope.id,
            queue:     envelope.queue,
            payload:   JSON.stringify(envelope),
            failed_at: Date.now(),
        });
    }

    public async getFailed(queue?: string): Promise<JobEnvelope[]> {
        let query = this.knex(this.failedTable).orderBy("failed_at", "desc");
        if (queue) query = query.where("queue", queue);

        const rows = await query;
        return rows.map((row: any) => {
            const env = JSON.parse(row.payload) as JobEnvelope;
            env.failedAt = row.failed_at;
            return env;
        });
    }

    public async retryFailed(id: string): Promise<boolean> {
        const row = await this.knex(this.failedTable).where("id", id).first();
        if (!row) return false;

        const envelope = JSON.parse(row.payload) as JobEnvelope;

        // Remove from failed_jobs
        await this.knex(this.failedTable).where("id", id).delete();

        // Reset and re-push
        envelope.attempts = 0;
        delete (envelope as any).failedAt;
        delete (envelope as any).lastError;

        await this.push(envelope, envelope.queue);
        return true;
    }

    public async flushFailed(): Promise<void> {
        await this.knex(this.failedTable).delete();
    }

    public async size(queue: string): Promise<number> {
        const result = await this.knex(this.jobsTable)
            .where("queue", queue)
            .whereNull("reserved_at")
            .count("id as count")
            .first();

        return parseInt(result?.count ?? "0", 10);
    }
}
