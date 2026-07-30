import { Event } from "./Event.js";

/**
 * Listener — base class for all event listeners.
 *
 * Usage:
 *   export class SendWelcomeEmail extends Listener {
 *       public async handle(event: UserRegistered): Promise<void> {
 *           await mailer.send(event.user.email, "Welcome!");
 *       }
 *   }
 *
 * Queued listener (runs in background via job queue):
 *   export class GenerateReport extends Listener {
 *       public shouldQueue = true;
 *       public queue       = "reports";
 *
 *       public async handle(event: OrderCompleted): Promise<void> {
 *           await reportService.generate(event.order);
 *       }
 *   }
 */
export abstract class Listener {
    /**
     * When true the listener is dispatched as a background job
     * instead of being executed synchronously.
     */
    public shouldQueue: boolean = false;

    /**
     * Queue name used when shouldQueue = true.
     * Falls back to the queue default connection.
     */
    public queue: string = "default";

    /**
     * Max retry attempts when shouldQueue = true.
     */
    public tries: number = 3;

    /**
     * Handle the event.
     * Must be implemented by every concrete listener.
     */
    public abstract handle(event: Event): Promise<void>;

    /**
     * Called when all retry attempts are exhausted (queued listeners only).
     * Override to send alerts, clean up, etc.
     */
    public async failed(event: Event, error: Error): Promise<void> {
        // Default: no-op
    }
}
