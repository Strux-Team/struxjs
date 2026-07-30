# Broadcasting & WebSocket

StruxJS includes a built-in WebSocket server and a `Broadcast` facade for pushing real-time events to connected clients. It supports in-process broadcasting, Redis Pub/Sub for multi-server deployments, and automatic broadcasting of application events and model mutations.

---

## Setup

### Register the WebSocket service provider

Add `WebSocketServiceProvider` to your application providers. This is usually already handled in `bootstrap.ts` by default when you scaffold the project. **Important:** It must be registered **before** `HttpServiceProvider` so the `/ws` route is added before the web server is started.

The WebSocket server attaches to the Fastify engine and listens on `/ws` by default.

### Select a broadcast driver

Call `Broadcast.useDriver()` during bootstrap, usually within the `register` method of `AppServiceProvider`:

```typescript
import { Broadcast } from "struxjs";

export class AppServiceProvider {
    public register(container: Container): void {
        // Default - in-process memory (development)
        Broadcast.useDriver("memory");

        // Redis Pub/Sub (production, multi-server)
        /*
        Broadcast.useDriver("redis", {
            host: "127.0.0.1",
            port: 6379,
        });
        */
    }
}
```

---

## Available Drivers

### `memory` (default)

Stores all connected clients in-process. Events are delivered directly to WebSocket connections on the same server instance. No external dependencies required.

Best for: local development, single-server deployments.

### `redis`

Publishes events to Redis Pub/Sub under the key prefix `struxjs_broadcast:{channel}`. Each server instance subscribes and delivers messages to its local WebSocket clients.

The architecture works as follows:

1. Any server calls `Broadcast.to("orders").emit("OrderShipped", data)`
2. The event is published to Redis: `PUBLISH struxjs_broadcast:orders <message>`
3. Every server instance is subscribed to `struxjs_broadcast:*` and receives the message
4. Each server forwards it to its local `MemoryBroadcaster`, which delivers to connected WebSocket clients

This means a client connected to **Server A** will receive events emitted from **Server B** or **Server C** - fully transparent to your application code.

Best for: production, multi-server / horizontally scaled deployments.

### `log`

Logs broadcast events to the console and stores them in memory. Used for testing.

---

## Broadcasting Events from the Server

### `Broadcast.to(channels).emit(event, payload)`

Emit an event to one or more channels:

```typescript
import { Broadcast } from "struxjs";

// Single channel
await Broadcast.to("notifications").emit("NewMessage", { text: "Hello!" });

// Multiple channels at once
await Broadcast.to(["orders", "order.42"]).emit("OrderShipped", {
    orderId: 42,
    tracking: "TRACK123",
});
```

### `Broadcast.channel(name).emit(event, payload)`

Alias for `Broadcast.to()`:

```typescript
await Broadcast.channel("chat.room.1").emit("UserTyping", { user: "Alice" });
```

### `Broadcast.user(userId).emit(event, payload)`

Shorthand for broadcasting to a user's private channel (`private-user.{id}`):

```typescript
await Broadcast.user(42).emit("Notification", { message: "Your order is ready." });
```

### `Broadcast.client(clientId).emit(event, payload)`

Send an event directly to a specific connected client by their `clientId`:

```typescript
// Client ID is provided in the "connected" handshake message
const sent = await Broadcast.client("client_1720000000_abc123")
    .emit("DirectMessage", { text: "Hello!" });

if (sent) {
    console.log("Message delivered");
} else {
    console.log("Client not found or disconnected");
}
```

Returns `true` if the client is connected and the message was delivered, `false` otherwise.

### `Broadcast.presence(channel)`

Get the list of all clients currently subscribed to a channel:

```typescript
const members = Broadcast.presence("chat.room.1");
console.log(members);
// [
//   { clientId: "client_...", user: { id: 42, name: "Alice" } },
//   { clientId: "client_...", user: null }  // unauthenticated client
// ]
```

Use this for building "who's online" features or presence indicators.

---

## Common Use Cases

### Building a chat application

