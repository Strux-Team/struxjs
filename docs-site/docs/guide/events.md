# Event System

The Event System provides a simple pub/sub mechanism for decoupling application logic. When something happens - a user registers, an order ships, a file uploads - you fire an event. Listeners react to it independently, keeping business logic out of your controllers and services.

---

## How It Works

1. Define an **Event** class that carries data about what happened
2. Define one or more **Listener** classes that react to it
3. Register the mapping in `routes/events.ts`
4. Dispatch the event from anywhere in your code

`routes/events.ts` is loaded automatically during bootstrap - no manual wiring needed.

---

## Creating Events

```bash
npx strux make:event UserRegistered
```

Generated file (`app/Events/UserRegistered.ts`):

```typescript
import { Event } from "struxjs";

export class UserRegistered extends Event {
    constructor(
        public readonly user: User
    ) {
        super();
    }
}
```

Every event has a `firedAt` timestamp (ms since epoch) set automatically at instantiation.

---

## Creating Listeners

```bash
npx strux make:listener SendWelcomeEmail --event UserRegistered
```

Generated file (`app/Listeners/SendWelcomeEmail.ts`):

```typescript
import { Listener } from "struxjs";
import { UserRegistered } from "../Events/UserRegistered.js";

export class SendWelcomeEmail extends Listener {
    public async handle(event: UserRegistered): Promise<void> {
        // TODO: implement listener logic
    }

    public async failed(event: UserRegistered, error: Error): Promise<void> {
        // Optional: handle permanent failure (queued listeners only)
    }
}
```

### Listener properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `shouldQueue` | `boolean` | `false` | When `true`, listener runs in the background via the queue |
| `queue` | `string` | `"default"` | Queue name to use when `shouldQueue = true` |
| `tries` | `number` | `3` | Max retry attempts for queued listeners |

---

## Registering Listeners

Open `routes/events.ts` and register your event-to-listener mappings:

```typescript
import { EventDispatcher } from "struxjs";
import { UserRegistered } from "../app/Events/UserRegistered.js";
import { SendWelcomeEmail } from "../app/Listeners/SendWelcomeEmail.js";
import { LogUserActivity } from "../app/Listeners/LogUserActivity.js";

export default function (): void {
    EventDispatcher.listen(UserRegistered, [
        SendWelcomeEmail,
        LogUserActivity,
    ]);
}
```

`EventDispatcher.listen()` accepts an array - multiple listeners per event are fully supported and run in registration order.

---

## Dispatching Events

### Global `event()` helper

The recommended way to dispatch from anywhere in your code:

```typescript
import { event } from "struxjs";
import { UserRegistered } from "../Events/UserRegistered.js";

await event(new UserRegistered(user));
```

### `Event.dispatch()` static method

```typescript
await Event.dispatch(new UserRegistered(user));
```

### Instance `dispatch()` method

```typescript
const e = new UserRegistered(user);
await e.dispatch();
```

### `EventDispatcher.dispatch()` directly

```typescript
import { EventDispatcher } from "struxjs";

await EventDispatcher.dispatch(new UserRegistered(user));
```

All four forms are equivalent. `event()` is the most concise.

### `dispatchNow()` - fire and forget

Dispatches the event but **suppresses all listener errors**. Useful for side-effects that should never block the main request flow:

```typescript
await EventDispatcher.dispatchNow(new UserLoggedIn(user));
```

---

## Listener Types

### 1. Class-based listeners (recommended)

The standard approach. Register the class constructor - StruxJS instantiates it per dispatch:

```typescript
EventDispatcher.listen(UserRegistered, [SendWelcomeEmail]);
```

### 2. Inline callback listeners

Register a plain async function instead of a class. Useful for quick one-off reactions:

```typescript
EventDispatcher.on(UserRegistered, async (event) => {
    console.log(`New user: ${event.user.email}`);
});
```

`EventDispatcher.on()` is shorthand for `EventDispatcher.listen()` with a single callback.

### 3. Mixed listeners

You can mix class-based and callback listeners for the same event:

