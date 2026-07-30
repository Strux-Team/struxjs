# Service Container & IoC

The StruxJS Service Container is the central dependency injection engine that manages class instantiation, binding, and resolution throughout the application lifecycle. It powers automatic constructor injection in Controllers, Middleware, and Services - so you never have to manually wire dependencies together.

---

## How It Works

When StruxJS boots, it automatically scans your `app/` directory and registers discovered classes into the container. From that point on, any class resolved through the container has its constructor dependencies inspected and injected recursively.

The container supports two resolution strategies:

- **Reflection metadata** - TypeScript emits `design:paramtypes` at compile time, which the container reads to identify constructor parameter types and resolve them automatically.
- **Parameter name fallback** - When TypeScript erases type metadata (common in async ES module loading), the container parses the constructor string via regex, extracts parameter names, and matches them against registered bindings by name.

---

## Auto-Registration

On bootstrap, StruxJS automatically scans four directories and registers their classes into the container - no manual registration required.

| Directory | Convention | Binding type |
| :--- | :--- | :--- |
| `app/Services/` | Class name ends with `Service` | Singleton |
| `app/Controllers/` | Class name ends with `Controller` | Transient (new instance per request) |
| `app/Middleware/` | Class name ends with `Middleware` | Transient |
| `app/Requests/` | Class extends `FormRequest` | Singleton |

Any class following these naming conventions is automatically available for injection without any additional setup.

---

## Manual Bindings

For classes outside the auto-scanned directories, third-party SDKs, or custom string tokens, register bindings manually inside `app/Providers/AppServiceProvider.ts`.

### `container.bind(key, callback)`

Registers a **transient** binding. A fresh instance is created every time the key is resolved:

```typescript
import { Container } from "struxjs";
import { AuthMiddleware } from "../Middleware/AuthMiddleware.js";

export class AppServiceProvider {
    public register(container: Container): void {
        container.bind("auth", (c) => c.make(AuthMiddleware));
    }
}
```

### `container.singleton(key, callback)`

Registers a **singleton** binding. The instance is created once and reused for the entire application lifecycle:

```typescript
import { Container } from "struxjs";
import { PostService } from "../Services/PostService.js";

export class AppServiceProvider {
    public register(container: Container): void {
        container.singleton("post.service", (c) => c.make(PostService));
    }
}
```

### Registering third-party SDKs

Use `singleton` to wrap third-party clients so they are initialized once and shared:

```typescript
import Stripe from "stripe";
import Redis from "ioredis";

export class AppServiceProvider {
    public register(container: Container): void {
        container.singleton("stripe", () => new Stripe(process.env.STRIPE_SECRET!));
        container.singleton("redis", () => new Redis(process.env.REDIS_URL!));
    }
}
```

### Binding keys

A binding key can be a **string**, a **Symbol**, or a **Class constructor**:

```typescript
// String token
container.singleton("mailer", (c) => new Mailer());

// Symbol token
const MAILER = Symbol("Mailer");
container.singleton(MAILER, (c) => new Mailer());

// Class constructor (auto-resolved - rarely needed manually)
container.singleton(MailService, (c) => c.resolve(MailService));
```

---

## Resolving from the Container

### `container.make(key)`

Resolves a binding by class constructor or string/symbol token. If a class constructor is passed and it has not been explicitly registered, it is automatically registered as a singleton on first resolution.

Both forms work:

```typescript
import { UserService } from "../Services/UserService.js";

// 1. Class constructor - resolves (and auto-registers) the class as a singleton
const userService = container.make(UserService);

// 2. String token - resolves a manually registered binding by its key
const mailer = container.make<Mailer>("mailer");
```

### Global `make()` helper

Outside of a class context, use the `make()` helper imported from `struxjs`. It resolves from the global container instance and supports the same two forms:

```typescript
import { make } from "struxjs";
import { UserService } from "../Services/UserService.js";

// 1. Class constructor
const userService = make(UserService);

// 2. String token
const stripe = make<Stripe>("stripe");
```

### `container.has(key)`

Checks whether a key is registered in the container:

```typescript
if (container.has("stripe")) {
    const stripe = container.make<Stripe>("stripe");
}
```

---

## Constructor Injection

The most common injection pattern. Type-hint your dependencies in the constructor and StruxJS resolves them automatically. This works in Controllers, Middleware, Services, and any class resolved through the container.

