# Authentication

StruxJS includes a built-in authentication system with two strategies:

- **Session-based** - for traditional web applications (form login, cookies, redirects)
- **JWT-based** - for stateless API authentication (Bearer tokens, refresh tokens)

Both are backed by the `Auth` facade and come with pre-built middleware you can use immediately.

---

## Setup

### Register your model

Tell `Auth` which model represents an authenticated user. Do this in the `register` method of `AppServiceProvider`:

```typescript
import { Auth } from "struxjs";
import { User } from "./app/Models/User.js";

Auth.extend("web", User);   // session guard
Auth.extend("api", User);   // JWT guard
```

If you only use one guard, registering just that guard is enough.

### Password hashing

User passwords must be hashed with bcrypt. Use `Auth.hashPassword()` when creating or updating users:

```typescript
const hashed = await Auth.hashPassword("secret123");

await User.create({
    name: "Alice",
    email: "alice@example.com",
    password: hashed,
});
```

---

## Web Authentication (Session)

Session authentication is the standard approach for server-rendered web apps. The user logs in via a form, the session stores their ID, and subsequent requests are identified by a session cookie.

### Login

Use `Auth.attempt()` to verify credentials and create a session automatically:

```typescript
import { Auth, Request, Response } from "struxjs";

export class AuthController {
    public async login(request: Request, response: Response) {
        const { email, password } = request.all();

        const ok = await Auth.attempt({ email, password });

        if (!ok) {
            return response.redirect().back()
                .withInput()
                .with("error", "These credentials do not match our records.");
        }

        return response.redirect("/dashboard");
    }
}
```

`Auth.attempt()` finds the user by all non-password fields, verifies the password with bcrypt, calls `Auth.login()` on success, and returns `true` or `false`.

### Manual login

If you've already retrieved the user and verified credentials yourself:

```typescript
await Auth.login(user);
```

### Logout

```typescript
export class AuthController {
    public async logout(request: Request, response: Response) {
        await Auth.logout();
        return response.redirect("/login");
    }
}
```

`Auth.logout()` flushes the session and regenerates the session ID.

### Checking authentication state

```typescript
import { Auth, auth } from "struxjs";

// Check if authenticated
Auth.check()   // true / false
auth().check() // same, using the global helper

// Check if guest
Auth.guest()

// Get the authenticated user's ID
const id = Auth.id();

// Get the full user model (queries DB, cached per request)
const user = await Auth.user<User>();
```

The `auth()` global helper is an alias for `Auth` - use whichever feels more natural.

### Using Auth in Views

When returning a view from a controller, the currently authenticated user object is **automatically** resolved and injected into the view's data as `user`. You do **not** need to call `auth().user()` inside the view (which is asynchronous and would return a Promise).

```html
@if (auth().check())
    <h1>Welcome back, {{ user.name }}!</h1>
@else
    <h1>Welcome, Guest!</h1>
@endif
```

*Note: Since Node.js is asynchronous, `auth().user()` returns a `Promise`. The `view()` helper automatically `await`s the authenticated user and injects it as `user` to provide a seamless, synchronous developer experience in your `.strux` templates.*

### Protecting routes with `AuthMiddleware`

The pre-built `AuthMiddleware` is already in `app/Middleware/AuthMiddleware.ts`. It checks `auth().guest()` and:

- Redirects to `/login` for web requests
- Returns `401 JSON` for requests that expect JSON (`Accept: application/json`, XHR, or `/api/` routes)

Apply it to your protected routes:

```typescript
// routes/web.ts
import { Route } from "struxjs";
import { AuthMiddleware } from "../app/Middleware/AuthMiddleware.js";

Route.middleware(AuthMiddleware).group(() => {
    Route.get("/dashboard", [DashboardController, "index"]);
    Route.get("/settings", [UserController, "settings"]);
    Route.post("/settings", [UserController, "update"]);
});
```

Or on individual routes:

```typescript
Route.get("/profile", [UserController, "profile"])
    .middleware(AuthMiddleware);
```

You can also use the auto-registered string alias `"auth"`:

```typescript
Route.middleware("auth").group(() => {
    Route.get("/dashboard", [DashboardController, "index"]);
});
```

---

## API Authentication (JWT)

JWT authentication is designed for stateless API endpoints. The client receives a Bearer token on login and sends it in the `Authorization` header on every request.

### Configure JWT

In the `register` method of `AppServiceProvider`, configure the JWT guard:

```typescript
import { Auth } from "struxjs";

Auth.configureJwt({
    secret: process.env.JWT_SECRET,
    ttl: 3600,           // access token TTL in seconds (default: 3600)
    refreshTtl: 604800,  // refresh token TTL (default: 7 days)
    rotation: true,      // issue a new refresh token on every refresh (optional)
});
```

All JWT settings can also be driven by environment variables:

