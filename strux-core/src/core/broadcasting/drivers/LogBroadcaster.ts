import { Broadcaster } from "./Broadcaster.js";

export class LogBroadcaster implements Broadcaster {
    public logs: Array<{ channels: string[]; eventName: string; payload: any }> = [];

    public broadcast(channels: string[], eventName: string, payload: any): void {
        this.logs.push({ channels, eventName, payload });
        if (process.env.NODE_ENV !== "test") {
            console.log(`[StruxJS Broadcast] Event '${eventName}' sent to channels [${channels.join(", ")}]`, payload);
        }
    }

    public clear(): void {
        this.logs = [];
    }
}
