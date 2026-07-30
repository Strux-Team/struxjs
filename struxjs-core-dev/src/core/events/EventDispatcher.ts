import { Event } from "./Event.js";
import { Listener } from "./Listener.js";

type ListenerInstance  = Listener;
type ListenerFactory   = () => Listener;
type ListenerEntry     = ListenerInstance | ListenerFactory | ((event: any) => any | Promise<any>);

/**
 * EventDispatcher — central bus for all application events.
 *
 * Register listeners in routes/events.ts:
 *
 *   EventDispatcher.listen(UserRegistered, [
 *       SendWelcomeEmail,
 *       () => new LogUserActivity(),
 *   ]);
 *
 * Dispatch from anywhere:
 *
 *   await EventDispatcher.dispatch(new UserRegistered(user));
 *   await event(new UserRegistered(user));    // global helper
 */
export class EventDispatcher {
    /**
     * Map: EventClass name → array of listener entries.
     * Also supports "*" for wildcard listeners.
     */
    private static listeners: Map<string, ListenerEntry[]> = new Map();

    /* ---------------------------------------------------------------------- */
    /*  Registration                                                           */
    /* ---------------------------------------------------------------------- */

    /**
     * Register one or more listeners for an event class.
     *
     * Accepts:
     *   - Listener class constructor (new-able)
     *   - Listener instance
     *   - Factory function () => Listener
     *   - Plain async function (event) => void
     *
     * EventDispatcher.listen(UserRegistered, [SendWelcomeEmail, LogActivity]);
     * EventDispatcher.listen(UserRegistered, [async (e) => console.log(e)]);
     */
    public static listen(
        eventClass: (new (...args: any[]) => Event) | "*",
        listeners: Array<
            | (new (...args: any[]) => Listener)
            | ListenerEntry
        >
    ): void {
        const key = eventClass === "*" ? "*" : eventClass.name;

        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }

