import { Broadcaster } from "./drivers/Broadcaster.js";
import { MemoryBroadcaster } from "./drivers/MemoryBroadcaster.js";
import { LogBroadcaster } from "./drivers/LogBroadcaster.js";
import { RedisBroadcaster } from "./drivers/RedisBroadcaster.js";
import { ShouldBroadcast, isShouldBroadcast } from "./ShouldBroadcast.js";

export type ChannelAuthCallback = (user: any, ...args: any[]) => boolean | Promise<boolean>;
export type MessageCallback = (event: string, data: any, context: { user: any; channel: string; suppress: () => void }) => void | Promise<void>;
export type DisconnectCallback = (context: { clientId: string; user: any; channels: string[] }) => void | Promise<void>;

export class BroadcastChannelChain {
    constructor(private manager: BroadcastManager, private channels: string[]) {}

    public async emit(eventName: string, payload: any = {}): Promise<void> {
        await this.manager.getBroadcaster().broadcast(this.channels, eventName, payload);
    }

    public async broadcast(eventName: string, payload: any = {}): Promise<void> {
        await this.emit(eventName, payload);
    }
}

export class BroadcastManager {
    private broadcaster: Broadcaster;
    private memoryBroadcaster: MemoryBroadcaster;
    private logBroadcaster: LogBroadcaster;
    private channelAuthCallbacks: Map<string, ChannelAuthCallback> = new Map();
    private messageCallbacks: Map<string, MessageCallback[]> = new Map(); // channel -> callbacks
    private disconnectCallbacks: DisconnectCallback[] = [];

    constructor() {
        this.memoryBroadcaster = new MemoryBroadcaster();
        this.logBroadcaster = new LogBroadcaster();
        this.broadcaster = this.memoryBroadcaster;
    }

    public setBroadcaster(broadcaster: Broadcaster): void {
        this.broadcaster = broadcaster;
    }

    public getBroadcaster(): Broadcaster {
        return this.broadcaster;
    }

    public getMemoryBroadcaster(): MemoryBroadcaster {
        return this.memoryBroadcaster;
    }

    public getLogBroadcaster(): LogBroadcaster {
        return this.logBroadcaster;
    }

    public useDriver(driver: "memory" | "log" | "redis", redisOptions?: any): void {
        if (driver === "memory") {
            this.broadcaster = this.memoryBroadcaster;
        } else if (driver === "log") {
            this.broadcaster = this.logBroadcaster;
        } else if (driver === "redis") {
            this.broadcaster = new RedisBroadcaster(redisOptions, this.memoryBroadcaster);
        }
    }

    public to(channels: string | string[]): BroadcastChannelChain {
        const channelList = Array.isArray(channels) ? channels : [channels];
        return new BroadcastChannelChain(this, channelList);
    }

    public channel(name: string): BroadcastChannelChain {
        return this.to(name);
    }

    public user(userId: string | number): BroadcastChannelChain {
        return this.to(`private-user.${userId}`);
    }

    /**
     * Send a message to a specific client by clientId
     * Returns false if client not found or disconnected
     */
    public client(clientId: string): { emit: (event: string, data: any) => boolean } {
        return {
            emit: (event: string, data: any) => {
                this.memoryBroadcaster.sendToClient(clientId, event, data);
                const client = this.memoryBroadcaster.getClient(clientId);
                return !!client;
            }
        };
    }

    /**
     * Get presence information for a channel — list of subscribers with user info
     */
    public presence(channel: string): Array<{ clientId: string; user?: any }> {
        return this.memoryBroadcaster.getChannelMembers(channel);
    }

    /**
     * Broadcast an event object if it implements ShouldBroadcast
     */
    public async event(eventInstance: any): Promise<boolean> {
        if (!isShouldBroadcast(eventInstance)) {
            return false;
        }

        const rawChannels = eventInstance.broadcastOn();
        const channels = Array.isArray(rawChannels) ? rawChannels : [rawChannels];

        const eventName = typeof eventInstance.broadcastAs === "function"
            ? eventInstance.broadcastAs()
            : eventInstance.constructor.name;

        let payload: any;
        if (typeof eventInstance.broadcastWith === "function") {
            payload = eventInstance.broadcastWith();
        } else {
            // Default payload: pick all public object properties excluding functions
            payload = {};
            for (const key of Object.keys(eventInstance)) {
                if (typeof (eventInstance as any)[key] !== "function") {
                    payload[key] = (eventInstance as any)[key];
                }
            }
        }

        await this.to(channels).emit(eventName, payload);
        return true;
    }

