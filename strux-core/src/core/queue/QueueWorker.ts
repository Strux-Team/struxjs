import { Job, JobEnvelope } from "./Job.js";
import { QueueDriver } from "./drivers/QueueDriver.js";
import { Queue } from "./Queue.js";

export interface WorkerOptions {
    /** Queue name to consume (default: "default") */
    queue?: string;
    /** Named connection from config/queue.ts (default: Queue's default connection) */
    connection?: string;
    /** Direct driver instance override (useful for testing) */
    driverOverride?: QueueDriver;
    /** Seconds to sleep when queue is empty before polling again (default: 3) */
    sleep?: number;
    /** Max retries before moving to failed jobs (default: 3) */
    maxTries?: number;
    /** Per-job execution timeout in seconds (default: 60) */
    timeout?: number;
    /** Stop the worker when queue is empty instead of polling forever (default: false) */
    stopWhenEmpty?: boolean;
}

/**
 * QueueWorker — polls a queue and processes jobs one by one.
 *
 * const worker = new QueueWorker({ queue: 'emails', maxTries: 5 });
 * await worker.work();
 *
 * // Graceful shutdown on SIGTERM:
 * process.on('SIGTERM', () => worker.stop());
 */
export class QueueWorker {
    private readonly queue: string;
    private readonly connection?: string;
    private readonly driverOverride?: QueueDriver;
    private readonly sleep: number;
    private readonly maxTries: number;
    private readonly timeout: number;
    private readonly stopWhenEmpty: boolean;
    private shouldStop = false;

    constructor(options: WorkerOptions = {}) {
        this.queue          = options.queue          || "default";
        this.connection     = options.connection;
        this.driverOverride = options.driverOverride;
        this.sleep          = options.sleep          ?? 3;
        this.maxTries       = options.maxTries       ?? 3;
        this.timeout        = options.timeout        ?? 60;
        this.stopWhenEmpty  = options.stopWhenEmpty   ?? false;
    }

    /* ---------------------------------------------------------------------- */
    /*  Main loop                                                              */
    /* ---------------------------------------------------------------------- */

    public async work(): Promise<void> {
        console.log(`[StruxJS Worker] Starting — queue="${this.queue}" maxTries=${this.maxTries} timeout=${this.timeout}s`);

        const driver = this.driverOverride || await Queue.resolveDriver(this.connection);

        while (!this.shouldStop) {
            try {
                const envelope = await driver.pop(this.queue);

                if (!envelope) {
                    if (this.stopWhenEmpty) {
                        console.log("[StruxJS Worker] Queue empty — stopping.");
                        break;
                    }
                    await this.sleepMs(this.sleep * 1000);
                    continue;
                }

                await this.process(envelope, driver);
            } catch (err: any) {
                console.error("[StruxJS Worker] Unexpected error:", err.message);
                await this.sleepMs(1000);
            }
        }

        console.log("[StruxJS Worker] Stopped.");
    }

    /* ---------------------------------------------------------------------- */
    /*  Job processing                                                         */
    /* ---------------------------------------------------------------------- */

    private async process(envelope: JobEnvelope, driver: QueueDriver): Promise<void> {
        const label = `${envelope.jobClass}[${envelope.id}]`;
        console.log(`[StruxJS Worker] Processing ${label} (attempt ${envelope.attempts + 1}/${this.maxTries})`);

        try {
            const job = Job.deserialize(envelope);
            await this.executeWithTimeout(job, this.timeout);
            await driver.ack(envelope, this.queue);
            if (process.env.NODE_ENV !== "test") console.log(`[StruxJS Worker] ${label} completed`);
        } catch (err: any) {
            if (process.env.NODE_ENV !== "test") console.error(`[StruxJS Worker] ${label} failed: ${err.message}`);

            envelope.attempts++;
            envelope.lastError = err.message;

            const maxAttempts = envelope.tries ?? this.maxTries;

            if (envelope.attempts < maxAttempts) {
                if (process.env.NODE_ENV !== "test") console.log(`[StruxJS Worker] Re-queuing ${label} (attempt ${envelope.attempts}/${maxAttempts})`);
                await driver.nack(envelope, this.queue);
            } else {
                if (process.env.NODE_ENV !== "test") console.log(`[StruxJS Worker] ${label} exhausted retries — moving to failed jobs`);
                envelope.failedAt = Date.now();

                try {
                    const job = Job.deserialize(envelope);
                    await job.failed(err);
                } catch (failedCallbackErr: any) {
                    if (process.env.NODE_ENV !== "test") console.error(`[StruxJS Worker] ${label} failed() callback threw:`, failedCallbackErr.message);
                }

                await driver.fail(envelope, this.queue);
            }
        }
    }

    /** Execute a job with a hard timeout. */
    private executeWithTimeout(job: Job, timeoutSeconds: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Job timed out after ${timeoutSeconds}s`));
            }, timeoutSeconds * 1000);

            job.handle()
                .then(() => { clearTimeout(timer); resolve(); })
                .catch((err: Error) => { clearTimeout(timer); reject(err); });
        });
    }

    /* ---------------------------------------------------------------------- */
    /*  Control                                                                */
    /* ---------------------------------------------------------------------- */

    /** Signal the worker to stop after finishing the current job. */
    public stop(): void {
        console.log("[StruxJS Worker] Received stop signal — finishing current job...");
        this.shouldStop = true;
    }

    private sleepMs(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
