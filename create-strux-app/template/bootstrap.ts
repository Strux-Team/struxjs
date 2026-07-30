import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Application, HttpServiceProvider, WebSocketServiceProvider, Router, Route, BaseModel, Cache, Queue, Mail } from "struxjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (one level up from dist/ when running compiled)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config({ path: path.resolve(__dirname, ".env") }); // fallback for tsx dev mode

// 1. Initialize application
const app = new Application(__dirname);

// 2. Register core HTTP networking plugin driver
app.registerProviders([
    // WebSocket server — listens on /ws
    // Must be registered BEFORE HttpServiceProvider to add /ws route before fastify.listen()
    WebSocketServiceProvider,
    HttpServiceProvider,
]);

// 3. BOOT THE CORE KERNEL: Everything (Configs, Controllers, Providers & Requests) is auto-scanned & bound!
await app.bootstrap();

// 4. Connect Active Record ORM database engine
const dbConfig = app.container.make("config.database");
BaseModel.bootConnection(dbConfig);

// 5. Boot Cache system (reads CACHE_DRIVER from config/cache.ts)
Cache.boot(app.container);
// Pre-resolve async drivers (redis, database) so Cache.get/put work synchronously after this
await Cache.resolveStore();

// 6. Boot Queue system (reads QUEUE_CONNECTION from config/queue.ts)
Queue.boot(app.container);

// 7. Boot Mail system (reads MAIL_MAILER from config/mail.ts)
Mail.boot(app.container);

// 9. Connect the core Router to the Static Route Facade
const router = app.container.make<Router>("router");
Route.setRouter(router);

// 10. Automatically scan and load web.ts and api.ts (auto-prefixed with /api)
await Route.loadRoutes(__dirname);

// GO LIVE!
await app.start();