    /**
     * Register a channel authorization callback for private/presence channels
     * e.g. Broadcast.authorizeChannel('chat.room.:id', (user, id) => user.canJoinRoom(id))
     */
    public authorizeChannel(channelPattern: string, callback: ChannelAuthCallback): void {
        this.channelAuthCallbacks.set(channelPattern, callback);
    }

    /**
     * Evaluate authorization for a client attempting to subscribe to a private channel
     */
    public async isChannelAuthorized(user: any, channelName: string): Promise<boolean> {
        // 1. Check registered pattern callbacks first
        for (const [pattern, callback] of this.channelAuthCallbacks.entries()) {
            const regexPattern = "^" + pattern.replace(/:[a-zA-Z0-9_]+/g, "([^/]+)") + "$";
            const match = channelName.match(new RegExp(regexPattern));
            if (match) {
                if (!user) return false;
                const params = match.slice(1);
                return Boolean(await callback(user, ...params));
            }
        }

        // 2. Public channels are open to everyone
        if (!channelName.startsWith("private-") && !channelName.startsWith("presence-")) {
            return true;
        }

        if (!user) {
            return false;
        }

        // 3. Default private user channel authorization check: private-user.{id}
        if (channelName.startsWith("private-user.")) {
            const targetUserId = channelName.replace("private-user.", "");
            const currentUserId = String((user as any).id ?? (user as any).attributes?.id ?? "");
            return currentUserId === targetUserId;
        }

        return false;
    }

    /**
     * Register a server-side listener for messages sent by clients on a channel.
     * Supports exact match, wildcard (*), and glob patterns (chat.room.*).
     *
     * Broadcast.listen("chat.room.1", (event, data, { user, channel, suppress }) => {
     *     suppress(); // call to prevent re-broadcasting to other subscribers
     * });
     * Broadcast.listen("chat.room.*", callback);
     * Broadcast.listen("*", callback); // all channels
     */
    public listen(channelPattern: string, callback: MessageCallback): void {
        if (!this.messageCallbacks.has(channelPattern)) {
            this.messageCallbacks.set(channelPattern, []);
        }
        this.messageCallbacks.get(channelPattern)!.push(callback);
    }

    /**
     * Register a callback fired when a client disconnects.
     */
    public onDisconnect(callback: DisconnectCallback): void {
        this.disconnectCallbacks.push(callback);
    }

    /**
     * Internal: match a channel against a pattern.
     * Supports exact match, "*" (all), and glob-style "chat.room.*"
     */
    private matchesPattern(pattern: string, channel: string): boolean {
        if (pattern === "*") return true;
        if (pattern === channel) return true;

        // Glob pattern: "chat.room.*" → /^chat\.room\.[^.]+$/
        if (pattern.includes("*")) {
            const regex = new RegExp(
                "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$"
            );
            return regex.test(channel);
        }

        return false;
    }

    /**
     * Internal: dispatch an incoming client message to registered server-side listeners.
     * Returns true if any listener called suppress() to prevent re-broadcasting.
     */
    public async dispatchIncoming(channel: string, event: string, data: any, user: any): Promise<boolean> {
        let suppressed = false;

        for (const [pattern, callbacks] of this.messageCallbacks.entries()) {
            if (!this.matchesPattern(pattern, channel)) continue;
            for (const cb of callbacks) {
                await cb(event, data, {
                    user,
                    channel,
                    suppress: () => { suppressed = true; }
                });
            }
        }

        return suppressed;
    }

    /**
     * Internal: dispatch disconnect event to all registered onDisconnect callbacks.
     */
    public async dispatchDisconnect(clientId: string, user: any, channels: string[]): Promise<void> {
        for (const cb of this.disconnectCallbacks) {
            await cb({ clientId, user, channels });
        }
    }
}

export const Broadcast = new BroadcastManager();
