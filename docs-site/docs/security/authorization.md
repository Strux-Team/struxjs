# Authorization

StruxJS provides a `Gate` system for defining and evaluating authorization rules. It supports simple ability-based gates, policy classes, role-based access control (RBAC), and middleware for protecting routes.

---

## The Gate Facade

Import `Gate` from `struxjs` and define your abilities in `AppServiceProvider`. This is the recommended place to centralize all authorization setup - gate definitions, policies, and hooks:

```typescript
// app/Providers/AppServiceProvider.ts
import { Container, Gate } from "struxjs";
import { Post } from "../Models/Post.js";

export class AppServiceProvider {
    public register(container: Container): void {
        Gate.define("edit-post", (user, post: Post) => {
            return user.id === post.user_id;
        });

        Gate.define("delete-post", async (user, post: Post) => {
            return user.id === post.user_id || user.role === "admin";
        });
    }
}
```

---

## Checking Abilities

### In controllers and services

```typescript
import { Gate, Auth } from "struxjs";

export class PostController {
    public async edit(request: Request, response: Response) {
        const post = await Post.findOrFail(request.params.id);

        // Returns true or false
        if (await Gate.denies("edit-post", post)) {
            return response.status(403).json({ message: "Forbidden." });
        }

        return response.json({ post });
    }
}
```

### `Gate.allows(ability, ...args)`

Returns `true` if the currently authenticated user passes the check:

```typescript
const canEdit = await Gate.allows("edit-post", post);
```

### `Gate.denies(ability, ...args)`

Inverse of `allows`:

```typescript
const cannot = await Gate.denies("edit-post", post);
```

### `Gate.authorize(ability, ...args)`

Throws an `AuthorizationError` (HTTP 403) if denied - useful for concise controller code:

```typescript
await Gate.authorize("edit-post", post);
// If denied, throws AuthorizationError and stops execution
```

Catch it or let the global error handler return a 403 automatically.

### Checking for a specific user

Use `Gate.forUser(user)` to evaluate an ability against an explicit user instead of the current session user:

```typescript
const evaluator = Gate.forUser(targetUser);

if (await evaluator.allows("edit-post", post)) { ... }
await evaluator.authorize("delete-post", post);
```

---

## Policies

For models with multiple abilities, group all authorization logic into a Policy class:

```typescript
// app/Policies/PostPolicy.ts
export class PostPolicy {
    public viewAny(user: User): boolean {
        return true; // anyone authenticated can list posts
    }

    public view(user: User, post: Post): boolean {
        return true;
    }

    public create(user: User): boolean {
        return user.role === "editor" || user.role === "admin";
    }

    public update(user: User, post: Post): boolean {
        return user.id === post.user_id || user.role === "admin";
    }

    public delete(user: User, post: Post): boolean {
        return user.id === post.user_id || user.role === "admin";
    }
}
```

Register the policy against its model. Do this in `AppServiceProvider` alongside your other Gate definitions:

```typescript
// app/Providers/AppServiceProvider.ts
import { Container, Gate } from "struxjs";
import { Post } from "../Models/Post.js";
import { PostPolicy } from "../Policies/PostPolicy.js";

export class AppServiceProvider {
    public register(container: Container): void {
        // Register policies
        Gate.policy(Post, PostPolicy);

        // Register explicit gate abilities
        Gate.define("create-post", (user) => {
            return user.role === "editor" || user.role === "admin";
        });

        // Super-admin bypass
        Gate.before((user) => {
            if (user?.role === "super-admin") return true;
        });
    }
}
```

When `Gate.allows("update", post)` is called and `post` is a `Post` instance, StruxJS automatically routes to `PostPolicy.update()`. Ability names are converted to camelCase: `"edit-post"` → `editPost`, `"view-any"` → `viewAny`.

---

## Before and After Hooks

### `Gate.before()`

Runs before all other checks. Returning a boolean short-circuits evaluation - useful for super-admin bypass:

```typescript
Gate.before((user, ability) => {
    if (user?.role === "super-admin") return true; // super-admin can do anything
    // return undefined to continue normal evaluation
});
```

### `Gate.after()`

Runs after evaluation. Can override the final result:

```typescript
Gate.after((user, ability, result) => {
    // Log all authorization decisions
    console.log(`[Auth] ${user?.email} | ${ability} | ${result ? "ALLOWED" : "DENIED"}`);
    // return undefined to keep original result
});
```

---

## Role-Based Access Control

StruxJS reads roles from the `user.roles` array and permissions from `user.permissions` array on your user model. No special database structure is required - store them however fits your schema.

### `HasRoles` utility

