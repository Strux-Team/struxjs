# Controllers & Dependency Injection

Controllers group related HTTP request handling logic into single ES6 classes. StruxJS manages Controllers via its built-in IoC Container, providing automatic dependency injection into constructors, action methods, and class properties.

---

## Creating Controllers

Use the StruxJS CLI to generate Controllers.

### Basic Controller

Generate a basic Controller scaffold in `app/Controllers/`:

```bash
npx strux make:controller UserController
```

Generated file (`app/Controllers/UserController.ts`):

```typescript
import { Request, Response } from "struxjs";

export class UserController {
    public async index(request: Request, response: Response) {
        return response.json({
            message: "Hello from UserController!"
        });
    }
}
```

### Resource Controller (`--resource`)

Generate a Resource Controller containing standard CRUD action methods:

```bash
npx strux make:controller UserController --resource
```

This generates `index`, `create`, `store`, `show`, `edit`, `update`, and `destroy` method stubs.

---

## Binding Controllers to Routes

Bind Controller action methods to HTTP routes using Tuple Array or String Action syntax:

### 1. Type-Safe Tuple Array (Recommended)

```typescript
import { Route } from "struxjs";
import { UserController } from "../app/Controllers/UserController.js";

Route.get("/users", [UserController, "index"]).name("users.index");
Route.post("/users", [UserController, "store"]).name("users.store");
Route.get("/users/:id", [UserController, "show"]).name("users.show");
```

### 2. String Action Syntax

```typescript
Route.get("/profile", "UserController@profile").name("profile");
```

---

## Custom String Token Bindings

In addition to Class types, services and dependencies can be bound to custom String tokens inside `app/Providers/AppServiceProvider.ts`:

```typescript
// app/Providers/AppServiceProvider.ts
import { Container } from "struxjs";
import { PostService } from "../Services/PostService.js";
import { AuthMiddleware } from "../Middleware/AuthMiddleware.js";

export class AppServiceProvider {
    public register(container: Container): void {
        // Register custom string token bindings
        container.singleton("post.service", (c) => c.make(PostService));
        container.bind("custom-auth", (c) => c.make(AuthMiddleware));
    }
}
```

---

## Dependency Injection

StruxJS supports multiple dependency injection strategies.

### 1. Constructor Injection

#### A. Direct Type Hinting
Inject services directly by type-hinting them in the Controller constructor:

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

#### B. String Token Injection via `@Inject()`
Inject custom string tokens using the `@Inject("token_name")` decorator:

```typescript
import { Inject } from "struxjs";
import { PostService } from "../Services/PostService.js";

export class UserController {
    constructor(
        @Inject("post.service") private postService: PostService
    ) {}
}
```

### 2. Method Action Injection

StruxJS resolves action parameters automatically. You can inject `Request`, `Response`, `FormRequest` validation classes, application Services, or **Route Parameters matching by parameter name**:

#### A. Injecting Request, Response & Services

```typescript
import { Request, Response } from "struxjs";
import { RegisterRequest } from "../Requests/RegisterRequest.js";
import { UserService } from "../Services/UserService.js";

// 1. Inline Validation via request.validate()
export class UserController {
    public async store(
        request: Request,
        response: Response,
        userService: UserService
    ) {
        const validatedData = await request.validate({
            email: "required|email",
            name: "required|min:2"
        });
        const user = await userService.create(validatedData);
        return response.json(user);
    }
}

// 2. FormRequest Class Validation via camelCase Parameter Name
export class UserController {
    public async store(
        registerRequest: RegisterRequest,
        response: Response,
        userService: UserService
    ) {
        const validatedData = registerRequest.validated(); // Or registerRequest.all()
        const user = await userService.create(validatedData);
        return response.json(user);
    }
}
```

::: info FormRequest Parameter Naming Convention (camelCase Rule)
When injecting custom `FormRequest` classes (such as `RegisterRequest` or `LoginRequest`), name the action parameter in **camelCase matching the Class name** (e.g., `registerRequest: RegisterRequest` or `loginRequest: LoginRequest`).

Generic parameter names like `request: Request` or `req: Request` are reserved for resolving the standard HTTP `Request` object.
:::

#### B. Direct Route Parameter Injection
StruxJS automatically matches route parameter names (`:id`, `:postId`, `:commentId`) to method parameter names:

```typescript
// Route: Route.get("/users/:id", [UserController, "show"])
export class UserController {
    public async show(id: string) {
        return { userId: id };
    }
}
```

```typescript
// Route: Route.get("/posts/:postId/comments/:commentId", [CommentController, "show"])
export class CommentController {
    public async show(postId: string, commentId: string) {
        return { postId, commentId };
    }
}
```

#### C. Combined Method Injection
Combine `Request`, `Response`, Services, and Route Parameters in any order:

```typescript
// Route: Route.get("/users/:id", [UserController, "show"])
export class UserController {
    public async show(
        request: Request,
        response: Response,
        id: string,
        userService: UserService
    ) {
        const user = await userService.find(id);
        return response.json(user);
    }
}
```

### 3. Manual Resolution (`make()`)

Resolve dependencies manually using the `make()` helper by passing a **Class Constructor directly** or a **String Token**:

```typescript
import { make } from "struxjs";
import { UserService } from "../Services/UserService.js";
import { PostService } from "../Services/PostService.js";

export class UserController {
    public async index() {
        // 1. Passing Class Constructor directly
        const userService = make(UserService);

        // 2. Passing custom String Token
        const postService = make<PostService>("post.service");

        return await userService.getAll();
    }
}
```

---

## Action Return Types

Controller action methods support various return types:

### 1. String
Returning a string sends a `text/plain` or `text/html` response:

```typescript
public async index() {
    return "Hello World";
}
```

### 2. Array / Object (JSON)
Returning an Object or Array automatically serializes the data to JSON with an `application/json` header:

```typescript
public async index() {
    return {
        success: true,
        data: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" }
        ]
    };
}
```

### 3. Server-Rendered View (`response.view`)
Render HTML templates (`.strux`) from `resources/views/`:

```typescript
public async index(request: Request, response: Response) {
    const users = await this.userService.getAll();
    return response.view("users.index", { users });
}
```

### 4. HTTP Redirects (`response.redirect`)

#### Direct Redirect
```typescript
public async store(request: Request, response: Response) {
    return response.redirect("/login");
}
```

#### Named Route Redirect
```typescript
public async store(request: Request, response: Response) {
    return response.redirect().route("users.show", { id: 42 });
}
```

#### Back Redirect
```typescript
public async store(request: Request, response: Response) {
    return response.redirect().back();
}
```

#### Redirect with Input & Flash Session
```typescript
public async store(request: Request, response: Response) {
    return response.redirect()
        .route("users.create")
        .withInput()
        .with("error", "Email address already registered.");
}
```
