# Cache

StruxJS includes a built-in cache system that supports multiple backing stores. You can switch between drivers without changing any application code - just update your configuration.

---

## Configuration

### Environment variables

```ini
CACHE_DRIVER=memory
CACHE_PREFIX=strux_cache_
```

Set `CACHE_DRIVER` to one of: `memory`, `file`, `database`, or `redis`.

### `config/cache.ts`

All cache stores are configured in `config/cache.ts`:

```typescript
import type { CacheConfig } from "struxjs";
import { env } from "struxjs";

const cacheConfig: CacheConfig = {
    default: env("CACHE_DRIVER", "memory"),
    prefix: env("CACHE_PREFIX", "strux_cache_"),

    stores: {
        memory: {
            driver: "memory",
        },
        file: {
            driver: "file",
            storagePath: undefined, // defaults to storage/framework/cache
        },
        database: {
            driver: "database",
            table: "cache",
        },
        redis: {
            driver: "redis",
            redisConnection: "cache", // matches a key in config/redis.ts
            prefix: env("CACHE_PREFIX", "strux:cache:"),
        },
    },
};

export default cacheConfig;
```

---

## Available Drivers

### `memory`

Stores items in a JavaScript `Map` inside the running process. Items are lost when the server restarts.

Best for: local development, unit tests, single-request caching.

```ini
CACHE_DRIVER=memory
```

### `file`

Stores each cache key as a JSON file on disk. Files are written to `storage/framework/cache/` by default. Key names are hashed with SHA-256 to generate safe filenames.

Best for: single-server deployments without Redis or a database.

```ini
CACHE_DRIVER=file
```

You can override the storage path in `config/cache.ts`:

```typescript
file: {
    driver: "file",
    storagePath: "/var/app/cache",
},
```

### `database`

Stores cache items in a SQL table. Requires running a migration first to create the `cache` table.

```ini
CACHE_DRIVER=database
```

Generate the migration:

```bash
npx strux cache:table
npx strux migrate
```

The generated table schema:

```typescript
table.string("key", 255).primary();
table.text("value").notNullable();
table.bigInteger("expires_at").nullable().defaultTo(null).index();
```

You can customise the table name in `config/cache.ts`:

```typescript
database: {
    driver: "database",
    table: "my_cache",
},
```

### `redis`

Stores cache items in Redis using `ioredis`. TTL is enforced natively by Redis via `SETEX`. Values are automatically serialized and deserialized as JSON.

```ini
CACHE_DRIVER=redis
```

The `redis` store uses the `cache` named connection from `config/redis.ts` by default. See the [Redis](/guide/redis) page for connection setup.

---

## Boot Sequence

`Cache` must be booted before use. This is already handled in `bootstrap.ts`:

```typescript
// Boot the cache system (reads config/cache.ts)
Cache.boot(app.container);

// Pre-resolve async drivers (redis, database) on startup
// Required for redis and database stores to work synchronously after this
await Cache.resolveStore();
```

For `memory` and `file` stores, `resolveStore()` is not strictly required but harmless to call.

---

## Importing

```typescript
import { Cache } from "struxjs";
```

For the global helper functions:

```typescript
import { cache, cacheAsync } from "struxjs";
```

---

## Methods

