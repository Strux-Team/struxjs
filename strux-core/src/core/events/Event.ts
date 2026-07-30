/**
 * Event — base class for all application events.
 *
 * Usage:
 *   export class UserRegistered extends Event {
 *       constructor(public readonly user: User) { super(); }
 *   }
 *
 *   // Dispatch
 *   await event(new UserRegistered(user));
 *   await Event.dispatch(new UserRegistered(user));
 */
export abstract class Event {
    /** Timestamp when the event was created (ms since epoch). */
    public readonly firedAt: number = Date.now();

    /**
     * Dispatch this event via the global dispatcher.
     * Shorthand for: await event(new UserRegistered(user))
     */
    public async dispatch(): Promise<void> {
        const { EventDispatcher } = await import("./EventDispatcher.js");
        await EventDispatcher.dispatch(this);
    }

    /**
     * Static helper — dispatch any event instance.
     *
     * await Event.dispatch(new UserRegistered(user));
     */
    public static async dispatch(eventInstance: Event): Promise<void> {
        const { EventDispatcher } = await import("./EventDispatcher.js");
        await EventDispatcher.dispatch(eventInstance);
    }
}