```typescript
// In bootstrap.ts or a service provider
Broadcast.listen("chat.room.*", async (event, data, { channel, user, suppress }) => {
    if (event === "SendMessage") {
        // Save message to database
        const message = await Message.create({
            room_id: channel.split(".").pop(),
            user_id: user?.id,
            text: data.text,
            created_at: new Date()
        });

        // Don't re-broadcast the raw client message
        suppress();

        // Broadcast the saved message with full details
        await Broadcast.to(channel).emit("NewMessage", {
            id: message.id,
            user: { id: user.id, name: user.name },
            text: message.text,
            timestamp: message.created_at
        });
    }
});

// Notify other users when someone disconnects
Broadcast.onDisconnect(async ({ user, channels }) => {
    if (!user) return;

    for (const channel of channels) {
        if (channel.startsWith("chat.room.")) {
            await Broadcast.to(channel).emit("UserLeft", {
                userId: user.id,
                name: user.name
            });
        }
    }
});
```

### Real-time presence tracking

```typescript
import { Route, Request, Response, Broadcast } from "struxjs";

// API endpoint to get who's in a room
Route.get("/rooms/:roomId/presence", (req: Request, res: Response) => {
    const members = Broadcast.presence(`chat.room.${req.params.roomId}`);
    
    return res.send({
        room: req.params.roomId,
        online: members.length,
        users: members
            .filter(m => m.user !== null)
            .map(m => ({ id: m.user.id, name: m.user.name }))
    });
});
```

### Direct messaging between users

```typescript
// Send notification to specific user
Route.post("/users/:userId/notify", async (req: Request, res: Response) => {
    const { message } = req.body;
    
    // Check if user is online by looking at their private channel
    const presence = Broadcast.presence(`private-user.${req.params.userId}`);
    
    if (presence.length > 0) {
        // User is online, send real-time notification
        await Broadcast.user(req.params.userId).emit("Notification", {
            message,
            from: req.user.id,
            timestamp: new Date().toISOString()
        });
        
        return res.send({ sent: true, method: "realtime" });
    } else {
        // User offline, queue for later (email, push notification, etc.)
        await queueNotification(req.params.userId, message);
        return res.send({ sent: true, method: "queued" });
    }
});
```

### Message validation and rate limiting

```typescript
const rateLimits = new Map<string, number>();

Broadcast.listen("*", async (event, data, { channel, user, clientId, suppress }) => {
    // Rate limit: max 5 messages per second per client
    const key = clientId;
    const now = Date.now();
    const lastSent = rateLimits.get(key) ?? 0;
    
    if (now - lastSent < 200) {  // 200ms = 5 msg/sec
        suppress();  // Block the message
        
        // Notify the sender
        await Broadcast.client(clientId).emit("RateLimitExceeded", {
            message: "You are sending messages too quickly"
        });
        return;
    }
    
    rateLimits.set(key, now);
    
    // Validate message content
    if (typeof data.text === "string" && data.text.length > 1000) {
        suppress();
        await Broadcast.client(clientId).emit("Error", {
            message: "Message too long (max 1000 characters)"
        });
    }
});
```

---

## Server-Side Message Listeners

### `Broadcast.listen(channelPattern, callback)`

Register a callback that runs whenever a client sends a message (via `whisper` or `message` action) to a matching channel:

```typescript
import { Broadcast } from "struxjs";

Broadcast.listen("chat", async (event, data, context) => {
    console.log(`Received '${event}' on '${context.channel}':`, data);
    console.log(`User:`, context.user?.id ?? "guest");

    // Process the message, save to database, etc.
    await saveMessageToDatabase(event, data, context.user);
});
```

**Callback signature:**

```typescript
(event: string, data: any, context: {
    user: any | null;
    channel: string;
    clientId: string;
    suppress: () => void;
}) => void | Promise<void>
```

### Pattern matching

The `channelPattern` parameter supports:

- **Exact match**: `"chat"` - only matches `chat`
- **Wildcard all**: `"*"` - matches any channel
- **Glob pattern**: `"chat.room.*"` - matches `chat.room.1`, `chat.room.2`, etc.

```typescript
// Listen to all chat rooms
Broadcast.listen("chat.room.*", (event, data, { channel }) => {
    console.log(`Message in ${channel}:`, data);
});

// Listen to everything
Broadcast.listen("*", (event, data, { channel }) => {
    console.log(`[${channel}] ${event}`, data);
});
```

**Glob pattern rules:**

- `*` at the end matches one segment: `chat.room.*` → `chat.room.1`, `chat.room.1.thread`
- Use exact matches for fixed channels
- Patterns are tested with regex internally for safety

