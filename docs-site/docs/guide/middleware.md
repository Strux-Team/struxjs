# HTTP Middleware

HTTP Middleware classes inspect, filter, and preprocess HTTP requests entering your application before they reach Controller action methods.

---

## Creating Middleware

Use the StruxJS CLI to generate a new Middleware class in `app/Middleware/`:

```bash
npx strux make:middleware AuthMiddleware
```

Generated file (`app/Middleware/AuthMiddleware.ts`):

```typescript
import { Middleware, Request, Response } from "struxjs";

export class AuthMiddleware implements Middleware {
    public async handle(request: Request, response: Response, ...params: string[]) {
        // Perform pre-request inspection or authentication logic
    }
}
```

---

## Middleware Implementation

A Middleware class implements the `Middleware` interface and defines a `handle` method:

```typescript
import { Middleware, Request, Response } from "struxjs";

export class AuthMiddleware implements Middleware {
    public async handle(request: Request, response: Response, role?: string) {
        const token = request.header("authorization");

        if (!token) {
            return response.status(401).json({ error: "Unauthorized access" });
        }

        if (role && role !== "admin") {
            return response.status(403).json({ error: "Insufficient permissions" });
        }
    }
}
```

If the middleware passes checks, execution automatically continues to the next middleware or Controller action. If a response method (`response.json()`, `response.redirect()`, etc.) is called, request processing halts immediately.

---

## Registering String Aliases

Register custom string aliases or binding tokens in `app/Providers/AppServiceProvider.ts`:

```typescript
// app/Providers/AppServiceProvider.ts
import { Container } from "struxjs";
import { AuthMiddleware } from "../Middleware/AuthMiddleware.js";
import { CheckRoleMiddleware } from "../Middleware/CheckRoleMiddleware.js";

export class AppServiceProvider {
    public register(container: Container): void {
        // Register string aliases for Middlewares
        container.bind("auth", (c) => c.make(AuthMiddleware));
        container.bind("custom-auth", (c) => c.make(AuthMiddleware));
        container.bind("role", (c) => c.make(CheckRoleMiddleware));
    }
}
```

---

## Attaching Middleware to Routes

Attach middleware to individual routes using `.middleware()` or `.use()`:

### 1. Class Reference (Recommended)

```typescript
import { Route } from "struxjs";
import { AuthMiddleware } from "../app/Middleware/AuthMiddleware.js";
import { UserController } from "../app/Controllers/UserController.js";

Route.get("/profile", [UserController, "profile"])
    .middleware(AuthMiddleware);
```

### 2. Array of Class References

```typescript
import { AuthMiddleware } from "../app/Middleware/AuthMiddleware.js";
import { CheckRoleMiddleware } from "../app/Middleware/CheckRoleMiddleware.js";

Route.get("/admin", [UserController, "admin"])
    .middleware([AuthMiddleware, CheckRoleMiddleware]);
```

### 3. String Alias

```typescript
Route.get("/dashboard", "UserController@dashboard")
    .middleware("auth");
```

### 4. String Alias with Parameters

Pass parameters to middleware using colon syntax (`"alias:param1,param2"`):

```typescript
Route.get("/admin/settings", "AdminController@settings")
    .middleware("role:admin,superadmin");
```

---

## Selective Middleware Exclusion (`.withoutMiddleware`)

Remove auto-loaded middlewares (such as `VerifyCsrfToken` or `StartSession`) for specific endpoints:

```typescript
import { VerifyCsrfToken, StartSession } from "struxjs";

// Exclude CSRF protection by Class Reference
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

## Attaching Middleware to Route Groups

Apply middleware to a group of routes using `.middleware()` or `.use()` on `Route`:

```typescript
import { Route } from "struxjs";
import { AuthMiddleware } from "../app/Middleware/AuthMiddleware.js";

// 1. Fluent .middleware().group()
Route.middleware([AuthMiddleware]).group(() => {
    Route.get("/dashboard", [UserController, "dashboard"]);
    Route.get("/settings", [UserController, "settings"]);
});

// 2. Fluent .use().group()
Route.use(AuthMiddleware).group(() => {
    Route.get("/reports", [ReportController, "index"]);
});

// 3. Options Object Grouping
Route.group({ middleware: [AuthMiddleware], prefix: "/admin" }, () => {
    Route.get("/users", [AdminController, "users"]);
});
```

---

## Registering Global Middleware

Global middlewares execute automatically on every incoming HTTP request. Register global middlewares using static `Route.use()` before defining application routes:

```typescript
import { Route } from "struxjs";
import { AuthMiddleware } from "../app/Middleware/AuthMiddleware.js";
import { SecurityHeadersMiddleware } from "../app/Middleware/SecurityHeadersMiddleware.js";

// Global Middlewares applied to ALL HTTP requests
Route.use(SecurityHeadersMiddleware);
Route.use(AuthMiddleware);
```

---

## Dependency Injection in Middleware

Since Middleware classes are instantiated by the StruxJS IoC Container, dependencies can be injected automatically.

### 1. Constructor Injection

#### A. Direct Type Hinting
Type-hint services in the Middleware constructor:

```typescript
import { Middleware, Request, Response } from "struxjs";
import { AuthService } from "../Services/AuthService.js";

export class AuthMiddleware implements Middleware {
    constructor(private authService: AuthService) {}

    public async handle(request: Request, response: Response) {
        const token = request.header("authorization");
        const isValid = await this.authService.validateToken(token);

        if (!isValid) {
            return response.status(401).json({ error: "Invalid token" });
        }
    }
}
```

#### B. `@Inject()` Decorator in Constructor
Explicitly inject string tokens or Class types into constructor parameters using `@Inject()`:

```typescript
import { Inject, Middleware, Request, Response } from "struxjs";
import { AuthService } from "../Services/AuthService.js";

export class AuthMiddleware implements Middleware {
    constructor(
        @Inject("auth.service") private authService: AuthService
    ) {}

    public async handle(request: Request, response: Response) {
        // ...
    }
}
```

### 2. Manual Resolution (`make()`)

Resolve services manually using `make()`:

```typescript
import { make, Middleware, Request, Response } from "struxjs";
import { AuthService } from "../Services/AuthService.js";

export class AuthMiddleware implements Middleware {
    public async handle(request: Request, response: Response) {
        const authService = make(AuthService);
        // ...
    }
}
```
