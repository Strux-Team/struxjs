export interface Broadcaster {
    /**
     * Broadcast an event payload to specified channels
     */
    broadcast(channels: string[], eventName: string, payload: any): void | Promise<void>;
}