```typescript
import { UserService } from "../Services/UserService.js";
import { PostService } from "../Services/PostService.js";

export class UserController {
    constructor(
        private userService: UserService,
        private postService: PostService
    ) {}

    public async index() {
        return await this.userService.getAll();
    }
}
```

The container inspects the constructor's parameter types at runtime, resolves each dependency recursively, and passes them in automatically. Dependencies of dependencies are resolved the same way.

### Injecting string tokens with `@Inject()`

When a constructor parameter is bound to a string token rather than a class, use the `@Inject("token")` decorator to tell the container which binding to resolve:

```typescript
import { Inject } from "struxjs";
import { PostService } from "../Services/PostService.js";
import Stripe from "stripe";

export class PaymentController {
    constructor(
        private postService: PostService,
        @Inject("stripe") private stripe: Stripe
    ) {}
}
```

`@Inject()` also accepts a **class constructor** directly. This is useful when TypeScript's type metadata is unreliable and you want to be explicit about which class should be injected:

```typescript
import { Inject } from "struxjs";
import { UserService } from "../Services/UserService.js";
import { PostService } from "../Services/PostService.js";

export class UserController {
    constructor(
        @Inject(UserService) private userService: UserService,
        @Inject(PostService) private postService: PostService
    ) {}
}
```

Parameters without `@Inject()` are resolved by reflected type automatically. You only need `@Inject()` when passing a string/symbol token, or when you want to be explicit about the class.

---

## Service Providers

Service Providers are the recommended place to organize manual bindings, SDK initialization, and boot-time setup. Any class inside `app/Providers/` is automatically scanned and executed.

A provider class can implement two lifecycle hooks:

### `register(container)`

Called during the binding phase. Use this method exclusively to register bindings into the container. Do not perform any logic that depends on other bindings being already resolved - just register.

```typescript
import { Container } from "struxjs";
import { PostService } from "../Services/PostService.js";

export class AppServiceProvider {
    public register(container: Container): void {
        container.singleton("post.service", (c) => c.make(PostService));
        container.singleton("stripe", () => new Stripe(process.env.STRIPE_SECRET!));
    }
}
```

### `boot(container)`

Called after all providers have been registered and all bindings are in place. Use this method for initialization logic that depends on resolved services - attaching listeners, configuring facades, running startup checks, etc.

```typescript
export class AppServiceProvider {
    public async boot(container: Container): Promise<void> {
        const postService = container.make(PostService);
        await postService.warmCache();
    }
}
```

### Full provider example

```typescript
import { Container } from "struxjs";
import { PostService } from "../Services/PostService.js";
import { AuthMiddleware } from "../Middleware/AuthMiddleware.js";
import Stripe from "stripe";

export class AppServiceProvider {
    public register(container: Container): void {
        // String token aliases for middleware
        container.bind("auth", (c) => c.make(AuthMiddleware));

        // String token alias pointing to a Service
        container.singleton("post.service", (c) => c.make(PostService));

        // Third-party SDK singleton
        container.singleton("stripe", () => new Stripe(process.env.STRIPE_SECRET!));
    }

    public async boot(container: Container): Promise<void> {
        // Run logic that depends on other services being registered
        const postService = container.make(PostService);
        await postService.warmCache();
    }
}
```

---

## Binding vs. Singleton

| Method | Instance per resolve | Use case |
| :--- | :--- | :--- |
| `container.bind()` | New instance every time | Middleware, stateless request handlers |
| `container.singleton()` | Single shared instance | Services, SDK clients, database connections |

Controllers are registered with `bind` so each request gets a fresh instance. Services are registered with `singleton` so state (e.g. cached results) is shared.

---

## Resolution Order

When resolving a constructor parameter, the container applies the following rules in order:

1. If the parameter has `@Inject("token")` - resolve that exact token.
2. If TypeScript emitted a valid class type via `design:paramtypes` - resolve by class.
3. If metadata is unavailable - parse the constructor string, extract the parameter name, and search registered bindings by name match (e.g. parameter `userService` matches a binding named `UserService` or `userService`).
4. If no match is found - throw an `[StruxJS IoC Error]` with the parameter name and class context.

This layered fallback means most classes work out of the box without any decorator, and `@Inject` is only needed when a parameter is bound to a string or symbol token rather than a class.