### Suppress re-broadcast

By default, when a client sends a message via `whisper` or `message`, the server re-broadcasts it to all other subscribers on the channel. Use `context.suppress()` to prevent this:

```typescript
Broadcast.listen("chat", async (event, data, { channel, suppress }) => {
    if (event === "NewMessage") {
        // Process the message but don't fan it out to other clients
        suppress();

        // Optionally send a custom response instead
        await Broadcast.to(channel).emit("ServerReply", {
            text: `Server received: "${data.text}"`,
            from: "server"
        });
    }
});
```

This is useful for:
- Filtering or validating messages before broadcast
- Sending customized responses per user
- Implementing message moderation or rate limiting

### `Broadcast.onDisconnect(callback)`

Register a callback that runs when a client disconnects:

```typescript
Broadcast.onDisconnect(({ clientId, user, channels }) => {
    console.log(`Client ${clientId} disconnected from channels:`, channels);
    console.log(`User:`, user?.id ?? "guest");

    // Clean up user presence, notify other users, etc.
    channels.forEach(async (channel) => {
        await Broadcast.to(channel).emit("UserLeft", {
            userId: user?.id,
            channel
        });
    });
});
```

**Callback signature:**

```typescript
(context: {
    clientId: string;
    user: any | null;
    channels: string[];
}) => void | Promise<void>
```

The `channels` array contains all channels the client was subscribed to at the time of disconnection.

---

## The `ShouldBroadcast` Interface

Application events can be broadcast automatically by implementing the `ShouldBroadcast` interface. When `EventDispatcher.dispatch()` fires an event that implements this interface, StruxJS broadcasts it immediately alongside running any registered listeners.

```typescript
import { Event } from "struxjs";
import { ShouldBroadcast } from "struxjs";

export class OrderShipped extends Event implements ShouldBroadcast {
    constructor(
        public readonly orderId: number,
        public readonly trackingCode: string
    ) {
        super();
    }

    // Required: channels to broadcast on
    public broadcastOn(): string | string[] {
        return [`order.${this.orderId}`, "orders"];
    }

    // Optional: custom event name (defaults to class name)
    public broadcastAs(): string {
        return "OrderShipped";
    }

    // Optional: payload (defaults to all public properties)
    public broadcastWith(): Record<string, any> {
        return {
            id: this.orderId,
            tracking: this.trackingCode,
        };
    }
}
```

Dispatch it like any other event - broadcasting happens automatically:

```typescript
import { event } from "struxjs";

await event(new OrderShipped(42, "TRACK123"));
// Broadcasts "OrderShipped" to ["order.42", "orders"] automatically
```

---

## Model Broadcasting

Enable automatic broadcasting on a model by setting `broadcastEvents`:

```typescript
export class Post extends BaseModel {
    protected table = "posts";

    // Broadcast all CRUD events
    protected broadcastEvents = true;
}
```

Or limit to specific actions:

```typescript
export class Post extends BaseModel {
    protected table = "posts";

    protected broadcastEvents: Array<"created" | "updated" | "deleted"> = ["created", "deleted"];
}
```

When a model is saved or deleted, StruxJS fires:

| Action | Event name | Channels |
| :--- | :--- | :--- |
| `created` | `PostCreated` | `["posts"]` |
| `updated` | `PostUpdated` | `["posts", "posts.{id}"]` |
| `deleted` | `PostDeleted` | `["posts", "posts.{id}"]` |

The payload always contains `{ action, model }` where `model` is the result of `toArray()`.

### Customising model broadcast behaviour

Override the defaults on the model:

```typescript
export class Post extends BaseModel {
    protected table = "posts";
    protected broadcastEvents = true;

    // Custom channels
    public broadcastOn(action: "created" | "updated" | "deleted"): string | string[] {
        return [`user.${this.user_id}.posts`, "posts"];
    }

    // Custom event name
    public broadcastAs(action: "created" | "updated" | "deleted"): string {
        return `Post${action.charAt(0).toUpperCase() + action.slice(1)}`;
    }

    // Custom payload
    public broadcastWith(action: "created" | "updated" | "deleted"): Record<string, any> {
        return { id: this.id, title: this.title, action };
    }
}
```

---

## Channel Authorization

By default:

