export interface ShouldBroadcast {
    /**
     * Get the channel or channels the event should broadcast on.
     * e.g. "chat.room.1" or ["orders", "user.10"]
     */
    broadcastOn(): string | string[];

    /**
     * The event name to broadcast as.
     * Defaults to the class constructor name (e.g. "MessageSent").
     */
    broadcastAs?(): string;

    /**
     * Get the data payload to broadcast with.
     * Defaults to all public properties on the event object.
     */
    broadcastWith?(): Record<string, any>;
}

export function isShouldBroadcast(event: any): event is ShouldBroadcast {
    return event && typeof event === "object" && typeof event.broadcastOn === "function";
}
