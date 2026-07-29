/**
 * bootstrap-cli.ts
 *
 * Minimal bootstrap for CLI commands (schedule:work, queue:work, etc.).
 * Loads configs and DB connection but does NOT start the HTTP server.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Application, BaseModel, Queue, Cache, Mail } from "struxjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env before anything else so env() reads the correct values
dotenv.config({ path: path.join(__dirname, ".env") });

const app = new Application(__dirname);

// Load configs (.env + config/ directory)
await app.bootstrap();

// Connect DB
const dbConfig = app.container.make("config.database");
BaseModel.bootConnection(dbConfig);

// Boot Queue (reads QUEUE_CONNECTION from config/queue.ts)
Queue.boot(app.container);

// Boot Cache (reads CACHE_DRIVER from config/cache.ts)
Cache.boot(app.container);

// Boot Mail (needed if Mail.queue() jobs are processed by this worker)
Mail.boot(app.container);
