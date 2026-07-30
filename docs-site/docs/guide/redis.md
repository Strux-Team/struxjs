# Redis

StruxJS provides a `Redis` facade built on top of [ioredis](https://github.com/redis/ioredis) for direct Redis access. The `ioredis` dependency is bundled with the framework - no separate installation required.

---

## Configuration

### Environment variables

Add the following to your `.env` file:

```ini
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_CACHE_DB=1
REDIS_QUEUE_DB=2
REDIS_PREFIX=strux_
```

### `config/redis.ts`

Redis connections are defined in `config/redis.ts`. Three named connections are provided by default:

```typescript
import { env } from "struxjs";

export default {
    // General-purpose connection
    default: {
        host: env("REDIS_HOST", "127.0.0.1"),
        port: Number(env("REDIS_PORT", 6379)),
        password: env("REDIS_PASSWORD", undefined),
        database: Number(env("REDIS_DB", 0)),
        prefix: env("REDIS_PREFIX", ""),
    },

    // Used by the Cache system (REDIS_CACHE_DB)
    cache: {
        host: env("REDIS_HOST", "127.0.0.1"),
        port: Number(env("REDIS_PORT", 6379)),
        password: env("REDIS_PASSWORD", undefined),
        database: Number(env("REDIS_CACHE_DB", 1)),
    },

    // Used by the Queue system (REDIS_QUEUE_DB)
    queue: {
        host: env("REDIS_HOST", "127.0.0.1"),
        port: Number(env("REDIS_PORT", 6379)),
        password: env("REDIS_PASSWORD", undefined),
        database: Number(env("REDIS_QUEUE_DB", 2)),
    },
};
```

You can add as many named connections as you need. Each connection can point to a different database index or a different Redis server entirely.

---

## The `Redis` Facade

Import `Redis` from `struxjs` to access the default connection directly via static methods. Every call is automatically delegated to the `default` named connection:

```typescript
import { Redis } from "struxjs";
```

For a named connection, use `Redis.connection(name)` which returns a raw `ioredis` client:

```typescript
const client = Redis.connection("cache");
await client.set("key", "value");
```

`Redis.client(name?)` is an alias for `Redis.connection()`:

```typescript
const client = Redis.client("default");
```

### `Redis.disconnect(name?)`

Gracefully close a named connection, or all open connections if no name is provided:

```typescript
// Close a specific connection
await Redis.disconnect("cache");

// Close all open connections
await Redis.disconnect();
```

---

## String Commands

### `Redis.get(key)`

Retrieve a string value by key. Returns `null` if the key does not exist:

```typescript
const value = await Redis.get("user:1:name");
```

### `Redis.set(key, value)`

Store a string value without expiry:

```typescript
await Redis.set("app:mode", "maintenance");
```

### `Redis.set(key, value, mode, duration)`

Store a string value with options. Use `"EX"` for seconds, `"PX"` for milliseconds:

```typescript
// Expire after 60 seconds
await Redis.set("session:token", "abc123", "EX", 60);
```

### `Redis.setex(key, seconds, value)`

Store a value with an explicit TTL in seconds:

```typescript
await Redis.setex("otp:user:42", 300, "847261");
```

### `Redis.del(...keys)`

Delete one or more keys. Returns the number of keys deleted:

```typescript
await Redis.del("user:1:cache");
await Redis.del("key1", "key2", "key3");
```

### `Redis.exists(...keys)`

Returns the number of the provided keys that exist:

```typescript
const count = await Redis.exists("user:1", "user:2");
// 2 if both exist
```

### `Redis.expire(key, seconds)`

Set a TTL on an existing key:

```typescript
await Redis.expire("user:1:session", 3600);
```

### `Redis.ttl(key)`

Get the remaining TTL in seconds. Returns `-1` if the key has no expiry, `-2` if the key does not exist:

```typescript
const seconds = await Redis.ttl("user:1:session");
```

---

## Counter Commands

### `Redis.incr(key)`

Increment a key's integer value by 1. Creates the key with value `1` if it does not exist:

```typescript
await Redis.incr("stats:page_views");
```

### `Redis.decr(key)`

Decrement a key's integer value by 1:

```typescript
await Redis.decr("inventory:item:42");
```

### `Redis.incrby(key, increment)`

Increment by a specific amount:

```typescript
await Redis.incrby("stats:downloads", 5);
```

### `Redis.decrby(key, decrement)`

Decrement by a specific amount:

```typescript
await Redis.decrby("credits:user:1", 10);
```

---

## Hash Commands

Hashes store multiple field-value pairs under a single key.

### `Redis.hset(key, field, value)` / `Redis.hset(key, object)`

Set one or multiple fields on a hash:

```typescript
// Single field
await Redis.hset("user:1", "name", "Alice");

// Multiple fields at once
await Redis.hset("user:1", {
    name: "Alice",
    email: "alice@example.com",
    role: "admin",
});
```

### `Redis.hget(key, field)`

Get a single field from a hash:

```typescript
const name = await Redis.hget("user:1", "name");
```

### `Redis.hgetall(key)`

Get all fields and values from a hash as a plain object:

```typescript
const user = await Redis.hgetall("user:1");
// { name: "Alice", email: "alice@example.com", role: "admin" }
```

### `Redis.hdel(key, ...fields)`

Delete one or more fields from a hash:

```typescript
await Redis.hdel("user:1", "role");
await Redis.hdel("user:1", "role", "email");
```

---

## List Commands

Lists are ordered sequences of strings, commonly used for queues and activity feeds.

### `Redis.lpush(key, ...values)`

Push values to the **left** (head) of a list:

```typescript
await Redis.lpush("notifications:user:1", "New message received");
```

### `Redis.rpush(key, ...values)`

Push values to the **right** (tail) of a list:

```typescript
await Redis.rpush("job:queue", "SendEmailJob", "ProcessImageJob");
```

### `Redis.lpop(key)`

Remove and return the leftmost element:

```typescript
const job = await Redis.lpop("job:queue");
```

### `Redis.rpop(key)`

Remove and return the rightmost element:

```typescript
const item = await Redis.rpop("job:queue");
```

### `Redis.lrange(key, start, stop)`

Get a slice of the list by index range. Use `0, -1` for the full list:

```typescript
const all = await Redis.lrange("notifications:user:1", 0, -1);
const latest10 = await Redis.lrange("notifications:user:1", 0, 9);
```

---

## Set Commands

Sets are unordered collections of unique strings.

### `Redis.sadd(key, ...members)`

Add one or more members to a set:

```typescript
await Redis.sadd("online:users", "user:1", "user:2", "user:5");
```

### `Redis.smembers(key)`

Get all members of a set:

```typescript
const onlineUsers = await Redis.smembers("online:users");
```

### `Redis.srem(key, ...members)`

Remove one or more members from a set:

```typescript
await Redis.srem("online:users", "user:2");
```

---

## Pub/Sub

### `Redis.publish(channel, message)`

Publish a message to a channel:

```typescript
await Redis.publish("events:orders", JSON.stringify({ orderId: 99, status: "paid" }));
```

### `Redis.subscribe(...channels)`

Subscribe to one or more channels. Returns the ioredis client in subscriber mode. Use `Redis.connection()` for a dedicated subscriber client to avoid blocking the shared connection:

```typescript
const subscriber = Redis.connection("default");

await subscriber.subscribe("events:orders");

subscriber.on("message", (channel, message) => {
    const data = JSON.parse(message);
    console.log(`[${channel}]`, data);
});
```

---

## Other Commands

### `Redis.flushdb()`

Delete all keys in the current database. Use with caution:

```typescript
await Redis.flushdb();
```

### Accessing the raw ioredis client

`Redis.connection(name?)` returns the underlying `ioredis` client for the named connection, giving you access to any command not exposed as a static method:

```typescript
const client = Redis.connection("default");

// Any ioredis command
await client.zadd("leaderboard", 1500, "user:1");
await client.zrange("leaderboard", 0, -1, "WITHSCORES");
await client.pipeline()
    .set("a", 1)
    .set("b", 2)
    .exec();
```
