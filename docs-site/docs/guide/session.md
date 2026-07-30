# Session

StruxJS provides a session system that persists data across HTTP requests using a session ID stored in a cookie. Session data is automatically loaded at the start of each request and saved when the response is sent.

---

## How It Works

Every request that goes through `routes/web.ts` is automatically wrapped with the `StartSession` middleware. On each request it:

1. Reads the session ID from the `struxjs_session` cookie
2. Loads the session payload from the configured driver (file, database, redis, or memory)
3. Makes the session available via `request.session()`
4. Saves the session back to the driver when the response finishes

API routes (`routes/api.ts`) do **not** have session middleware applied - sessions are web-only by default.

---

## Configuration

### Environment variables

```ini
SESSION_DRIVER=file
SESSION_LIFETIME=120
SESSION_TABLE=sessions
SESSION_COOKIE=struxjs_session
SESSION_DOMAIN=
SESSION_SECURE=false
```

### `config/session.ts`

```typescript
import { env } from "struxjs";

export default {
    driver: env("SESSION_DRIVER", "file"),
    lifetime: Number(env("SESSION_LIFETIME", 120)), // minutes
    table: env("SESSION_TABLE", "sessions"),
    cookie: env("SESSION_COOKIE", "struxjs_session"),
    path: "/",
    domain: env("SESSION_DOMAIN", undefined),
    secure: env("SESSION_SECURE", false),
    http_only: true,
    same_site: "lax" as const,
};
```

::: warning Cookie name
The `StartSession` middleware currently uses a hardcoded cookie name of `struxjs_session`. The `SESSION_COOKIE` config value is available in `config/session.ts` but is not yet consumed by the middleware - the cookie name cannot be changed via environment variable at this time.
:::

---

## Available Drivers

### `file` (default)

Stores each session as a JSON file in `storage/framework/sessions/`. Each file is named by session ID and includes an expiry timestamp checked on read.

```ini
SESSION_DRIVER=file
```

### `memory`

Stores sessions in a static `Map` inside the running process. Sessions are lost on server restart.

Best for: automated testing, local development.

```ini
SESSION_DRIVER=memory
```

### `database`

Stores sessions in a SQL table (or MongoDB collection). Supports both relational databases and MongoDB.

```ini
SESSION_DRIVER=database
```

You need to create the sessions table first. Generate and run the migration:

```bash
npx strux make:migration create_sessions_table
npx strux migrate
```

The table must have these columns:

```typescript
table.string("id").primary();
table.integer("user_id").nullable();
table.text("payload").notNullable();
table.integer("last_activity").notNullable();
```

The table name defaults to `sessions` and is configurable via `SESSION_TABLE`.

### `redis`

Stores sessions in Redis using `ioredis`. TTL is enforced natively by Redis. Session keys are prefixed with `strux_session:` by default (configurable via `REDIS_PREFIX`).

```ini
SESSION_DRIVER=redis
```

Redis connection parameters are read from `config/redis.ts` (`default` connection) and the same `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` environment variables.

---

## Accessing the Session

### Via `request.session()`

Inside a Controller action, inject `request` and call `.session()`:

```typescript
import { Request, Response } from "struxjs";

export class UserController {
    public async store(request: Request, response: Response) {
        const session = request.session();

        session.put("user_id", 42);
        const userId = session.get("user_id");
    }
}
```

### Via the `session()` global helper

Outside of a controller - in services, middleware, or event listeners - use the `session()` global helper:

```typescript
import { session } from "struxjs";

const store = session();
store.put("key", "value");
```

---

## Session Methods

All methods are available on the `SessionStore` instance returned by `request.session()` or `session()`.

### `put(key, value)` / `set(key, value)`

Store a value in the session:

```typescript
session.put("theme", "dark");
session.set("locale", "en");   // alias
```

### `get(key, defaultValue?)`

Retrieve a value from the session. Checks both persistent attributes and flash data. Returns the default if the key is not found:

