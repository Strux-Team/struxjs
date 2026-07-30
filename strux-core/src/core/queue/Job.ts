/**
 * Job — abstract base class for all background jobs.
 *
 * Usage:
 *   export class SendEmailJob extends Job {
 *       constructor(private email: string, private subject: string) { super(); }
 *
 *       public async handle(): Promise<void> {
 *           await mailer.send(this.email, this.subject);
 *       }
 *   }
 *
 *   // Dispatch
 *   await dispatch(new SendEmailJob('hi@example.com', 'Welcome!'));
 *   await dispatch(new SendEmailJob('hi@example.com', 'Welcome!'), 'emails');
 */
export abstract class Job {
    /** Target queue name. Override per-job or pass at dispatch time. */
    public queue: string = "default";

    /** Max retry attempts before moving to failed jobs. */
    public tries: number = 3;

    /** Delay in seconds before the job becomes available (Redis driver only). */
    public delay: number = 0;

    /** Timeout in seconds for a single handle() execution (worker enforced). */
    public timeout: number = 60;

    /** Execute the job logic. */
    public abstract handle(): Promise<void>;

    /**
     * Called when all retry attempts have been exhausted.
     * Override to send alerts, clean up, etc.
     */
    public async failed(error: Error): Promise<void> {
        // Default: no-op. Override in subclass.
    }

    /* ---------------------------------------------------------------------- */
    /*  Serialization helpers (used by Queue drivers)                         */
    /* ---------------------------------------------------------------------- */

    /**
     * Serialize job instance to a plain JSON-safe envelope.
     * Captures the class name and all own enumerable properties as payload.
     * @internal
     */
    public serialize(): JobEnvelope {
        const payload: Record<string, any> = {};

        // Capture all own properties (constructor args stored on 'this')
        for (const key of Object.keys(this)) {
            if (!JOB_META_KEYS.has(key)) {
                payload[key] = (this as any)[key];
            }
        }

        return {
            id:        `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            jobClass:  this.constructor.name,
            payload,
            queue:     this.queue,
            tries:     this.tries,
            delay:     this.delay,
            timeout:   this.timeout,
            attempts:  0,
            createdAt: Date.now()
        };
    }

    /**
     * Reconstruct a Job instance from a serialized envelope.
     * Requires the job class to be registered in the global job registry.
     * @internal
     */
    public static deserialize(envelope: JobEnvelope): Job {
        const JobClass = jobRegistry.get(envelope.jobClass);
        if (!JobClass) {
            throw new Error(
                `[StruxJS Queue Error]: Job class '${envelope.jobClass}' is not registered. ` +
                `Call Job.register(${envelope.jobClass}) during bootstrap.`
            );
        }

        // Create an empty instance and restore payload properties
        const instance = Object.create(JobClass.prototype) as Job;
        instance.queue   = envelope.queue;
        instance.tries   = envelope.tries;
        instance.delay   = envelope.delay;
        instance.timeout = envelope.timeout;

        Object.assign(instance, envelope.payload);
        return instance;
    }

    /**
     * Register a job class so it can be deserialized by the worker.
     * Call once per job class during application bootstrap.
     *
     * Job.register(SendEmailJob);
     * Job.register(SendEmailJob, GenerateReportJob, ...);
     */
    public static register(...jobClasses: (new (...args: any[]) => Job)[]): void {
        for (const cls of jobClasses) {
            jobRegistry.set(cls.name, cls);
        }
    }
}

/** Keys that belong to the Job base class and should not be part of payload */
const JOB_META_KEYS = new Set(["queue", "tries", "delay", "timeout"]);

/** Global registry mapping class name → constructor for deserialization */
export const jobRegistry: Map<string, new (...args: any[]) => Job> = new Map();

/** Wire format stored in the queue backend */
export interface JobEnvelope {
    id:        string;
    jobClass:  string;
    payload:   Record<string, any>;
    queue:     string;
    tries:     number;
    delay:     number;
    timeout:   number;
    attempts:  number;
    createdAt: number;
    failedAt?: number;
    lastError?: string;
}