        for (const entry of listeners) {
            // If it's a constructable Listener class, wrap in a factory
            if (this.isListenerClass(entry)) {
                this.listeners.get(key)!.push(() => new (entry as any)());
            } else {
                this.listeners.get(key)!.push(entry as ListenerEntry);
            }
        }
    }

    /**
     * Register a plain callback for an event.
     *
     * EventDispatcher.on(UserRegistered, async (event) => { ... });
     */
    public static on(
        eventClass: (new (...args: any[]) => Event) | "*",
        callback: (event: any) => any | Promise<any>
    ): void {
        this.listen(eventClass, [callback]);
    }

    /**
     * Remove all listeners for an event class.
     *
     * EventDispatcher.forget(UserRegistered);
     */
    public static forget(eventClass: new (...args: any[]) => Event): void {
        this.listeners.delete(eventClass.name);
    }

    /**
     * Remove all registered listeners.
     */
    public static flush(): void {
        this.listeners.clear();
    }

    /**
     * Check if an event has any listeners registered.
     */
    public static hasListeners(eventClass: new (...args: any[]) => Event): boolean {
        return (
            (this.listeners.get(eventClass.name)?.length ?? 0) > 0 ||
            (this.listeners.get("*")?.length ?? 0) > 0
        );
    }

    /* ---------------------------------------------------------------------- */
    /*  Dispatch                                                               */
    /* ---------------------------------------------------------------------- */

    /**
     * Dispatch an event — invokes all registered listeners in order.
     * Synchronous listeners run immediately; queued listeners are pushed to the job queue.
     *
     * await EventDispatcher.dispatch(new UserRegistered(user));
     */
    public static async dispatch(eventInstance: Event): Promise<void> {
        const eventName = eventInstance.constructor.name;

        // Auto-broadcast event if it implements ShouldBroadcast interface
        try {
            const { isShouldBroadcast } = await import("../broadcasting/ShouldBroadcast.js");
            if (isShouldBroadcast(eventInstance)) {
                const { Broadcast } = await import("../broadcasting/Broadcast.js");
                await Broadcast.event(eventInstance);
            }
        } catch {
            // Ignore broadcasting errors if broadcasting module is unconfigured
        }

        // Collect listeners: exact match + wildcard
        const entries: ListenerEntry[] = [
            ...(this.listeners.get(eventName) ?? []),
            ...(this.listeners.get("*")       ?? []),
        ];

        if (entries.length === 0) return;

        for (const entry of entries) {
            const listener = this.resolveListener(entry);

            if (listener instanceof Listener && listener.shouldQueue) {
                // Dispatch as a background job
                await this.queueListener(listener, eventInstance);
            } else if (listener instanceof Listener) {
                // Execute synchronously
                try {
                    await listener.handle(eventInstance);
                } catch (err: any) {
                    console.error(
                        `[StruxJS Events] Listener ${listener.constructor.name} ` +
                        `failed for event ${eventName}: ${err.message}`
                    );
                    throw err;
                }
            } else if (typeof listener === "function") {
                // Plain callback
                try {
                    await (listener as (...args: any[]) => any)(eventInstance);
                } catch (err: any) {
                    console.error(
                        `[StruxJS Events] Callback listener failed for event ${eventName}: ${err.message}`
                    );
                    throw err;
                }
            }
        }
    }

    /**
     * Dispatch an event and suppress all errors from listeners.
     * Useful for side-effects that should not break the main flow.
     *
     * await EventDispatcher.dispatchNow(new OrderShipped(order));
     */
    public static async dispatchNow(eventInstance: Event): Promise<void> {
        try {
            await this.dispatch(eventInstance);
        } catch {
            // Silently swallow
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Introspection                                                          */
    /* ---------------------------------------------------------------------- */

    /**
     * Return a map of { EventName → listenerCount } for all registered events.
     */
    public static getRegistered(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const [key, entries] of this.listeners) {
            result[key] = entries.length;
        }
        return result;
    }

    /* ---------------------------------------------------------------------- */
    /*  Internal helpers                                                       */
    /* ---------------------------------------------------------------------- */

    private static resolveListener(entry: ListenerEntry): Listener | ((...args: any[]) => any) {
        if (entry instanceof Listener) {
            return entry;
        }

        if (typeof entry === "function") {
            if (this.isListenerClass(entry)) {
                return new (entry as any)();
            }

            // Only call zero-argument functions as potential Listener factory functions
            if (entry.length === 0) {
                try {
                    const result = (entry as (...args: any[]) => any)();
                    if (result instanceof Listener) {
                        return result;
                    }
                } catch {
                    // Ignore error and fall back to plain callback
                }
            }

            return entry as (...args: any[]) => any;
        }

        return entry as Listener;
    }

    private static isListenerClass(entry: any): boolean {
        return (
            typeof entry === "function" &&
            entry.prototype &&
            entry.prototype instanceof Listener
        );
    }

    private static async queueListener(listener: Listener, eventInstance: Event): Promise<void> {
        try {
            const { Job, jobRegistry } = await import("../queue/Job.js");
            const { Queue }            = await import("../queue/Queue.js");

            // Dynamically build a one-shot Job that re-executes the listener
            const listenerName = listener.constructor.name;
            const eventName    = eventInstance.constructor.name;
            const jobId        = `listener_job_${listenerName}_${Date.now()}`;

            // Register a synthetic job class once
            if (!jobRegistry.has(jobId)) {
                const capturedListener = listener;
                const capturedEvent    = eventInstance;

                class ListenerJob extends Job {
                    public queue   = capturedListener.queue;
                    public tries   = capturedListener.tries;

                    public async handle(): Promise<void> {
                        await capturedListener.handle(capturedEvent);
                    }

                    public async failed(error: Error): Promise<void> {
                        await capturedListener.failed(capturedEvent, error);
                    }
                }

                Object.defineProperty(ListenerJob, "name", { value: jobId });
                jobRegistry.set(jobId, ListenerJob as any);

                const job = new ListenerJob();
                await Queue.push(job, { queue: listener.queue });
            }
        } catch (err: any) {
            console.error(
                `[StruxJS Events] Failed to queue listener ${listener.constructor.name}: ${err.message}. ` +
                `Falling back to synchronous execution.`
            );
            await listener.handle(eventInstance);
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Global helper                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch an event (global shorthand).
 *
 * import { event } from "struxjs";
 * await event(new UserRegistered(user));
 */
export async function event(eventInstance: Event): Promise<void> {
    return EventDispatcher.dispatch(eventInstance);
}
