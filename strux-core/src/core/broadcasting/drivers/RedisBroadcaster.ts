import { Broadcaster } from "./Broadcaster.js";
import { MemoryBroadcaster } from "./MemoryBroadcaster.js";
import { Redis } from "ioredis";

export class RedisBroadcaster implements Broadcaster {
    private publisher: Redis;
    private subscriber: Redis;

    constructor(options?: any, private memoryBroadcaster?: MemoryBroadcaster) {
        this.publisher = new Redis(options || {});
        this.subscriber = new Redis(options || {});

        // Listen for Redis Pub/Sub messages across all cluster instances
        this.subscriber.psubscribe("struxjs_broadcast:*", (err) => {
            if (err && process.env.NODE_ENV !== "test") {
                console.error("[StruxJS Redis Broadcaster Error]:", err.message);
            }
        });

        this.subscriber.on("pmessage", (pattern, channel, rawMessage) => {
            try {
                const { event, data, channels } = JSON.parse(rawMessage);
                if (this.memoryBroadcaster) {
                    this.memoryBroadcaster.broadcast(channels || [channel.replace("struxjs_broadcast:", "")], event, data);
                }
            } catch {
                // Ignore invalid message format
            }
        });
    }

    public async broadcast(channels: string[], eventName: string, payload: any): Promise<void> {
        const message = JSON.stringify({
            event: eventName,
            data: payload,
            channels
        });

        for (const channel of channels) {
            await this.publisher.publish(`struxjs_broadcast:${channel}`, message);
        }
    }

    public async disconnect(): Promise<void> {
        await this.publisher.quit();
        await this.subscriber.quit();
    }
}