```typescript
import { HasRoles } from "struxjs";

const user = await User.find(1);

// Check roles
HasRoles.hasRole(user, "admin");               // true/false
HasRoles.hasAnyRole(user, ["admin", "editor"]); // true if has at least one
HasRoles.hasAllRoles(user, ["editor", "user"]); // true if has all

// Check permissions
HasRoles.hasPermissionTo(user, "publish-post");
// Note: users with "admin" or "super-admin" role pass all permission checks

// Assign / remove roles (in-memory only - save to DB separately)
HasRoles.assignRole(user, "editor");
HasRoles.removeRole(user, "editor");

// Grant / revoke permissions
HasRoles.givePermissionTo(user, "publish-post", "delete-post");
HasRoles.revokePermissionTo(user, "delete-post");
```

### Gate fallback

When no explicit gate ability or policy method matches, `Gate.allows()` automatically falls back to `HasRoles` checks: it returns `true` if the user has the ability name as a direct permission **or** as a role:

```typescript
// No Gate.define("admin") needed - returns true if user.roles includes "admin"
const isAdmin = await Gate.allows("admin");
```

---

## Route Middleware

### `CanMiddleware` - ability check

Protect a route by requiring a Gate ability. Import it directly from `struxjs`:

```typescript
import { Route } from "struxjs";
import { CanMiddleware } from "struxjs";

// Using class reference directly
Route.post("/posts/:id/publish", [PostController, "publish"])
    .middleware(CanMiddleware);
```

To use the string alias format `"can:ability"`, register it first in `AppServiceProvider`:

```typescript
container.bind("can", (c) => c.make(CanMiddleware));
```

Then:

```typescript
Route.post("/posts/:id/publish", [PostController, "publish"])
    .middleware("can:publish-post");
```

### `RoleMiddleware` - role check

Restrict a route to users with a specific role:

```typescript
import { RoleMiddleware } from "struxjs";

// Single role
Route.get("/admin", [AdminController, "index"])
    .middleware("role:admin");

// Multiple roles (any match)
Route.get("/dashboard", [DashboardController, "index"])
    .middleware("role:admin,editor");
```

Register `RoleMiddleware` in `AppServiceProvider` to use string aliases:

```typescript
import { CanMiddleware, RoleMiddleware } from "struxjs";

export class AppServiceProvider {
    public register(container: Container): void {
        container.bind("can",  (c) => c.make(CanMiddleware));
        container.bind("role", (c) => c.make(RoleMiddleware));
    }
}
```

`CanMiddleware` and `RoleMiddleware` are imported from `struxjs` - they are not placed in `app/Middleware/`, so they are not auto-discovered. You must register them manually as shown above before using the string alias format.

---

## Template Directives

In `.strux` view templates, use `@can` and `@role` to conditionally show UI elements. These checks are based on the `user` variable available in the template context.

### `@can` / `@endcan`

Shows content if the user has the given permission or is an admin/superadmin. Checks both `user.role` (string) and `user.roles` (array), as well as `user.permissions`:

```html
@can('publish-post')
    <button>Publish</button>
@endcan
```

The check passes if any of these are true:
- `user.role === 'admin'` or `user.role === 'superadmin'`
- `user.roles` includes `'admin'`, `'superadmin'`, or the ability name itself
- `user.permissions` includes the ability name

### `@role` / `@endrole`

Shows content if the user has the specified role. Checks both `user.role` (string) and `user.roles` (array):

```html
@role('admin')
    <a href="/admin">Admin Panel</a>
@endrole
```

---

## `AuthorizationError`

`Gate.authorize()` and `UserGateEvaluator.authorize()` throw an `AuthorizationError` on denial. It carries a `403` status code and can be caught like any other error:

```typescript
import { AuthorizationError } from "struxjs";

try {
    await Gate.authorize("delete-post", post);
} catch (error) {
    if (error instanceof AuthorizationError) {
        return response.status(403).json({ message: error.message });
    }
    throw error;
}
```

---

## Summary

| Tool | Purpose |
| :--- | :--- |
| `Gate.define(ability, callback)` | Define a named authorization rule |
| `Gate.policy(Model, PolicyClass)` | Register a policy class for a model |
| `Gate.allows(ability, ...args)` | Check - returns `true`/`false` |
| `Gate.denies(ability, ...args)` | Inverse check |
| `Gate.authorize(ability, ...args)` | Check and throw 403 on failure |
| `Gate.forUser(user)` | Evaluate for a specific user |
| `Gate.before(callback)` | Short-circuit hook (super-admin bypass) |
| `Gate.after(callback)` | Post-evaluation hook |
| `HasRoles.hasRole(user, role)` | Check a single role |
| `HasRoles.hasAnyRole(user, roles)` | Check multiple roles (any) |
| `HasRoles.hasPermissionTo(user, perm)` | Check a permission |
| `CanMiddleware` | Route middleware - ability check |
| `RoleMiddleware` | Route middleware - role check |
| `@can` / `@role` | Template directives |
