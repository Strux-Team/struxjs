import { Broadcaster } from "./Broadcaster.js";
import type { WebSocket } from "ws";

export interface ConnectedClient {
    id: string;
    socket: WebSocket;
    channels: Set<string>;
    user?: any;
}

export class MemoryBroadcaster implements Broadcaster {
    private clients: Map<string, ConnectedClient> = new Map();
    private channelSubscriptions: Map<string, Set<string>> = new Map();

    public registerClient(id: string, socket: WebSocket, user?: any): ConnectedClient {
        const client: ConnectedClient = {
            id,
            socket,
            channels: new Set(),
            user
        };
        this.clients.set(id, client);
        return client;
    }

    public removeClient(id: string): void {
        const client = this.clients.get(id);
        if (client) {
            for (const channel of client.channels) {
                this.unsubscribe(id, channel);
            }
            this.clients.delete(id);
        }
    }

    public subscribe(clientId: string, channel: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.channels.add(channel);

            if (!this.channelSubscriptions.has(channel)) {
                this.channelSubscriptions.set(channel, new Set());
            }
            this.channelSubscriptions.get(channel)!.add(clientId);
        }
    }

    public unsubscribe(clientId: string, channel: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.channels.delete(channel);
        }

        const subs = this.channelSubscriptions.get(channel);
        if (subs) {
            subs.delete(clientId);
            if (subs.size === 0) {
                this.channelSubscriptions.delete(channel);
            }
        }
    }

    public broadcast(channels: string[], eventName: string, payload: any): void {
        const message = JSON.stringify({
            event: eventName,
            data: payload,
            channels
        });

        const targetClientIds = new Set<string>();

        for (const channel of channels) {
            const subs = this.channelSubscriptions.get(channel);
            if (subs) {
                for (const clientId of subs) {
                    targetClientIds.add(clientId);
                }
            }
        }

        for (const clientId of targetClientIds) {
            const client = this.clients.get(clientId);
            if (client && client.socket.readyState === 1 /* OPEN */) {
                client.socket.send(message);
            }
        }
    }

    public getSubscribersCount(channel: string): number {
        return this.channelSubscriptions.get(channel)?.size ?? 0;
    }

    public getConnectedClientsCount(): number {
        return this.clients.size;
    }

    /**
     * Get all subscribers on a channel with their user info (for presence)
     */
    public getChannelMembers(channel: string): Array<{ clientId: string; user?: any }> {
        const clientIds = this.channelSubscriptions.get(channel);
        if (!clientIds) return [];

        const members: Array<{ clientId: string; user?: any }> = [];
        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (client) {
                members.push({ clientId: client.id, user: client.user });
            }
        }
        return members;
    }

    /**
     * Send a message to a specific client by clientId
     */
    public sendToClient(clientId: string, eventName: string, payload: any): void {
        const client = this.clients.get(clientId);
        if (client && client.socket.readyState === 1 /* OPEN */) {
            const message = JSON.stringify({
                event: eventName,
                data: payload
            });
            client.socket.send(message);
        }
    }

    /**
     * Get a client by ID
     */
    public getClient(clientId: string): ConnectedClient | undefined {
        return this.clients.get(clientId);
    }
}
