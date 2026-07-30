# What is StruxJS?

StruxJS is an enterprise backend framework for Node.js, written in 100% TypeScript.

StruxJS combines the developer experience and expressive syntax of Laravel with the high performance of the Fastify HTTP engine, empowering developers to build scalable TypeScript backends with high throughput and low latency.

---

## Design Philosophy

In the current Node.js ecosystem, building backend applications often requires assembling separate npm packages (ORMs, validation libraries, caching layers, queue workers, session handlers, mailers). This lack of standardization leads to fragmented codebases and increased initial configuration overhead.

StruxJS addresses this by adopting a batteries-included architecture:

1. **Performance First**: Built on Fastify core instead of Express to achieve maximum request-per-second throughput and low latency.
2. **End-to-End Type Safety**: Native TypeScript implementation providing static type checking across routes, controllers, containers, and models.
3. **Expressive API**: Clean, intuitive syntax for routing, dependency injection, and middleware configuration.
4. **Enterprise Architecture**: Built-in IoC container, dependency injection, middleware pipeline, event dispatcher, and service providers.

---

## Architectural Highlights

### 1. Fastify Core Engine
StruxJS uses Fastify as its underlying HTTP engine. All route registration and request dispatching leverage Fastify's internal routing tree, optimizing memory allocation and execution speed.

### 2. Two-Layer Dependency Injection
StruxJS implements an IoC container combining `reflect-metadata` with method signature parsing. This dual approach enables dependency injection into controller action methods even after TypeScript type annotations are stripped during compilation:

```typescript
export class UserController {
    // Constructor Injection
    constructor(private userService: UserService) {}

    // Method Action Injection
    public async store(request: RegisterRequest, response: Response) {
        const user = await this.userService.createUser(request.validated());
        return response.json(user);
    }
}
```

### 3. AsyncLocalStorage HttpContext
Using Node.js `AsyncLocalStorage` (`httpContextStorage`), global helper functions such as `auth()`, `session()`, `request()`, `response()`, `config()`, `cache()`, and `old()` resolve context scoped to the active HTTP request without requiring explicit parameter passing down the invocation stack:

```typescript
const user = auth().user();
const userLang = session().get('locale');
```

### 4. Type-Safe Routing and Middleware
Routes support string action targets as well as type-safe tuple arrays `[Controller, 'method']`, enabling full IDE auto-completion, refactoring, and navigation. Middlewares can be applied globally, to route groups, or chained per route, with support for selective exclusion (`.withoutMiddleware()`):

```typescript
Route.get('/users', [UserController, 'index']).name('users.index');

Route.middleware([AuthMiddleware])
    .withoutMiddleware(VerifyCsrfToken)
    .group(() => {
        Route.get('/dashboard', [AdminController, 'dashboard']);
    });
```

### 5. Built-in Modules

StruxJS includes built-in modules for common backend requirements:

* **Database & Query Builder**: SQL (SQLite, MySQL, PostgreSQL) and MongoDB support with transactions, migrations, and seeders.
* **Cache System**: Drivers for `file`, `memory`, and `redis` with tagging and key prefixing.
* **Queue System**: File and Redis queue drivers with background worker daemons.
* **Task Scheduler**: Cron-based background job scheduling.
* **Security & Session**: CSRF protection (`VerifyCsrfToken`), AES-256-GCM encryption, and encrypted session storage.
* **Template Engine**: Native `.strux` view engine with layout inheritance, component rendering, and escaping.
* **Localization**: Multi-language translation management.
* **Broadcasting**: Real-time event broadcasting over WebSockets and Server-Sent Events (SSE).
* **Mail & Logging**: SMTP mail transport and daily rotating log drivers.

---

## Technical Comparison

| Feature | StruxJS | Express.js | NestJS | Laravel (PHP) |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP Engine** | Fastify | Express | Fastify / Express | Swoole / FPM |
| **Language** | TypeScript Native | JS / TS | TypeScript | PHP |
| **Ecosystem** | Integrated | External packages | Integrated | Integrated |
| **Routing & Controllers** | Expressive & Type-Safe | Router Callbacks | Decorators / Modules | Expressive |
