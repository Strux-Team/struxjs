# Queue & Background Workers

The Queue system lets you defer time-consuming tasks - sending emails, generating reports, processing uploads - to background workers so they don't block HTTP responses.

---

## Configuration

### Environment variable

```ini
QUEUE_CONNECTION=sync
```

### `config/queue.ts`

Four named connections are provided by default:

```typescript
import type { QueueConfig } from "struxjs";
import { env } from "struxjs";

const queueConfig: QueueConfig = {
    default: env("QUEUE_CONNECTION", "sync"),

    connections: {
        sync: {
            driver: "sync",
        },
        redis: {
            driver: "redis",
            connection: "default",  // matches a key in config/redis.ts
            queue: "default",
        },
        database: {
            driver: "database",
            table: "jobs",
            failedTable: "failed_jobs",
            reservationTimeout: 90, // seconds before a stuck job is released
            queue: "default",
        },
        file: {
            driver: "file",
            storagePath: undefined, // defaults to storage/framework/queue
            queue: "default",
        },
    },
};

export default queueConfig;
```

---

## Available Drivers

### `sync`

Executes jobs immediately in the same process - no worker needed. Useful for local development and testing where you don't want to run a separate worker process.

```ini
QUEUE_CONNECTION=sync
```

### `redis`

Stores jobs in Redis lists. Immediate jobs use `LPUSH`/`BRPOP`. Delayed jobs are placed in a sorted set (`ZADD`) keyed by their run timestamp and moved to the main list when they become ready.

```ini
QUEUE_CONNECTION=redis
```

Redis connection parameters are read from `config/redis.ts` (`default` connection by default).

### `database`

Stores jobs in a SQL table. Supports race-condition-safe job reservation and a configurable reservation timeout - if a worker crashes mid-job, the reservation expires and another worker can pick it up.

```ini
QUEUE_CONNECTION=database
```

Generate the required migrations:

```bash
npx strux queue:table
npx strux migrate
```

This creates two tables:

**`jobs`** - pending and in-flight jobs:

```typescript
table.string("id", 36).primary();
table.string("queue", 255).notNullable().defaultTo("default").index();
table.text("payload").notNullable();
table.integer("attempts").notNullable().defaultTo(0);
table.bigInteger("available_at").notNullable().index();
table.bigInteger("reserved_at").nullable().defaultTo(null);
table.bigInteger("created_at").notNullable();
```

**`failed_jobs`** - permanently failed jobs:

```typescript
table.string("id", 36).primary();
table.string("queue", 255).notNullable().index();
table.text("payload").notNullable();
table.bigInteger("failed_at").notNullable().index();
```

### `file`

Stores each job as a JSON file in `storage/framework/queue/<queue-name>/`. Failed jobs go into `storage/framework/queue/failed/`. No external dependencies required.

```ini
QUEUE_CONNECTION=file
```

---

## Creating a Job

```bash
npx strux make:job SendEmailJob
```

Generated file (`app/Jobs/SendEmailJob.ts`):

```typescript
import { Job } from "struxjs";

export class SendEmailJob extends Job {
    public queue = "default";
    public tries = 3;

    constructor(
        public readonly email: string,
        public readonly subject: string
    ) {
        super();
    }

    public async handle(): Promise<void> {
        // Job logic here
        await mailer.send(this.email, this.subject);
    }

    public async failed(error: Error): Promise<void> {
        // Called when all retry attempts are exhausted
        console.error("SendEmailJob permanently failed:", error.message);
    }
}
```

### Job properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `queue` | `string` | `"default"` | Queue name this job belongs to |
| `tries` | `number` | `3` | Max retry attempts before moving to failed jobs |
| `delay` | `number` | `0` | Seconds before the job becomes available |
| `timeout` | `number` | `60` | Max seconds a single `handle()` execution may run |

### `handle()`

Contains the job's work logic. If it throws, the job is retried until `tries` is exhausted.

### `failed(error)`

Called once when all retries are exhausted. Use it to send alerts, clean up resources, or log permanently failed work. The default implementation is a no-op.

---

## Job Auto-Discovery

StruxJS fully automates job registration out of the box. 

When your application starts (both web server and CLI workers), the core engine automatically scans the `app/Jobs/` directory and registers any exported Job classes. 

Internal framework jobs (such as `SendMailJob` used by the Mail component) are also auto-registered safely behind the scenes.

---

## Dispatching Jobs

### `dispatch(job, options?)`

