import { JobEnvelope } from "../Job.js";

/**
 * QueueDriver — interface every queue backend must implement.
 */
export interface QueueDriver {
    /** Push a job envelope onto the named queue. */
    push(envelope: JobEnvelope, queue: string): Promise<void>;

    /** Pop the next available job from the named queue. Returns null when empty. */
    pop(queue: string): Promise<JobEnvelope | null>;

    /** Acknowledge a job has been processed successfully (remove from in-flight). */
    ack(envelope: JobEnvelope, queue: string): Promise<void>;

    /** Return a failed job back to the queue for retry. */
    nack(envelope: JobEnvelope, queue: string): Promise<void>;

    /** Store a job in the failed jobs list. */
    fail(envelope: JobEnvelope, queue: string): Promise<void>;

    /** Retrieve all failed jobs (for queue:failed command). */
    getFailed(queue?: string): Promise<JobEnvelope[]>;

    /** Re-queue a specific failed job by index/id. */
    retryFailed(id: string): Promise<boolean>;

    /** Flush all failed jobs. */
    flushFailed(): Promise<void>;

    /** Return approximate pending job count for a queue. */
    size(queue: string): Promise<number>;
}