- **Public channels** (no prefix) - open to everyone
- **Private channels** (`private-` prefix) - require authentication
- **`private-user.{id}`** - only the user whose ID matches the channel ID

Register custom authorization callbacks for private/presence channels in `AppServiceProvider`:

```typescript
import { Broadcast } from "struxjs";

export class AppServiceProvider {
    public register(container: Container): void {
        // Only allow users who are members of the room
        Broadcast.authorizeChannel("chat.room.:roomId", async (user, roomId) => {
            return await RoomMember.where("user_id", user.id)
                .where("room_id", roomId)
                .exists();
        });

        // Admin-only channel
        Broadcast.authorizeChannel("admin.dashboard", (user) => {
            return user?.role === "admin";
        });
    }
}
```

The pattern `:roomId` is a dynamic segment that is extracted from the channel name and passed as an argument to the callback.

---

## Client-Side Connection

Connect using the browser's native `WebSocket` API. No special client library is needed.

### Basic connection

```javascript
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
    console.log("Connected");
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log(message.event, message.data);
};
```

### Authenticated connection

Pass a JWT Bearer token as a query parameter:

```javascript
const token = localStorage.getItem("auth_token");
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);
```

On connect, the server verifies the token and associates the connection with the authenticated user. This is required for subscribing to private channels.

### Subscribe to a channel

Send a JSON message with `action: "subscribe"`:

```javascript
ws.send(JSON.stringify({
    action: "subscribe",
    channel: "orders"
}));

// Response from server:
// { event: "subscribed", channel: "orders" }
```

### Subscribe to a private channel

```javascript
ws.send(JSON.stringify({
    action: "subscribe",
    channel: "private-user.42"
}));
```

The server checks authorization before confirming the subscription. If denied:

```json
{ "event": "error", "message": "Unauthorized subscription to channel 'private-user.42'" }
```

### Unsubscribe

```javascript
ws.send(JSON.stringify({
    action: "unsubscribe",
    channel: "orders"
}));
```

### Receive events

All broadcast events sent to subscribed channels arrive as:

```json
{
    "event": "OrderShipped",
    "data": { "id": 42, "tracking": "TRACK123" },
    "channels": ["orders", "order.42"]
}
```

### Ping / keepalive

```javascript
ws.send(JSON.stringify({ action: "ping" }));
// Response: { "event": "pong" }
```

### Whisper (client-to-channel message)

Authenticated clients can send messages to a channel. All other subscribers on that channel receive it:

```javascript
ws.send(JSON.stringify({
    action: "whisper",
    channel: "chat.room.1",
    event: "UserTyping",
    data: { user: "Alice" }
}));
```

---

## Connection Handshake

On successful connection, the server sends:

```json
{
    "event": "connected",
    "clientId": "client_1720000000_abc123",
    "message": "Connected to StruxJS WebSocket Server"
}
```

---

## API Reference

### Server-side (`Broadcast`)

| Method | Description |
| :--- | :--- |
| `Broadcast.useDriver(driver, options?)` | Select broadcast driver (`"memory"`, `"redis"`, `"log"`) |
| `Broadcast.to(channels).emit(event, payload)` | Emit event to channels |
| `Broadcast.channel(name).emit(event, payload)` | Alias for `to()` |
| `Broadcast.user(userId).emit(event, payload)` | Emit to `private-user.{id}` |
| `Broadcast.client(clientId).emit(event, payload)` | Emit to a specific connected client |
| `Broadcast.presence(channel)` | Get list of clients subscribed to a channel |
| `Broadcast.listen(pattern, callback)` | Register server-side listener for client messages |
| `Broadcast.onDisconnect(callback)` | Register callback for client disconnections |
| `Broadcast.event(eventInstance)` | Broadcast a `ShouldBroadcast` event |
| `Broadcast.authorizeChannel(pattern, callback)` | Register a channel auth callback |

### Client-side actions (WebSocket messages)

| Action | Required fields | Description |
| :--- | :--- | :--- |
| `subscribe` | `channel` | Subscribe to a channel |
| `unsubscribe` | `channel` | Unsubscribe from a channel |
| `whisper` | `channel`, `event`, `data` | Send a message to channel subscribers |
| `message` | `channel`, `event`, `data` | Alias for `whisper` |
| `ping` | - | Keepalive ping |