The global `dispatch` helper is the recommended way to push a job to the queue:

```typescript
import { dispatch } from "struxjs";
import { SendEmailJob } from "../Jobs/SendEmailJob.js";

// Dispatch to default queue
await dispatch(new SendEmailJob("alice@example.com", "Welcome!"));

// Dispatch to a named queue
await dispatch(new SendEmailJob("alice@example.com", "Welcome!"), {
    queue: "emails",
});

// Dispatch with a delay (run after 60 seconds)
await dispatch(new SendEmailJob("alice@example.com", "Welcome!"), {
    delay: 60,
});

// Dispatch to a specific connection
await dispatch(new SendEmailJob("alice@example.com", "Welcome!"), {
    connection: "redis",
});
```

### `Queue.push(job, options?)`

Same as `dispatch()` - `dispatch` is a thin alias over `Queue.push`:

```typescript
import { Queue } from "struxjs";

await Queue.push(new SendEmailJob("alice@example.com", "Welcome!"), {
    queue: "emails",
    delay: 30,
});
```

### `Queue.later(delay, job, options?)`

Syntactic sugar for dispatching a delayed job:

```typescript
// Run after 5 minutes
await Queue.later(300, new SendEmailJob("alice@example.com", "Welcome!"));
```

### Per-job queue and delay

You can set defaults directly on the job class so you don't have to pass options every time:

```typescript
export class SendEmailJob extends Job {
    public queue = "emails";  // always goes to the emails queue
    public delay = 10;        // always delayed by 10 seconds
    public tries = 5;
}

await dispatch(new SendEmailJob("alice@example.com", "Welcome!"));
```

Options passed to `dispatch()` override the job's own properties.

---

## Running the Worker

Start a worker process with `queue:work`:

```bash
npx strux queue:work
```

The worker polls the default queue in a loop, processing one job at a time.

### Worker options

```bash
npx strux queue:work \
  --queue emails \
  --connection redis \
  --tries 5 \
  --timeout 120 \
  --sleep 5 \
  --stop-when-empty
```

| Option | Default | Description |
| :--- | :--- | :--- |
| `-q, --queue` | `"default"` | Queue name to consume |
| `-c, --connection` | config default | Named connection from `config/queue.ts` |
| `--tries` | `3` | Max retry attempts per job |
| `--timeout` | `60` | Per-job execution timeout in seconds |
| `--sleep` | `3` | Seconds to wait when queue is empty before polling again |
| `--stop-when-empty` | `false` | Exit the worker when queue is empty instead of polling forever |

### Multiple queues

Run separate worker processes for different queues:

```bash
# Terminal 1 - high-priority jobs
npx strux queue:work --queue critical --tries 5

# Terminal 2 - email jobs
npx strux queue:work --queue emails --timeout 30

# Terminal 3 - low-priority background jobs
npx strux queue:work --queue default
```

### Graceful shutdown

The worker listens for `SIGTERM` and `SIGINT`. When received, it finishes processing the current job and then stops cleanly:

```bash
kill -SIGTERM <worker-pid>
```

---

## Failed Jobs

When a job exhausts all retry attempts, it is moved to the failed jobs store. The `failed()` method on the job is called before it is stored.

### List failed jobs

```bash
npx strux queue:failed

# Filter by queue
npx strux queue:failed --queue emails
```

Output:

```
[StruxJS Queue]: 2 failed job(s):

  ID:       job_17200000_abc123
  Class:    SendEmailJob
  Queue:    emails
  Attempts: 3
  Failed:   2026-07-28T10:45:00.000Z
  Error:    Connection refused
```

### Retry a failed job

```bash
# Retry a specific job by ID
npx strux queue:retry job_17200000_abc123

# Retry all failed jobs
npx strux queue:retry all
```

### Flush all failed jobs

```bash
npx strux queue:flush
```

---

## Queue Size

Check the number of pending jobs programmatically:

```typescript
import { Queue } from "struxjs";

const count = await Queue.size("emails");
const defaultCount = await Queue.size(); // defaults to "default"
```

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `npx strux make:job <name>` | Create a new Job class |
| `npx strux queue:work` | Start a worker on the default queue |
| `npx strux queue:work --queue <name>` | Start a worker on a named queue |
| `npx strux queue:failed` | List all permanently failed jobs |
| `npx strux queue:retry <id>` | Re-queue a specific failed job |
| `npx strux queue:retry all` | Re-queue all failed jobs |
| `npx strux queue:flush` | Delete all failed jobs |
| `npx strux queue:table` | Generate migrations for the database driver |
| `npx strux queue:table --jobs-table=<name>` | Custom jobs table name (default: `jobs`) |
| `npx strux queue:table --failed-table=<name>` | Custom failed jobs table name (default: `failed_jobs`) |

