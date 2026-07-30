import { httpContextStorage, decorateRequest } from "../http/HttpContext.js";
import { BaseModel } from "../database/BaseModel.js";
import { JwtGuard, JwtConfig } from "./JwtGuard.js";

/**
 * Auth — Laravel-style authentication facade backed by the session.
 *
 * Uses AsyncLocalStorage to resolve the current request context, so every
 * helper can be called as a plain static method anywhere inside a request
 * lifecycle (Controllers, Middleware, Services, etc.).
 *
 * Session keys used:
 *   _auth_id    — primary key of the authenticated user
 *   _auth_guard — name of the model class used (e.g. "User")
 */

// Per-guard model registry: Auth.extend('admin', AdminUser)
const guardRegistry: Map<string, new (attrs?: Record<string, any>) => BaseModel> = new Map();

export class Auth {
    /* ---------------------------------------------------------------------- */
    /*  Guard model registration                                               */
    /* ---------------------------------------------------------------------- */

    /**
     * Register a model class for a named guard.
     * Call this once during bootstrap (e.g. AppServiceProvider).
     *
     * Auth.extend('web', User);
     * Auth.extend('admin', AdminUser);
     */
    public static extend(guard: string, model: new (attrs?: Record<string, any>) => BaseModel): void {
        guardRegistry.set(guard, model);
    }

    /**
     * Set the default user model when no guard is specified.
     * Shorthand for Auth.extend('web', model).
     */
    public static setModel(model: new (attrs?: Record<string, any>) => BaseModel): void {
        guardRegistry.set("web", model);
    }

    /**
     * Configure the JWT guard (secret, TTL, algorithm).
     * Call this once during bootstrap before any JWT operations.
     *
     * Auth.configureJwt({ secret: process.env.JWT_SECRET, ttl: 3600 });
     */
    public static configureJwt(config: Partial<JwtConfig>): void {
        JwtGuard.boot(guardRegistry, config);
    }

    /**
     * Access the JWT guard directly for advanced operations.
     *
     * // Issue token
     * const { token } = await Auth.jwt().attempt({ email, password });
     *
     * // Verify & decode
     * const payload = Auth.jwt().verifyToken(tokenString);
     *
     * // Check current request
     * if (Auth.jwt().check()) { ... }
     * const user = await Auth.jwt().user<User>();
     */
    public static jwt(): typeof JwtGuard {
        // Lazily boot JwtGuard with the shared registry on first access
        JwtGuard.boot(guardRegistry);
        return JwtGuard;
    }

    /* ---------------------------------------------------------------------- */
    /*  Private session helpers                                                */
    /* ---------------------------------------------------------------------- */

    private static getSession() {
        const store = httpContextStorage.getStore();
        if (!store) throw new Error("[StruxJS Auth Error]: Auth helpers must be called within an HTTP request context.");
        return decorateRequest(store.request).session();
    }

    /* ---------------------------------------------------------------------- */
    /*  Core Auth API                                                          */
    /* ---------------------------------------------------------------------- */

    /**
     * Authenticate a user and store their ID in the session.
     *
     * await Auth.login(user);
     * await Auth.login(user, 'admin');   // named guard
     */
    public static async login(user: BaseModel, guard = "web"): Promise<void> {
        const session = this.getSession();
        const id = (user as any).attributes?.id ?? (user as any).id;
        if (!id) throw new Error("[StruxJS Auth Error]: Cannot login a model instance without a primary key.");

        session.regenerate();
        await session.load();

        session.put("_auth_id", id);
        session.put("_auth_guard", guard);
        await session.save();
    }

    /**
     * Log the currently authenticated user out and flush the session.
     *
     * await Auth.logout();
     */
    public static async logout(): Promise<void> {
        const session = this.getSession();
        session.forget("_auth_id");
        session.forget("_auth_guard");
        session.flush();
        session.regenerate();
        await session.save();
    }

    /**
     * Check whether a user is currently authenticated.
     *
     * if (Auth.check()) { ... }
     */
    public static check(): boolean {
        try {
            const session = this.getSession();
            const id = session.get("_auth_id");
            return id !== undefined && id !== null;
        } catch {
            return false;
        }
    }

