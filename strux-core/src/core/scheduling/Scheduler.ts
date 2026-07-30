import { ScheduleEvent } from "./ScheduleEvent.js";

/**
 * Scheduler — holds all registered events and drives execution.
 *
 * Usage in QueueWorker / CLI:
 *   const scheduler = new Scheduler();
 *   kernel.schedule(scheduler.builder);
 *   await scheduler.tick();          // run all due events
 */
export class Scheduler {
    private events: ScheduleEvent[] = [];
    private _idCounter = 0;

    /* ---------------------------------------------------------------------- */
    /*  Internal registry                                                      */
    /* ---------------------------------------------------------------------- */

    /** @internal — called by Schedule builder */
    public addEvent(event: ScheduleEvent): void {
        this.events.push(event);
    }

    /** @internal — generate a unique stable ID per event */
    public nextId(): string {
        return `event_${++this._idCounter}`;
    }

    /* ---------------------------------------------------------------------- */
    /*  Public API                                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Return all events whose cron expression matches the given date.
     * Defaults to now.
     */
    public dueEvents(date: Date = new Date()): ScheduleEvent[] {
        return this.events.filter(e => e.isDue(date));
    }

    /**
     * Run all due events concurrently.
     * Call this once per minute (from schedule:work daemon or a system cron).
     */
    public async tick(date: Date = new Date()): Promise<void> {
        const due = this.dueEvents(date);

        if (due.length === 0) return;

        console.log(`[StruxJS Scheduler] Running ${due.length} due task(s)...`);

        await Promise.allSettled(
            due.map(async event => {
                const label = event.getDescription();
                try {
                    console.log(`[StruxJS Scheduler]  → ${label} (${event.getExpression()})`);
                    await event.run();
                } catch (err: any) {
                    console.error(`[StruxJS Scheduler]  ✗ ${label} failed: ${err.message}`);
                }
            })
        );
    }

    /**
     * List all registered events (for schedule:list CLI command).
     */
    public list(): Array<{ description: string; expression: string }> {
        return this.events.map(e => ({
            description: e.getDescription(),
            expression:  e.getExpression(),
        }));
    }

    /** Total number of registered events. */
    public count(): number {
        return this.events.length;
    }
}