```typescript
const theme = session.get("theme");
const locale = session.get("locale", "en");
```

### `has(key)` / `exists(key)`

Check whether a key is present in the session:

```typescript
if (session.has("user_id")) {
    // user is logged in
}
```

### `forget(key)` / `delete(key)`

Remove a specific key from the session:

```typescript
session.forget("temp_token");
session.delete("temp_token");  // alias
```

### `flush()`

Remove all data from the session - both persistent attributes and flash data:

```typescript
session.flush();
```

### `all()`

Get all session data (persistent + flash) as a plain object:

```typescript
const data = session.all();
```

### `getId()`

Get the current session ID:

```typescript
const id = session.getId();
```

### `regenerate()`

Destroy the current session and generate a new ID. The old session data is cleared from the driver. Used to prevent session fixation attacks (called automatically by `Auth.login()`):

```typescript
session.regenerate();
```

---

## Flash Messages

Flash data is stored in the session for **one request only**. It is automatically available on the very next request and then discarded.

### `session.flash(key, value)`

Store a flash value directly:

```typescript
session.flash("status", "Profile updated successfully.");
```

### Reading flash data

Flash data is read with the same `session.get()` method:

```typescript
const status = session.get("status");
```

### Flashing on redirect

The `RedirectResponse` methods `.with()`, `.withInput()`, and `.withErrors()` make it easy to flash data as part of a redirect.

#### `.with(key, value)` / `.with(object)`

Flash one or more key-value pairs and redirect:

```typescript
return response.redirect("/dashboard")
    .with("status", "Settings saved.");

// Multiple keys at once
return response.redirect("/dashboard")
    .with({ status: "Saved.", level: "success" });
```

#### `.withInput()`

Flash all current request input so it can be repopulated in the next form render:

```typescript
return response.redirect().back()
    .withInput();
```

Access flashed input in the next request via `request.old()`:

```typescript
const email = request.old("email");
const name  = request.old("name", "");  // with default
```

In `.strux` templates, `old()` is automatically available:

```html
<input type="email" name="email" value="{{ old('email') }}">
```

#### `.withErrors(errors)`

Flash validation errors to the session. On the next request, errors are automatically injected into template context as the `errors` variable:

```typescript
return response.redirect().back()
    .withInput()
    .withErrors({ email: "Email address is already taken." });
```

In templates, `errors` is available as a `ErrorBag`:

```html
@if(errors.has('email'))
    <p>{{ errors.first('email') }}</p>
@endif
```

---

## Applying the Session Middleware Manually

The `StartSession` middleware is auto-applied to all web routes. For custom route groups or API routes where you need session support, apply it explicitly:

```typescript
import { Route } from "struxjs";
import { StartSession } from "struxjs";

// Apply to a specific route
Route.get("/checkout", [CheckoutController, "show"])
    .middleware(StartSession);

// Apply to a group
Route.middleware([StartSession]).group(() => {
    Route.get("/cart", [CartController, "index"]);
    Route.post("/cart", [CartController, "store"]);
});
```

To exclude session from specific web routes (e.g. webhooks):

```typescript
import { StartSession } from "struxjs";

Route.post("/webhooks/stripe", [WebhookController, "handle"])
    .withoutMiddleware(StartSession);

// Or using the string alias
Route.post("/webhooks/stripe", [WebhookController, "handle"])
    .withoutMiddleware("session");
```

---

## Driver Comparison

| Driver | Persistence | Shared across servers | TTL enforcement | Best for |
| :--- | :--- | :--- | :--- | :--- |
| `file` | Yes (disk) | No | On read | Default, single-server |
| `memory` | No | No | On read | Testing, local dev |
| `database` | Yes (SQL/Mongo) | Yes | On read | Multi-server, no Redis |
| `redis` | Yes (Redis) | Yes | Native (atomic) | Production, high-traffic |
