# HTTP Routing

StruxJS provides an expressive routing API supporting HTTP verb registration, type-safe controller tuple bindings, middleware chaining, route groups, named route URL generation, and CLI inspection tools.

---

## Route Files

Application routes are defined inside the `routes/` directory:

* `routes/web.ts`: Stateful web application routes. Routes defined in `web.ts` are automatically wrapped with session support (`StartSession`) and CSRF protection (`VerifyCsrfToken`).
* `routes/api.ts`: Stateless REST API routes. Routes defined in `api.ts` are automatically prefixed with `/api` and do not include session or CSRF overhead by default.

---

## Basic Route Methods

StruxJS supports all standard HTTP verbs:

```typescript
import { Route } from "struxjs";

Route.get("/users", handler);
Route.post("/users", handler);
Route.put("/users/:id", handler);
Route.patch("/users/:id", handler);
Route.delete("/users/:id", handler);
Route.options("/users", handler);
Route.head("/users", handler);
```

### Matching Multiple Methods

To register a route responding to multiple HTTP verbs, use `Route.match()`:

```typescript
Route.match(["GET", "POST"], "/profile", handler);
```

To register a route responding to all standard HTTP verbs, use `Route.any()`:

```typescript
Route.any("/webhook", handler);
```

---

## Route Action Handlers

StruxJS supports three types of action handlers:

### 1. Type-Safe Tuple Array (Recommended)
Pass a tuple containing the Controller Class and the target method name as a string. This format provides IDE auto-completion, go-to-definition, and refactoring support:

```typescript
import { Route } from "struxjs";
import { UserController } from "../app/Controllers/UserController.js";

Route.get("/users", [UserController, "index"]);
```

### 2. String Action Syntax
Pass a string formatted as `'ControllerName@methodName'`:

```typescript
Route.get("/profile", "UserController@profile");
```

### 3. Closure Handlers
Pass an inline callback function receiving explicitly typed `Request` and `Response` objects imported from `struxjs`:

```typescript
import { Request, Response, Route } from "struxjs";

Route.get("/health", async (req: Request, res: Response) => {
    return { status: "ok", timestamp: Date.now() };
});
```

---

## Route Parameters

Define dynamic route parameters using colon syntax (`:param`):

```typescript
import { Request, Response, Route } from "struxjs";

Route.get("/users/:id", async (req: Request, res: Response) => {
    const userId = req.params.id;
    return { userId };
});
```

Multiple route parameters are mapped directly into `req.params`:

```typescript
import { Request, Response, Route } from "struxjs";

Route.get("/posts/:postId/comments/:commentId", async (req: Request, res: Response) => {
    const { postId, commentId } = req.params;
    return { postId, commentId };
});
```

---

## Named Routes & URL Generation

Assign names to routes using `.name()`:

```typescript
Route.get("/users/:id", [UserController, "show"]).name("users.show");
```

### Generating URLs with `route()`

Use the global `route()` helper to generate URLs by route name:

```typescript
import { route } from "struxjs";

// Generates: "/users/42"
const userUrl = route("users.show", { id: 42 });

// Generates: "/users/42?page=2&sort=asc"
const queryUrl = route("users.show", { id: 42 }, { page: 2, sort: "asc" });
```

---

## Middleware Chaining & Selective Exclusion

### Attaching Middleware

Attach middleware using `.middleware()` or `.use()`. You can pass Class references, middleware instances, or string aliases:

```typescript
import { AuthMiddleware } from "../app/Middleware/AuthMiddleware.js";

// Class Reference
Route.get("/dashboard", [UserController, "dashboard"])
    .middleware(AuthMiddleware);

// Array of Middlewares
Route.get("/admin", [AdminController, "index"])
    .middleware([AuthMiddleware, CheckRoleMiddleware]);

// String Alias
Route.get("/profile", "UserController@profile")
    .middleware("auth");
```

### Selective Middleware Exclusion (`.withoutMiddleware`)

Remove auto-loaded middlewares (such as `VerifyCsrfToken` or `StartSession`) for specific endpoints:

```typescript
import { VerifyCsrfToken, StartSession } from "struxjs";

// Exclude CSRF protection for webhooks
Route.post("/payment/webhook", [WebhookController, "handle"])
    .withoutMiddleware(VerifyCsrfToken);

// Exclude by string alias
Route.post("/api/callback", "CallbackController@handle")
    .withoutMiddleware("csrf");

// Exclude multiple middlewares
Route.get("/stateless", "ApiController@show")
    .withoutMiddleware([VerifyCsrfToken, StartSession]);
```

---

## Rate Limiting

StruxJS includes a built-in `throttle` middleware backed by the Cache engine to limit the number of requests a client can make to a given route.

To rate limit a route, apply the `throttle` middleware string with two arguments: `maxAttempts` and `decayMinutes` (separated by a comma).

```typescript
// Limit to 60 requests per 1 minute
Route.get("/api/data", "DataController@index")
    .middleware(["throttle:60,1"]);

// Limit to 5 requests per 10 minutes
Route.post("/login", "AuthController@login")
    .middleware(["throttle:5,10"]);
```

When the rate limit is exceeded, StruxJS automatically returns a `429 Too Many Requests` HTTP response and sets the `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers.

---

## Route Groups

Group related routes to share prefixes, middleware pipelines, or name prefixes.

### Grouping by Prefix

```typescript
Route.prefix("/admin").group(() => {
    Route.get("/users", [AdminController, "users"]); // /admin/users
    Route.get("/settings", [AdminController, "settings"]); // /admin/settings
});
```

### Grouping by Middleware

```typescript
Route.middleware([AuthMiddleware]).group(() => {
    Route.get("/dashboard", [UserController, "dashboard"]);
    Route.get("/profile", [UserController, "profile"]);
});
```

### Grouping by Name Prefix

```typescript
Route.as("admin.").group(() => {
    Route.get("/dashboard", [AdminController, "index"]).name("dashboard"); // Name: admin.dashboard
});
```

### Combining Group Options

Pass an options object to `Route.group()`:

```typescript
Route.group(
    {
        prefix: "/admin",
        middleware: [AuthMiddleware],
        as: "admin.",
        withoutMiddleware: [VerifyCsrfToken]
    },
    () => {
        Route.get("/users", [AdminController, "users"]).name("users"); // URL: /admin/users, Name: admin.users
    }
);
```

---

## Related CLI Commands

StruxJS provides CLI Artisan commands for managing controllers and inspecting application routes.

### List All Registered Routes (`route:list`)

Display a structured table listing all registered HTTP routes, methods, URIs, names, action handlers, and applied middlewares:

```bash
npx strux route:list
```

Or via bootstrap script:

```bash
node bootstrap-cli.js route:list
```

### Generate a Controller (`make:controller`)

Generate a new Controller class scaffold:

```bash
npx strux make:controller UserController
```

Generate a resource Controller containing standard CRUD action methods:

```bash
npx strux make:controller UserController --resource
```