All `Cache` methods operate on the **default store** (set by `CACHE_DRIVER`). To target a specific store, see [Using Multiple Stores](#using-multiple-stores).

### `Cache.put(key, value, ttl?)`

Store a value. `ttl` is in seconds. Omit or pass `0` for no expiry (stores forever):

```typescript
await Cache.put("user:1", { name: "Alice" }, 300);  // expires in 5 minutes
await Cache.put("config:flags", { beta: true });     // no expiry
await Cache.put("locked", true, 0);                  // explicit forever
```

### `Cache.get(key, fallback?)`

Retrieve a cached value. Returns `null` if the key does not exist or has expired. Optionally provide a fallback value or callback:

```typescript
const user = await Cache.get("user:1");

// Static fallback
const theme = await Cache.get("settings:theme", "light");

// Callback fallback (executed only on cache miss)
const config = await Cache.get("app:config", () => loadConfig());
```

### `Cache.remember(key, ttl, callback)`

Return the cached value if it exists. Otherwise execute the callback, store the result with the given TTL, and return it:

```typescript
const user = await Cache.remember("user:1", 300, () => User.find(1));

const posts = await Cache.remember("posts:recent", 60, async () => {
    return await Post.latest().take(10).get();
});
```

### `Cache.rememberForever(key, callback)`

Same as `remember()` but stores the result without expiry:

```typescript
const settings = await Cache.rememberForever("app:settings", () => loadSettings());
```

### `Cache.pull(key)`

Retrieve a value and immediately delete it from the cache. Returns `null` if not found:

```typescript
const token = await Cache.pull("password_reset:user:5");
// token is returned, key is now deleted
```

### `Cache.has(key)`

Check if a key exists and has not expired. Returns `true` or `false`:

```typescript
if (await Cache.has("user:1:session")) {
    // session is still valid
}
```

### `Cache.forget(key)`

Delete a specific key. Returns `true` if deleted, `false` if the key did not exist:

```typescript
await Cache.forget("user:1");
```

### `Cache.flush()`

Remove all items from the default store:

```typescript
await Cache.flush();
```

### `Cache.increment(key, by?)`

Increment a numeric value by `by` (default `1`). Creates the key with value `1` if it does not exist. Returns the new value:

```typescript
await Cache.increment("stats:visits");        // 1, 2, 3...
await Cache.increment("stats:downloads", 5);  // increments by 5
```

### `Cache.decrement(key, by?)`

Decrement a numeric value by `by` (default `1`). Returns the new value:

```typescript
await Cache.decrement("credits:user:1");
await Cache.decrement("credits:user:1", 10);
```

### `Cache.add(key, value, ttl?)`

Store a value **only if the key does not already exist**. Returns `true` if stored, `false` if the key was already present. Useful for distributed locks:

```typescript
const acquired = await Cache.add("lock:job:42", true, 30);
if (!acquired) {
    // another process is already handling this job
}
```

### `Cache.forever(key, value)`

Store a value with no expiry:

```typescript
await Cache.forever("app:version", "1.4.2");
```

### `Cache.many(keys)`

Retrieve multiple keys at once. Returns an object with each key mapped to its value, or `null` for missing/expired keys:

```typescript
const result = await Cache.many(["user:1", "user:2", "user:3"]);
// { "user:1": { name: "Alice" }, "user:2": null, "user:3": { name: "Carol" } }
```

### `Cache.putMany(values, ttl?)`

Store multiple key-value pairs at once with the same TTL:

```typescript
await Cache.putMany({
    "user:1": { name: "Alice" },
    "user:2": { name: "Bob" },
}, 600);
```

---

## Global Helper Functions

### `cache(store?)`

Returns a synchronous driver instance. Safe for `memory` and `file` at any time. For `redis` and `database`, this is also safe **after** `await Cache.resolveStore()` has been called during app boot - the resolved driver is cached and reused:

```typescript
import { cache } from "struxjs";

// Always safe (memory/file)
await cache().put("key", "value", 60);
const val = await cache().get("key");

// Safe for redis/database AFTER bootstrap has run Cache.resolveStore()
await cache("redis").put("key", "value", 60);
```

### `cacheAsync(store?)`

Returns a `Promise<CacheDriver>` that resolves the store asynchronously. Guaranteed safe for all drivers at any point, including before `resolveStore()` has been called:

```typescript
import { cacheAsync } from "struxjs";

const store = await cacheAsync();
await store.put("key", "value", 60);

// Inline:
await (await cacheAsync("redis")).put("key", "value", 60);
```

---

## Using Multiple Stores

### `Cache.store(name)`

Get a synchronous reference to a named store. Safe for `memory` and `file`:

```typescript
await Cache.store("file").put("report:2026", data, 3600);
const val = await Cache.store("memory").get("temp:key");
```

### `Cache.resolveStore(name?)`

Async version - resolves the driver properly for all store types including `redis` and `database`:

```typescript
const redisStore = await Cache.resolveStore("redis");
await redisStore.put("session:user:1", sessionData, 1800);

const val = await redisStore.get("session:user:1");
```

### `Cache.extend(name, driver)`

Register a custom pre-built driver instance:

```typescript
import { Cache } from "struxjs";
import { MyCustomDriver } from "./MyCustomDriver.js";

Cache.extend("custom", new MyCustomDriver());

const val = await Cache.store("custom").get("key");
```

---

## Driver Comparison

| Driver | Persistence | Shared across servers | TTL enforcement | Best for |
| :--- | :--- | :--- | :--- | :--- |
| `memory` | No | No | In-process | Dev, tests, single-request |
| `file` | Yes (disk) | No | On read | Single-server, no infrastructure |
| `database` | Yes (SQL) | Yes | On read | Multi-server, no Redis |
| `redis` | Yes (Redis) | Yes | Native (atomic) | Production, high-traffic |

---

## CLI Commands

| Command | Description |
| :--- | :--- |
| `npx strux cache:clear` | Flush all items from the default store |
| `npx strux cache:clear -s redis` | Flush a specific named store |
| `npx strux cache:table` | Generate the migration for the database cache driver |
| `npx strux cache:table --table=my_cache` | Generate with a custom table name |
