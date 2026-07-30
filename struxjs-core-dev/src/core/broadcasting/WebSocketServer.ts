import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { Broadcast } from "./Broadcast.js";
import { JwtGuard } from "../auth/JwtGuard.js";

export class WebSocketServer {
    private static isRegistered = false;

    /**
     * Attach WebSocket route to the Fastify instance.
     * The @fastify/websocket plugin must already be registered (done in Router constructor).
     * Route is registered inside a fastify.register() scope as required by @fastify/websocket.
     */
    public static async attach(fastify: FastifyInstance, path = "/ws"): Promise<void> {
        if (this.isRegistered) return;
        this.isRegistered = true;

        fastify.register(async (instance) => {
            instance.get(path, { websocket: true }, (socket: WebSocket, req: any) => {
                const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                let user: any = null;

                // Authenticate user from JWT token (query string or Authorization header)
                const queryToken = (req.query as any)?.token;
                const authHeader = req.headers.authorization;
                const rawToken = queryToken || (authHeader ? authHeader.replace("Bearer ", "").trim() : null);

                // Store a promise for async auth — attach message handler synchronously
                const authPromise = rawToken
                    ? JwtGuard.tryVerify(rawToken)
                        .then((payload) => {
                            if (payload) user = { id: payload.sub ?? payload.id, ...payload };
                        })
                        .catch(() => {})
                    : Promise.resolve();

                const memoryBroadcaster = Broadcast.getMemoryBroadcaster();
                memoryBroadcaster.registerClient(clientId, socket, null);

                // Send welcome connection handshake
                socket.send(JSON.stringify({
                    event: "connected",
                    clientId,
                    message: "Connected to StruxJS WebSocket Server"
                }));

                // Handle incoming client messages synchronously, async auth resolves inside
                socket.on("message", async (rawMessage: any) => {
                    await authPromise; // wait for auth to complete before processing

                    try {
                        const payload = JSON.parse(rawMessage.toString());
                        const { action, channel, event: clientEvent, data } = payload;

                        if (action === "subscribe" && channel) {
                            const isAuthorized = await Broadcast.isChannelAuthorized(user, channel);
                            if (isAuthorized) {
                                memoryBroadcaster.subscribe(clientId, channel);
                                socket.send(JSON.stringify({ event: "subscribed", channel }));
                            } else {
                                socket.send(JSON.stringify({
                                    event: "error",
                                    message: `Unauthorized subscription to channel '${channel}'`
                                }));
                            }
                        } else if (action === "unsubscribe" && channel) {
                            memoryBroadcaster.unsubscribe(clientId, channel);
                            socket.send(JSON.stringify({ event: "unsubscribed", channel }));
                        } else if ((action === "message" || action === "whisper") && channel && clientEvent) {
                            const isAuthorized = await Broadcast.isChannelAuthorized(user, channel);
                            if (isAuthorized) {
                                // Deliver to server-side listeners; suppress() prevents re-broadcast
                                const suppressed = await Broadcast.dispatchIncoming(channel, clientEvent, data || {}, user);
                                if (!suppressed) {
                                    await Broadcast.to(channel).emit(clientEvent, data || {});
                                }
                            }
                        } else if (action === "ping") {
                            socket.send(JSON.stringify({ event: "pong" }));
                        }
                    } catch {
                        socket.send(JSON.stringify({
                            event: "error",
                            message: "Invalid WebSocket JSON message format"
                        }));
                    }
                });

                socket.on("close", () => {
                    const client = memoryBroadcaster.getClient(clientId);
                    const channels = client ? [...client.channels] : [];
                    memoryBroadcaster.removeClient(clientId);
                    Broadcast.dispatchDisconnect(clientId, user, channels).catch(() => {});
                });

                socket.on("error", () => {
                    const client = memoryBroadcaster.getClient(clientId);
                    const channels = client ? [...client.channels] : [];
                    memoryBroadcaster.removeClient(clientId);
                    Broadcast.dispatchDisconnect(clientId, user, channels).catch(() => {});
                });
            });
        });
    }

    public static reset(): void {
        this.isRegistered = false;
    }
}