```typescript
EventDispatcher.listen(UserRegistered, [
    SendWelcomeEmail,                          // class
    LogUserActivity,                           // class
    async (event) => metrics.increment("users.registered"), // callback
]);
```

---

## Wildcard Listeners

Register a listener that fires for **every event** dispatched in the application:

```typescript
// Using listen()
EventDispatcher.listen("*", [
    async (event) => {
        console.log(`Event fired: ${event.constructor.name} at ${event.firedAt}`);
    },
]);

// Using on()
EventDispatcher.on("*", async (event) => {
    auditLog.record(event.constructor.name, event);
});
```

Wildcard listeners run after the specific listeners for the event.

---

## Queued Listeners

Set `shouldQueue = true` on a listener to run it in the background via the job queue instead of synchronously. This is useful for slow operations - sending emails, generating PDFs, calling external APIs - that should not delay the HTTP response.

```typescript
import { Listener } from "struxjs";
import { UserRegistered } from "../Events/UserRegistered.js";

export class SendWelcomeEmail extends Listener {
    public shouldQueue = true;
    public queue       = "emails";
    public tries       = 3;

    public async handle(event: UserRegistered): Promise<void> {
        await mailer.send(event.user.email, "Welcome to the platform!");
    }

    public async failed(event: UserRegistered, error: Error): Promise<void> {
        // Called when all retry attempts are exhausted
        console.error(`Failed to send welcome email to ${event.user.email}:`, error.message);
    }
}
```

Generate a queued listener directly with the `--queued` flag:

```bash
npx strux make:listener SendWelcomeEmail --event UserRegistered --queued
```

Queued listeners require a running worker:

```bash
npx strux queue:work --queue emails
```

---

## Practical Examples

### User registration flow

```typescript
// routes/events.ts
import { EventDispatcher } from "struxjs";
import { UserRegistered } from "../app/Events/UserRegistered.js";
import { SendWelcomeEmail } from "../app/Listeners/SendWelcomeEmail.js";
import { CreateUserProfile } from "../app/Listeners/CreateUserProfile.js";
import { NotifyAdmins } from "../app/Listeners/NotifyAdmins.js";

export default function (): void {
    EventDispatcher.listen(UserRegistered, [
        CreateUserProfile,   // sync - must complete before response
        SendWelcomeEmail,    // queued - email in background
        NotifyAdmins,        // queued - non-critical notification
    ]);
}
```

```typescript
// app/Controllers/AuthController.ts
import { event } from "struxjs";
import { UserRegistered } from "../Events/UserRegistered.js";

export class AuthController {
    public async register(request: Request, response: Response) {
        const user = await User.create(request.validated());

        await event(new UserRegistered(user));

        return response.json({ user });
    }
}
```

### Audit logging with wildcard

```typescript
// routes/events.ts
EventDispatcher.on("*", async (e) => {
    await AuditLog.create({
        event: e.constructor.name,
        fired_at: new Date(e.firedAt),
    });
});
```

### Conditional dispatch

```typescript
const order = await Order.create(data);

if (order.total > 1000) {
    await event(new HighValueOrderPlaced(order));
} else {
    await event(new OrderPlaced(order));
}
```

---

## Managing Listeners

### Check if an event has listeners

```typescript
const hasAny = EventDispatcher.hasListeners(UserRegistered);
```

### Get all registered listeners

```typescript
const map = EventDispatcher.getRegistered();
// { UserRegistered: 2, OrderPlaced: 1, "*": 1 }
```

### Remove listeners for a specific event

```typescript
EventDispatcher.forget(UserRegistered);
```

### Remove all listeners

```typescript
EventDispatcher.flush();
```

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `npx strux make:event <name>` | Create a new Event class in `app/Events/` |
| `npx strux make:listener <name>` | Create a new Listener class in `app/Listeners/` |
| `npx strux make:listener <name> --event <Event>` | Create a listener typed to a specific event |
| `npx strux make:listener <name> --queued` | Create a queued listener with `shouldQueue = true` |