    /**
     * Check whether the request is unauthenticated (inverse of check()).
     *
     * if (Auth.guest()) { return redirect('/login'); }
     */
    public static guest(): boolean {
        return !this.check();
    }

    /**
     * Get the primary key of the currently authenticated user.
     * Returns null when unauthenticated.
     *
     * const userId = Auth.id();
     */
    public static id(): any {
        try {
            return this.getSession().get("_auth_id") ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Resolve and return the full authenticated user model instance.
     * Result is cached in the request context — DB is only queried once per request.
     *
     * const user = await Auth.user<User>();
     */
    public static async user<T extends BaseModel = BaseModel>(guard?: string): Promise<T | null> {
        const id = this.id();
        if (!id) return null;

        const session = this.getSession();
        const resolvedGuard = guard ?? session.get("_auth_guard") ?? "web";

        // Check request-scoped cache first
        const store = httpContextStorage.getStore();
        const cacheKey = `session:${resolvedGuard}:${id}`;
        if (store?.userCache.has(cacheKey)) {
            return store.userCache.get(cacheKey) as T;
        }

        const ModelClass = guardRegistry.get(resolvedGuard);

        if (!ModelClass) {
            throw new Error(
                `[StruxJS Auth Error]: No model registered for guard '${resolvedGuard}'. ` +
                `Call Auth.extend('${resolvedGuard}', YourModel) during bootstrap.`
            );
        }

        const user = await (ModelClass as any).find(id) as T | null;

        // Store in cache for the lifetime of this request
        if (store && user) {
            store.userCache.set(cacheKey, user);
        }

        return user;
    }

    /**
     * Attempt to authenticate a user by credentials.
     * Looks up the model by the given fields (default: email) and verifies
     * the password using bcrypt. Returns true on success.
     *
     * const ok = await Auth.attempt({ email, password });
     * const ok = await Auth.attempt({ email, password }, 'admin');
     */
    public static async attempt(
        credentials: Record<string, any>,
        guard = "web"
    ): Promise<boolean> {
        const ModelClass = guardRegistry.get(guard);

        if (!ModelClass) {
            throw new Error(
                `[StruxJS Auth Error]: No model registered for guard '${guard}'. ` +
                `Call Auth.extend('${guard}', YourModel) during bootstrap.`
            );
        }

        // Separate the password from the lookup fields
        const { password, ...lookupFields } = credentials;

        if (!password) {
            throw new Error("[StruxJS Auth Error]: Auth.attempt() requires a 'password' field in credentials.");
        }

        // Build query from all non-password credential fields
        let query = (ModelClass as any).query();
        for (const [key, value] of Object.entries(lookupFields)) {
            query = query.where(key, value);
        }

        const user: BaseModel | null = await query.first();
        if (!user) return false;

        // Verify password — lazy-import bcryptjs so it stays optional
        let bcrypt: any;
        try {
            bcrypt = await import("bcryptjs");
        } catch {
            throw new Error(
                "[StruxJS Auth Error]: bcryptjs is not installed. Run: npm install bcryptjs"
            );
        }

        const storedHash = (user as any).attributes?.password ?? (user as any).password;
        if (!storedHash) return false;

        const valid = await bcrypt.compare(password, storedHash);
        if (!valid) return false;

        await this.login(user, guard);
        return true;
    }

    /**
     * Hash a plain-text password using bcrypt (cost factor 12).
     * Use this when creating or updating users.
     *
     * const hashed = await Auth.hashPassword('secret123');
     */
    public static async hashPassword(plain: string, rounds = 12): Promise<string> {
        let bcrypt: any;
        try {
            bcrypt = await import("bcryptjs");
        } catch {
            throw new Error(
                "[StruxJS Auth Error]: bcryptjs is not installed. Run: npm install bcryptjs"
            );
        }
        return bcrypt.hash(plain, rounds);
    }
}

/**
 * Global auth() helper — returns the Auth facade.
 * Mirrors Laravel's auth() helper for use anywhere inside the request lifecycle.
 *
 * Usage (inside Controllers, Middleware, Services):
 *   import { auth } from "struxjs";
 *
 *   if (auth().check()) { ... }
 *   const user = await auth().user<User>();
 *   const id   = auth().id();
 *   await auth().logout();
 */
export function auth(): typeof Auth {
    return Auth;
}
