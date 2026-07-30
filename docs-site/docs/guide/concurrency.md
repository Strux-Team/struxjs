# Node.js Power & Concurrency

StruxJS is explicitly designed to harness the full power of Node.js: its non-blocking I/O event loop, Worker Threads for CPU-bound tasks, and multi-core Cluster Engine.

---

## 1. Multi-Core Cluster Engine

Node.js runs on a single CPU core by default. To utilize all available cores (e.g. 8 cores or 16 cores on a production server), StruxJS provides a built-in `ClusterManager`.

The Cluster Manager automatically forks HTTP workers to run concurrently across all CPU threads and manages **Graceful Shutdown** when the server stops, ensuring no requests are dropped.

### Usage

Modify your production entry point (usually `server.ts` or `bootstrap.ts`):

```typescript
import { Application, ClusterManager } from "struxjs";

const app = new Application(__dirname);
await app.bootstrap();

// Run on all CPU cores instead of a single core
if (ClusterManager.isMaster()) {
    ClusterManager.fork();
} else {
    await app.start();
}
```

---

## 2. Worker Threads (`ThreadPool`)

While Node.js excels at I/O (Database, Network), its main Event Loop blocks when executing heavy CPU-bound operations like:
* Image resizing and manipulation
* Generating large PDF files
* Encrypting/hashing large amounts of data
* Heavy mathematical calculations

To keep the main HTTP server responsive (latency < 5ms) while performing heavy tasks, StruxJS provides a `ThreadPool` engine based on Node's `worker_threads`.

### Usage

**1. Create a worker file (e.g., `workers/image-processor.ts`):**

```typescript
// workers/image-processor.ts
import { parentPort, workerData } from "worker_threads";
import sharp from "sharp";

async function processImage() {
    const { imagePath, width, height } = workerData;
    const buffer = await sharp(imagePath).resize(width, height).toBuffer();
    parentPort?.postMessage(buffer);
}

processImage();
```

**2. Dispatch the work to the ThreadPool from your controller:**

```typescript
import { ThreadPool } from "struxjs";

export class ImageController {
    public async resize(request, response) {
        // This offloads the CPU work to a separate Thread.
        // The main Event Loop continues processing other HTTP requests!
        const resultBuffer = await ThreadPool.run("./workers/image-processor.ts", {
            imagePath: request.file("avatar").path,
            width: 500,
            height: 500
        });

        return response.type("image/jpeg").send(resultBuffer);
    }
}
```

---

## 3. Route Caching & ETag

To maximize speed and minimize database load, StruxJS provides the `RouteCacheMiddleware`.

When attached to a route, this middleware:
1. Automatically computes an `ETag` hash of the HTTP response.
2. Caches the response in memory for the specified duration (e.g. 60 seconds).
3. If the client sends an `If-None-Match` header matching the `ETag`, StruxJS returns a fast `304 Not Modified` without transmitting the body payload, saving massive amounts of bandwidth.

### Usage

Attach the `routeCache` middleware to your routes in `routes/web.ts` or `routes/api.ts`:

```typescript
import { Route } from "struxjs";

// Cache the response for 60 seconds
Route.get("/leaderboard", "LeaderboardController@index").middleware(["routeCache:60"]);
```