```ini
JWT_SECRET=your-secret-key
JWT_TTL=3600
JWT_REFRESH_TTL=604800
JWT_ROTATION=false
```

### Login - issue tokens

Use `Auth.jwt().attempt()` to verify credentials and return a token pair:

```typescript
export class AuthController {
    public async login(request: Request, response: Response) {
        const { email, password } = request.all();

        const result = await Auth.jwt().attempt({ email, password });

        if (!result) {
            return response.status(401).json({ message: "Invalid credentials." });
        }

        return response.json({
            token:        result.token,
            refreshToken: result.refreshToken,
            expiresIn:    result.expiresIn,
        });
    }
}
```

### Refresh tokens

Exchange a valid refresh token for a new access token:

```typescript
export class AuthController {
    public async refresh(request: Request, response: Response) {
        const { refreshToken } = request.all();

        try {
            const result = await Auth.jwt().refreshToken(refreshToken);
            return response.json(result);
        } catch (error: any) {
            return response.status(401).json({ message: error.message });
        }
    }
}
```

### Logout - invalidate token

Blacklist the current request's access token so it can no longer be used:

```typescript
export class AuthController {
    public async logout(request: Request, response: Response) {
        await Auth.jwt().invalidateRequestToken();
        return response.json({ message: "Logged out." });
    }
}
```

### Protecting routes with `ApiAuthMiddleware`

The pre-built `ApiAuthMiddleware` is already in `app/Middleware/ApiAuthMiddleware.ts`. It reads the `Authorization: Bearer <token>` header, verifies the JWT, and returns `401` if missing or invalid.

```typescript
// routes/api.ts
import { Route } from "struxjs";
import { ApiAuthMiddleware } from "../app/Middleware/ApiAuthMiddleware.js";

Route.middleware(ApiAuthMiddleware).group(() => {
    Route.get("/me", [UserController, "me"]);
    Route.put("/profile", [UserController, "update"]);
});
```

Or using the auto-registered string alias `"apiauth"`:

```typescript
Route.middleware("apiauth").group(() => {
    Route.get("/me", [UserController, "me"]);
});
```

### Guard parameter

Pass a guard name to enforce that the token was issued for a specific guard. A token issued for the `admin` guard is rejected on an `api` route:

```typescript
// "apiauth:admin" - only allows tokens with guard = "admin"
Route.get("/admin/stats", [AdminController, "stats"])
    .middleware("apiauth:admin");
```

### Reading the authenticated user in API controllers

```typescript
import { Auth } from "struxjs";

export class UserController {
    public async me(request: Request, response: Response) {
        const user = await Auth.jwt().user<User>();
        return response.json({ user });
    }
}
```

Other JWT helpers available inside a request context:

```typescript
await Auth.jwt().check()              // true if valid Bearer token present
await Auth.jwt().id()                 // user primary key from token
await Auth.jwt().payload()            // full decoded JWT payload
Auth.jwt().getRequestToken()          // raw token string from header
```

---

## Issuing Tokens Manually

When you've already verified the user and just need to issue tokens:

```typescript
// Issue just an access token
const token = Auth.jwt().issueToken(user, "api");

// Issue an access + refresh token pair
const { token, refreshToken, expiresIn } = await Auth.jwt().issueTokenPair(user, "api");

// With extra custom claims
const token = Auth.jwt().issueToken(user, "api", { role: "admin" });
```

---

## Session Management (JWT)

### Revoke all tokens for a user

Force logout everywhere - useful after a password change or account compromise:

```typescript
await Auth.jwt().revokeAllTokens(userId);

// Revoke only a specific guard
await Auth.jwt().revokeAllTokens(userId, "api");
```

### List active sessions

```typescript
const sessions = await Auth.jwt().getActiveSessions(userId);
// Returns: [{ jti, userId, guard, createdAt, expiresAt }]
```

### Revoke a specific session

```typescript
await Auth.jwt().revokeSession(jti);
```

---

## Token Blacklist & Refresh Store

By default both the access token blacklist and the refresh token store use in-memory storage. In multi-server deployments, switch to Redis so all instances share the same state:

```typescript
Auth.configureJwt({
    blacklist: "redis",
    blacklistRedisOptions: { host: "127.0.0.1", port: 6379, db: 1 },

    refreshStore: "redis",
    refreshStoreRedisOptions: { host: "127.0.0.1", port: 6379, db: 2 },
});
```

---

## Pre-built Middleware Reference

| Middleware | Alias | Purpose |
| :--- | :--- | :--- |
| `AuthMiddleware` | `"auth"` | Session auth - redirect to `/login` or `401 JSON` |
| `ApiAuthMiddleware` | `"apiauth"` | JWT auth - verify Bearer token, `401` on failure |

Both files are in `app/Middleware/` and can be modified freely to match your application's requirements - change the redirect path, add logging, attach the user to the request, etc.
