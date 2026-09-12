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

### `Gate.forUser(user)` - Checking for a specific user

By default, `Gate.allows()`, `Gate.denies()`, and `Gate.authorize()` automatically inspect the currently authenticated user in the active request context.

If you need to evaluate an ability for an **explicit user instance** (for example: in Queue Jobs, CLI commands, or when an admin checks permissions on behalf of another user), use `Gate.forUser(user)`:

```typescript
import { Gate } from "struxjs";

const user = await User.find(userId);
const evaluator = Gate.forUser(user);

// 1. Evaluate with allows() -> returns boolean
if (await evaluator.allows("edit-post", post)) {
    console.log("User is permitted to edit this post.");
}

// 2. Evaluate with denies() -> returns boolean
if (await evaluator.denies("delete-post", post)) {
    console.log("User cannot delete this post.");
}

// 3. Evaluate with authorize() -> throws AuthorizationError on denial
await evaluator.authorize("publish-post", post);
```

#### Common Use Cases for `Gate.forUser(user)`

* **Queue Jobs & Background Workers:** Background workers run outside of an HTTP request lifecycle (no cookies or headers). Pass the job's target user to `Gate.forUser()`:
  ```typescript
  export class ProcessSubscriptionJob implements Job {
      public async handle() {
          const user = await User.find(this.userId);
          if (await Gate.forUser(user).allows("access-premium-features")) {
              // process premium features
          }
      }
  }
  ```
* **Console Commands & Cron Tasks:** When executing CLI commands or scheduled tasks on behalf of specific user accounts.
* **Administrative Impersonation & Delegation:** When checking whether a team member, collaborator, or sub-account has permission to access a resource.

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

StruxJS does **not** force a rigid database schema for roles and permissions. Instead, `HasRoles` flexibly extracts roles and permissions from your User model regardless of how your database is designed.

### Database Schema Options

You can implement RBAC using any of the following 3 common database designs:

#### Option 1: Single Role Column (Simplest & Most Common)

For applications where each user only possesses one primary role (e.g., `admin`, `editor`, `user`):

```typescript
// database/migrations/xxxx_create_users_table.ts
await Schema.create("users", (table) => {
    table.increments("id").primary();
    table.string("name");
    table.string("email").unique();
    table.string("password");
    table.string("role").defaultTo("user"); // e.g. "admin", "editor", "user"
    table.timestamps();
});
```

In your User model:

```typescript
// app/Models/User.ts
export class User extends BaseModel {
    protected table = "users";
    public role!: string;
}
```

`HasRoles.hasRole(user, "admin")` automatically inspects `user.role === "admin"`.

---

#### Option 2: JSON Array Columns (Modern & Flexible)

For applications where users can hold multiple roles and custom permissions without the overhead of extra pivot tables:

```typescript
// database/migrations/xxxx_create_users_table.ts
await Schema.create("users", (table) => {
    table.increments("id").primary();
    table.string("name");
    table.string("email").unique();
    table.string("password");
    table.json("roles").nullable();       // e.g. ["admin", "editor"]
    table.json("permissions").nullable(); // e.g. ["publish-post", "delete-post"]
    table.timestamps();
});
```

In your User model, define attribute casting:

```typescript
// app/Models/User.ts
export class User extends BaseModel {
    protected table = "users";

    public casts = {
        roles: "json",
        permissions: "json",
    };
}
```

You can now store arrays directly:

```typescript
await User.create({
    name: "John Doe",
    email: "john@example.com",
    password: await Auth.hashPassword("secret"),
    roles: ["admin", "editor"],
    permissions: ["publish-post", "manage-users"],
});
```

---

#### Option 3: Relational Pivot Tables (Enterprise Dynamic RBAC)

For complex enterprise applications where roles and permissions are dynamically managed via an Admin Dashboard:

1. **Tables Structure:**
   * `users` (`id`, `name`, `email`, ...)
   * `roles` (`id`, `name`, `slug`)
   * `permissions` (`id`, `name`, `slug`)
   * `role_user` (`user_id`, `role_id`)
   * `permission_role` (`permission_id`, `role_id`)

2. **In your User model, define getters for `roles` and `permissions`:**

```typescript
// app/Models/User.ts
import { BaseModel } from "struxjs";
import { Role } from "./Role.js";

export class User extends BaseModel {
    protected table = "users";

    public rolesRelation() {
        return this.belongsToMany(Role, "role_user", "user_id", "role_id");
    }

    // Expose array of role slugs/names to HasRoles and Gate:
    public get roles(): string[] {
        const loaded = this.relations?.rolesRelation || this.relations?.roles;
        return Array.isArray(loaded) ? loaded.map((r: any) => r.slug || r.name) : [];
    }
}
```

---

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

### `PermissionMiddleware` - direct permission check

Restrict a route to users with a specific permission:

```typescript
import { PermissionMiddleware } from "struxjs";

Route.post("/posts", [PostController, "store"])
    .middleware("permission:publish-post");
```

Register middlewares in `AppServiceProvider` to use string aliases:

```typescript
import { CanMiddleware, RoleMiddleware, PermissionMiddleware } from "struxjs";

export class AppServiceProvider {
    public register(container: Container): void {
        container.bind("can",        (c) => c.make(CanMiddleware));
        container.bind("role",       (c) => c.make(RoleMiddleware));
        container.bind("permission", (c) => c.make(PermissionMiddleware));
    }
}
```

### Combining Authentication & Authorization in Routes

You can chain authentication middleware (`auth` or `apiauth`) with authorization middleware (`can`, `role`, `permission`) on any route or route group:

```typescript
// Web Routes (Session auth + Role check)
Route.middleware(["auth", "role:admin"]).group(() => {
    Route.get("/admin", [AdminController, "index"]);
});

// API Routes (JWT Bearer Token + Role check)
Route.middleware(["apiauth", "role:admin"]).group(() => {
    Route.get("/api/admin/metrics", [AdminController, "metrics"]);
});

// API Routes (JWT Bearer Token + Gate ability check)
Route.middleware(["apiauth", "can:edit-post"])
    .put("/api/posts/:id", [PostController, "update"]);

// API Routes (JWT Bearer Token + Direct permission check)
Route.middleware(["apiauth", "permission:manage-users"])
    .delete("/api/users/:id", [UserController, "destroy"]);
```

::: tip DUAL-GUARD & CONTEXT SHARING (SESSION & JWT)
All authorization utilities (`Gate.allows()`, `Gate.authorize()`, `CanMiddleware`, `RoleMiddleware`, and `PermissionMiddleware`) automatically resolve the authenticated user from both **Web Session cookies** and **JWT Bearer tokens** (`Authorization: Bearer <token>`).

When `apiauth` verifies a JWT token, it automatically attaches the user to the request context. Downstream authorization middlewares access this user instance immediately without querying the database again.
:::

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
| `PermissionMiddleware` | Route middleware - direct permission check |
| `@can` / `@role` | Template directives |
