import type { Redis as RedisClient } from "ioredis";
import { QueueDriver } from "./QueueDriver.js";
import { JobEnvelope } from "../Job.js";

/**
 * RedisDriver — stores jobs in Redis lists, supports delayed jobs using sorted sets.
 *
 * Queue layout:
 *   strux:queue:<name>          — LPUSH/BRPOP list (ready jobs)
 *   strux:queue:<name>:delayed  — ZADD sorted set, score = run timestamp (delayed jobs)
 *   strux:queue:failed          — LPUSH list (permanently failed jobs)
 */
export class RedisDriver implements QueueDriver {
    private redis: RedisClient;
    private namespace: string;

    constructor(redis: RedisClient, namespace = "strux:queue") {
        this.redis = redis;
        this.namespace = namespace;
    }

    /* ---------------------------------------------------------------------- */
    /*  Key helpers                                                            */
    /* ---------------------------------------------------------------------- */

    private getQueueKey(queue: string): string {
        return `${this.namespace}:${queue}`;
    }

    private getDelayedKey(queue: string): string {
        return `${this.namespace}:${queue}:delayed`;
    }

    private getFailedKey(): string {
        return `${this.namespace}:failed`;
    }

    /* ---------------------------------------------------------------------- */
    /*  QueueDriver implementation                                             */
    /* ---------------------------------------------------------------------- */

    public async push(envelope: JobEnvelope, queue: string): Promise<void> {
        const queueKey   = this.getQueueKey(queue);
        const delayedKey = this.getDelayedKey(queue);
        const serialized = JSON.stringify(envelope);

        if (envelope.delay && envelope.delay > 0) {
            // Delayed job: store in sorted set with score = run timestamp (ms)
            const runAt = Date.now() + envelope.delay * 1000;
            await this.redis.zadd(delayedKey, runAt.toString(), serialized);
        } else {
            // Immediate job: push to left end of list
            await this.redis.lpush(queueKey, serialized);
        }
    }

    public async pop(queue: string): Promise<JobEnvelope | null> {
        const queueKey = this.getQueueKey(queue);

        // Move any ready delayed jobs to the main queue first
        await this.moveDelayedJobs(queue);

        // Blocking pop with 1 second timeout to avoid busy loop
        const result = await this.redis.brpop(queueKey, 1);
        if (!result) return null;

        const [, serialized] = result;
        return JSON.parse(serialized) as JobEnvelope;
    }

    public async ack(_envelope: JobEnvelope, _queue: string): Promise<void> {
        // Job completed successfully — nothing to clean up (already removed by brpop)
    }

    public async nack(envelope: JobEnvelope, queue: string): Promise<void> {
        // Put the job back for retry
        envelope.attempts++;
        await this.push(envelope, queue);
    }

    public async fail(envelope: JobEnvelope, _queue: string): Promise<void> {
        const failedKey = this.getFailedKey();
        await this.redis.lpush(failedKey, JSON.stringify(envelope));
    }

    public async getFailed(queue?: string): Promise<JobEnvelope[]> {
        const failedKey = this.getFailedKey();
        const items     = await this.redis.lrange(failedKey, 0, -1);
        const envelopes = items.map((item: string) => JSON.parse(item) as JobEnvelope);

        if (queue) {
            return envelopes.filter((e: JobEnvelope) => e.queue === queue);
        }
        return envelopes;
    }

    public async retryFailed(id: string): Promise<boolean> {
        const failedKey = this.getFailedKey();
        const items     = await this.redis.lrange(failedKey, 0, -1);

        for (const raw of items) {
            const envelope = JSON.parse(raw) as JobEnvelope;
            if (envelope.id === id) {
                // Remove from failed list
                await this.redis.lrem(failedKey, 1, raw);

                // Reset and re-queue
                envelope.attempts = 0;
                delete (envelope as any).failedAt;
                delete (envelope as any).lastError;
                await this.push(envelope, envelope.queue);
                return true;
            }
        }
        return false;
    }

    public async flushFailed(): Promise<void> {
        await this.redis.del(this.getFailedKey());
    }

    public async size(queue: string): Promise<number> {
        const [ready, delayed] = await Promise.all([
            this.redis.llen(this.getQueueKey(queue)),
            this.redis.zcard(this.getDelayedKey(queue)),
        ]);
        return ready + delayed;
    }

    /* ---------------------------------------------------------------------- */
    /*  Delayed job helper                                                     */
    /* ---------------------------------------------------------------------- */

    private async moveDelayedJobs(queue: string): Promise<void> {
        const delayedKey = this.getDelayedKey(queue);
        const queueKey   = this.getQueueKey(queue);
        const now        = Date.now();

        // Get all jobs with score (runAt) <= now
        const jobs = await this.redis.zrangebyscore(delayedKey, 0, now);
        if (jobs.length === 0) return;

        const pipeline = this.redis.pipeline();
        for (const job of jobs) {
            pipeline.lpush(queueKey, job);
            pipeline.zrem(delayedKey, job);
        }
        await pipeline.exec();
    }
}
