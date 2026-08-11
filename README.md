<p align="center">
  <h1 align="center">StruxJS Framework</h1>
</p>

<p align="center">
  <strong>An elegant, production-ready enterprise Node.js framework.</strong><br>
  Built for speed with Fastify, designed for developer happiness with a Laravel-like architecture.
</p>

---

## What is StruxJS?

StruxJS is a modern, TypeScript-first web framework that combines the blazing-fast performance of **Fastify** with the elegant, developer-friendly Developer Experience (DX) of frameworks like Laravel. It provides a robust architecture out-of-the-box, allowing you to focus on building features rather than wrestling with configuration.

### Key Features

* **Blazing Fast HTTP:** Powered by Fastify under the hood for maximum throughput.
* **IoC Container:** A powerful Dependency Injection container that manages class dependencies automatically.
* **Active Record ORM:** An expressive `BaseModel` ORM inspired by Strux ORM, supporting relationships, scopes, and aggregations.
* **Concurrency Engine:** Built-in Multi-Core Cluster Engine and `ThreadPool` for heavy CPU-bound tasks without blocking the event loop.
* **Authentication & Security:** Native support for CSRF protection, Rate Limiting (Throttle), Session Management, and JWT API Authentication.
* **Background Jobs:** A robust Redis-backed Queue system with asynchronous workers.
* **Event Broadcasting:** Built-in WebSocket broadcasting for real-time applications.
* **Expressive Routing:** Clean and fluent routing API (`Route.get(...)`) with middleware and route groups.
* **Vite Integration:** Seamless frontend asset bundling with Vite (`.strux` view engine included).

---

## Requirements

- **Node.js** v18.0 or higher
- **Redis** (Optional, but highly recommended for Queue, Cache, and Session)
- **Database** (MySQL, PostgreSQL, SQLite, or MongoDB)

---

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env` and update your database/redis credentials.

3. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   *The server will start at `http://localhost:3000` (by default).*

4. **Start the Frontend Asset Bundler (Vite):**
   ```bash
   npm run dev:assets
   ```

5. **Start a Background Queue Worker (Optional):**
   ```bash
   npx strux queue:work
   ```

---

## Documentation

StruxJS provides extensive, well-organized documentation powered by VitePress. 

To view the documentation locally:
```bash
cd docs-site
npm install
npm run dev
```
Then visit `http://localhost:5173` in your browser.

---

## Directory Structure

```text
├── app/
│   ├── Controllers/    # HTTP Route Controllers
│   ├── Models/         # Active Record ORM Models
│   ├── Middleware/     # Custom HTTP Middlewares
│   ├── Jobs/           # Background Queue Jobs
│   ├── Mail/           # Mailable Classes
│   └── Providers/      # Service Providers (AppServiceProvider)
├── bootstrap.ts        # Application Entry Point
├── config/             # Configuration Files (DB, Cache, Queue, etc.)
├── database/           # Migrations & Seeders
├── docs-site/          # Official Documentation
├── public/             # Publicly accessible assets
├── resources/
│   └── views/          # .strux HTML Templates
├── routes/             # web.ts, api.ts, console.ts
└── struxjs-core/       # The Core Framework Engine
```

---

## Command Line Interface (CLI)

StruxJS includes an artisan-like CLI tool to speed up your workflow. Run `npx strux` in your terminal to see all available commands.

```bash
# Generate a new Controller
npx strux make:controller UserController

# Generate a new Model
npx strux make:model Product

# Run database migrations
npx strux migrate

# List all registered routes
npx strux route:list
```

---

## Developing the Core

If you are modifying the framework's internal core (`strux-core`), you must compile the TypeScript files so the changes can be reflected in production environments:

```bash
cd strux-core
npm run build
```

*Tip: During local development in the root application, changes to `strux-core` are live-reloaded automatically via `tsx` path mapping when you run `npm run dev`. You only need to build the core when preparing to test the built output or publishing to NPM.*

---

## License

The StruxJS framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