---

## Driver Comparison

| Driver | Persistence | Delayed jobs | Shared across servers | Best for |
| :--- | :--- | :--- | :--- | :--- |
| `sync` | No | No | No | Dev, testing |
| `file` | Yes (disk) | Yes | No | Single-server, no infrastructure |
| `database` | Yes (SQL) | Yes | Yes | Multi-server, no Redis |
| `redis` | Yes (Redis) | Yes | Yes | Production, high-throughput |

---

## Production Setup

In production you need one or more persistent worker processes running alongside your web server. Unlike the web server, queue workers are long-running Node.js processes - use a process manager to keep them alive.

### Using PM2

Install PM2 globally and create an ecosystem config:

```bash
npm install -g pm2
```

`ecosystem.config.cjs`:

```javascript
module.exports = {
    apps: [
        // Web server
        {
            name: "web",
            script: "node",
            args: "dist/bootstrap.js",
            instances: 1,
            autorestart: true,
            watch: false,
        },
        // Default queue worker
        {
            name: "worker-default",
            script: "node",
            args: "dist/cli/index.js queue:work --queue default --tries 3 --timeout 60",
            instances: 1,
            autorestart: true,
            watch: false,
        },
        // Emails queue - separate worker with shorter timeout
        {
            name: "worker-emails",
            script: "node",
            args: "dist/cli/index.js queue:work --queue emails --tries 5 --timeout 30",
            instances: 1,
            autorestart: true,
            watch: false,
        },
    ],
};
```

Start all processes:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Using systemd

Create a service file at `/etc/systemd/system/strux-worker.service`:

```ini
[Unit]
Description=StruxJS Queue Worker
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/myapp
ExecStart=node dist/cli/index.js queue:work --queue default --tries 3 --timeout 60
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable strux-worker
sudo systemctl start strux-worker
sudo systemctl status strux-worker
```

For multiple queues, create separate service files (`strux-worker-emails.service`, etc.) with different `--queue` arguments.

### Recommended driver for production

Use the `redis` driver in production. It supports delayed jobs natively, handles high throughput without locking overhead, and scales cleanly across multiple servers and workers:

```ini
QUEUE_CONNECTION=redis
```

Ensure `config/redis.ts` points to your production Redis instance via `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`.

---

## Troubleshooting

### "Container not booted - using SyncDriver as fallback"

This warning appears when the queue worker can't load the application configuration. The worker is trying to use `config/queue.ts` but the container hasn't been bootstrapped.

**Solution:** Ensure `bootstrap-cli.ts` exists and contains:

```typescript
import { Application, Queue, Cache, Mail, Job, SendMailJob, BaseModel } from "struxjs";
import { SendEmailJob } from "./app/Jobs/SendEmailJob.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = new Application(__dirname);
await app.bootstrap();

const dbConfig = app.container.make("config.database");
BaseModel.bootConnection(dbConfig);

Queue.boot(app.container);
Cache.boot(app.container);
Mail.boot(app.container);
```

The worker loads `bootstrap-cli.ts` (or `dist/bootstrap-cli.js`) instead of `bootstrap.ts` so it doesn't start the HTTP server.

### "Job class '...' is not registered"

You dispatched a job but the worker can't find its class. In the latest versions of StruxJS, Job classes inside the `app/Jobs` directory are discovered automatically. Ensure your job class is exported correctly and resides inside `app/Jobs/`. If you are dispatching a dynamically created job class, it must be available during startup.

### Worker exits immediately

If `--stop-when-empty` is not set, the worker polls forever. If it exits:

1. Check for uncaught exceptions in your `handle()` methods
2. Verify the database/Redis connection is stable
3. Run with `DEBUG=struxjs:*` to see detailed logs

### Jobs stuck in "reserved" state

This happens when a worker crashes mid-job without releasing the reservation. For the `database` driver, set `reservationTimeout` in `config/queue.ts`:

```typescript
database: {
    driver: "database",
    reservationTimeout: 90, // seconds before stuck jobs are auto-released
}
```

After 90 seconds, another worker can pick up the job.

---
