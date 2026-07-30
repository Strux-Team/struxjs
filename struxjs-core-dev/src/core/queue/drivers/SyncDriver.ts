import { QueueDriver } from "./QueueDriver.js";
import { Job, JobEnvelope } from "../Job.js";

/**
 * SyncDriver — executes jobs immediately in the same process (no actual queuing).
 * Useful for local development and testing.
 */
export class SyncDriver implements QueueDriver {
    public async push(envelope: JobEnvelope, queue: string): Promise<void> {
        // Execute the job immediately
        try {
            const job = Job.deserialize(envelope);
            await job.handle();
        } catch (err: any) {
            console.error(`[StruxJS Queue Sync] Job ${envelope.jobClass} failed:`, err.message);
            throw err;
        }
    }

    public async pop(queue: string): Promise<JobEnvelope | null> {
        return null; // Not applicable for sync driver
    }

    public async ack(envelope: JobEnvelope, queue: string): Promise<void> {}
    public async nack(envelope: JobEnvelope, queue: string): Promise<void> {}
    public async fail(envelope: JobEnvelope, queue: string): Promise<void> {}
    public async getFailed(queue?: string): Promise<JobEnvelope[]> { return []; }
    public async retryFailed(id: string): Promise<boolean> { return false; }
    public async flushFailed(): Promise<void> {}
    public async size(queue: string): Promise<number> { return 0; }
}
