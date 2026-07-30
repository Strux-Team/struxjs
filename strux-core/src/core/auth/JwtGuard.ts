import jwt from "jsonwebtoken";
import { httpContextStorage } from "../http/HttpContext.js";
import { BaseModel } from "../database/BaseModel.js";
import { jwtBlacklist, BlacklistDriver, BlacklistRedisOptions } from "./JwtBlacklist.js";
import { jwtRefreshStore, RefreshTokenRecord, RefreshStoreRedisOptions } from "./JwtRefreshStore.js";
import { env, config } from "../config/Config.js";

export interface JwtPayload {
    sub: any;         // user primary key
    guard: string;    // guard name (e.g. "api")
    jti?: string;     // unique token ID — set on refresh tokens for store lookup
    type?: string;    // "refresh" for refresh tokens
    iat?: number;
    exp?: number;
    [key: string]: any;
}

export interface JwtConfig {
    secret: string;
    ttl: number;                             // access token TTL in seconds (default: 3600)
    refreshTtl: number;                      // refresh token TTL in seconds (default: 604800)
    algorithm?: jwt.Algorithm;

    // Blacklist (for access token invalidation)
    blacklist?: BlacklistDriver;             // "memory" (default) | "redis"
    blacklistRedisOptions?: BlacklistRedisOptions;

    // Refresh token store
    refreshStore?: BlacklistDriver;          // "memory" (default) | "redis"
    refreshStoreRedisOptions?: RefreshStoreRedisOptions;

    // Rotation: issue a new refresh token on every use, revoke the old one
    rotation?: boolean;                      // default: false
}

// Per-guard model registry (shared reference injected by Auth.ts)
let guardRegistry: Map<string, new (attrs?: Record<string, any>) => BaseModel>;

// Active config
let jwtConfig: JwtConfig = {
    secret:     env("JWT_SECRET", config("app.key", "struxjs_jwt_secret_change_me")),
    ttl:        Number(env("JWT_TTL", 3600)),
    refreshTtl: Number(env("JWT_REFRESH_TTL", 604800)),
    algorithm:  "HS256",
    blacklist:  (env("JWT_BLACKLIST_DRIVER", "memory") as BlacklistDriver),
    refreshStore: (env("JWT_REFRESH_STORE", "memory") as BlacklistDriver),
    rotation:   env("JWT_ROTATION", false) === true || env("JWT_ROTATION", false) === "true"
};

export class JwtGuard {
    /* ---------------------------------------------------------------------- */
    /*  Bootstrap                                                              */
    /* ---------------------------------------------------------------------- */

    /** @internal — called by Auth.ts */
    public static boot(
        registry: Map<string, new (attrs?: Record<string, any>) => BaseModel>,
        config?: Partial<JwtConfig>
    ): void {
        guardRegistry = registry;
        if (config) this.configure(config);
    }

    /**
     * Configure the JWT guard.
     *
     * Auth.configureJwt({
     *   secret: process.env.JWT_SECRET,
     *   ttl: 3600,
     *   rotation: true,
     *   refreshStore: 'redis',
     *   refreshStoreRedisOptions: { host: '127.0.0.1', db: 2 },
     *   blacklist: 'redis',
     *   blacklistRedisOptions: { host: '127.0.0.1', db: 1 }
     * });
     */
    public static configure(config: Partial<JwtConfig>): void {
        jwtConfig = { ...jwtConfig, ...config };

        // (Re-)initialize access token blacklist
        if (jwtConfig.blacklist === "redis") {
            jwtBlacklist.useRedis(jwtConfig.blacklistRedisOptions);
        } else {
            jwtBlacklist.useMemory();
        }

        // (Re-)initialize refresh token store
        if (jwtConfig.refreshStore === "redis") {
            jwtRefreshStore.useRedis(jwtConfig.refreshStoreRedisOptions);
        } else {
            jwtRefreshStore.useMemory();
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Token issuance                                                         */
    /* ---------------------------------------------------------------------- */

    /**
     * Issue an access token.
     *
     * const token = JwtGuard.issueToken(user);
     */
    public static issueToken(
        user: BaseModel,
        guard = "api",
        extraClaims: Record<string, any> = {}
    ): string {
        const id = (user as any).attributes?.id ?? (user as any).id;
        if (!id) throw new Error("[StruxJS JWT Error]: Cannot issue token for a model without a primary key.");

        return jwt.sign(
            { sub: id, guard, ...extraClaims },
            jwtConfig.secret,
            { expiresIn: jwtConfig.ttl, algorithm: jwtConfig.algorithm || "HS256" }
        );
    }

    /**
     * Issue an access + refresh token pair and persist the refresh token.
     *
     * const { token, refreshToken, expiresIn } = await JwtGuard.issueTokenPair(user);
     */
    public static async issueTokenPair(
        user: BaseModel,
        guard = "api",
        extraClaims: Record<string, any> = {}
    ): Promise<{ token: string; refreshToken: string; expiresIn: number }> {
        const id = (user as any).attributes?.id ?? (user as any).id;
        if (!id) throw new Error("[StruxJS JWT Error]: Cannot issue token for a model without a primary key.");

        const token = this.issueToken(user, guard, extraClaims);

        // Generate a unique JTI for the refresh token
        const jti = jwtRefreshStore.generateJti();

        const refreshToken = jwt.sign(
            { sub: id, guard, type: "refresh", jti },
            jwtConfig.secret,
            { expiresIn: jwtConfig.refreshTtl, algorithm: jwtConfig.algorithm || "HS256" }
        );

        // Persist refresh token in the store
        await jwtRefreshStore.store(jti, id, guard, jwtConfig.refreshTtl);

        return { token, refreshToken, expiresIn: jwtConfig.ttl };
    }

    /**
     * Use a refresh token to get a new access token (and optionally a new refresh token).
     *
     * - Without rotation (default): refresh token is reused until it expires
     * - With rotation: refresh token is revoked and a new one is issued every time
     *
     * const result = await JwtGuard.refreshToken(oldRefreshToken);
     */
    public static async refreshToken(
        refreshTokenStr: string,
        guard = "api"
    ): Promise<{ token: string; refreshToken: string; expiresIn: number }> {
        // 1. Verify the JWT signature and blacklist
        const payload = await this.verifyToken(refreshTokenStr);

        if (payload.type !== "refresh") {
            throw new Error("[StruxJS JWT Error]: Provided token is not a refresh token.");
        }

        if (!payload.jti) {
            throw new Error("[StruxJS JWT Error]: Refresh token is missing JTI claim. Re-login required.");
        }

        // 2. Validate against the refresh store (ensures it hasn't been revoked)
        const record = await jwtRefreshStore.find(payload.jti);
        if (!record) {
            throw new Error("[StruxJS JWT Error]: Refresh token has been revoked or does not exist.");
        }

        // 3. Guard mismatch check
        if (record.guard !== guard) {
            throw new Error(`[StruxJS JWT Error]: Refresh token guard mismatch (expected '${guard}').`);
        }

        // 4. Resolve user
        const ModelClass = guardRegistry?.get(guard);
        if (!ModelClass) {
            throw new Error(`[StruxJS JWT Error]: No model registered for guard '${guard}'.`);
        }

        const user = await (ModelClass as any).find(record.userId);
        if (!user) throw new Error("[StruxJS JWT Error]: User not found for refresh token subject.");

        // 5. Issue new access token
        const newAccessToken = this.issueToken(user, guard);

        // 6. Handle rotation
        if (jwtConfig.rotation) {
            // Revoke old refresh token
            await jwtRefreshStore.revoke(payload.jti);

            // Issue new refresh token
            const newJti = jwtRefreshStore.generateJti();
            const newRefreshToken = jwt.sign(
                { sub: record.userId, guard, type: "refresh", jti: newJti },
                jwtConfig.secret,
                { expiresIn: jwtConfig.refreshTtl, algorithm: jwtConfig.algorithm || "HS256" }
            );
            await jwtRefreshStore.store(newJti, record.userId, guard, jwtConfig.refreshTtl);

            // Also blacklist old refresh token string so it can't be reused even if someone
            // obtained it before rotation happened (replay attack protection)
            const remaining = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : jwtConfig.refreshTtl;
            await jwtBlacklist.add(refreshTokenStr, Math.max(1, remaining));

            return { token: newAccessToken, refreshToken: newRefreshToken, expiresIn: jwtConfig.ttl };
        }

        // No rotation — return the same refresh token
        return { token: newAccessToken, refreshToken: refreshTokenStr, expiresIn: jwtConfig.ttl };
    }

    /* ---------------------------------------------------------------------- */
    /*  Token verification                                                     */
    /* ---------------------------------------------------------------------- */

    /**
     * Verify and decode a JWT. Throws on invalid, expired, or blacklisted token.
     *
     * const payload = await JwtGuard.verifyToken(tokenString);
     */
    public static async verifyToken(token: string): Promise<JwtPayload> {
        const isBlacklisted = await jwtBlacklist.has(token);
        if (isBlacklisted) {
            throw new Error("[StruxJS JWT Error]: Token has been invalidated.");
        }

        try {
            return jwt.verify(token, jwtConfig.secret, {
                algorithms: [jwtConfig.algorithm || "HS256"]
            }) as JwtPayload;
        } catch (err: any) {
            if (err.name === "TokenExpiredError")  throw new Error("[StruxJS JWT Error]: Token has expired.");
            if (err.name === "JsonWebTokenError")  throw new Error("[StruxJS JWT Error]: Invalid token signature.");
            throw new Error(`[StruxJS JWT Error]: ${err.message}`);
        }
    }

    /**
     * Silently verify — returns payload or null.
     *
     * const payload = await JwtGuard.tryVerify(token);
     */
    public static async tryVerify(token: string): Promise<JwtPayload | null> {
        try {
            return await this.verifyToken(token);
        } catch {
            return null;
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Credential-based login                                                 */
    /* ---------------------------------------------------------------------- */

    /**
     * Verify credentials and issue a token pair on success.
     *
     * const result = await JwtGuard.attempt({ email, password });
     */
    public static async attempt(
        credentials: Record<string, any>,
        guard = "api",
        extraClaims: Record<string, any> = {}
    ): Promise<{ token: string; refreshToken: string; expiresIn: number } | null> {
        const ModelClass = guardRegistry?.get(guard);
        if (!ModelClass) {
            throw new Error(
                `[StruxJS JWT Error]: No model registered for guard '${guard}'. ` +
                `Call Auth.extend('${guard}', YourModel) during bootstrap.`
            );
        }

        const { password, ...lookupFields } = credentials;
        if (!password) throw new Error("[StruxJS JWT Error]: attempt() requires a 'password' field.");

        let query = (ModelClass as any).query();
        for (const [key, value] of Object.entries(lookupFields)) {
            query = query.where(key, value);
        }

        const user: BaseModel | null = await query.first();
        if (!user) return null;

        let bcrypt: any;
        try {
            bcrypt = await import("bcryptjs");
        } catch {
            throw new Error("[StruxJS JWT Error]: bcryptjs is not installed. Run: npm install bcryptjs");
        }

        const storedHash = (user as any).attributes?.password ?? (user as any).password;
        if (!storedHash) return null;

        const valid = await bcrypt.compare(password, storedHash);
        if (!valid) return null;

        return this.issueTokenPair(user, guard, extraClaims);
    }

    /* ---------------------------------------------------------------------- */
    /*  Request-context helpers                                                */
    /* ---------------------------------------------------------------------- */

    /** @internal */
    private static async resolveRequestPayload(guard?: string): Promise<JwtPayload | null> {
        const store = httpContextStorage.getStore();
        if (!store) return null;

        const authHeader = store.request.headers["authorization"] ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
        if (!token) return null;

        const payload = await this.tryVerify(token);
        if (!payload) return null;
        if (guard && payload.guard !== guard) return null;

        return payload;
    }

    /** if (await Auth.jwt().check()) */
    public static async check(guard?: string): Promise<boolean> {
        return (await this.resolveRequestPayload(guard)) !== null;
    }

    /** const id = await Auth.jwt().id() */
    public static async id(guard?: string): Promise<any> {
        return (await this.resolveRequestPayload(guard))?.sub ?? null;
    }

    /** const user = await Auth.jwt().user<User>() */
    public static async user<T extends BaseModel = BaseModel>(guard = "api"): Promise<T | null> {
        const payload = await this.resolveRequestPayload(guard);
        if (!payload) return null;

        // Check request-scoped cache first
        const store = httpContextStorage.getStore();
        const cacheKey = `jwt:${guard}:${payload.sub}`;
        if (store?.userCache.has(cacheKey)) {
            return store.userCache.get(cacheKey) as T;
        }

        const ModelClass = guardRegistry?.get(guard);
        if (!ModelClass) {
            throw new Error(
                `[StruxJS JWT Error]: No model registered for guard '${guard}'. ` +
                `Call Auth.extend('${guard}', YourModel) during bootstrap.`
            );
        }

        const user = await (ModelClass as any).find(payload.sub) as T | null;

        // Store in cache for the lifetime of this request
        if (store && user) {
            store.userCache.set(cacheKey, user);
        }

        return user;
    }

    /** const payload = await Auth.jwt().payload() */
    public static async payload(guard?: string): Promise<JwtPayload | null> {
        return this.resolveRequestPayload(guard);
    }

    /* ---------------------------------------------------------------------- */
    /*  Token invalidation & revocation                                        */
    /* ---------------------------------------------------------------------- */

    /**
     * Blacklist an access token.
     *
     * await Auth.jwt().invalidate(token);
     */
    public static async invalidate(token: string, ttlSeconds?: number): Promise<void> {
        const ttl = ttlSeconds ?? jwtConfig.ttl;
        await jwtBlacklist.add(token, ttl);
    }

    /**
     * Get the raw Bearer token from the current request.
     */
    public static getRequestToken(): string | null {
        const store = httpContextStorage.getStore();
        if (!store) return null;
        const authHeader = store.request.headers["authorization"] ?? "";
        return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    }

    /**
     * Blacklist the access token currently in the request (for logout).
     *
     * await Auth.jwt().invalidateRequestToken();
     */
    public static async invalidateRequestToken(): Promise<void> {
        const token = this.getRequestToken();
        if (!token) return;

        const decoded = jwt.decode(token) as JwtPayload | null;
        const remaining = decoded?.exp
            ? decoded.exp - Math.floor(Date.now() / 1000)
            : jwtConfig.ttl;

        await this.invalidate(token, Math.max(1, remaining));
    }

    /**
     * Revoke ALL refresh tokens for a user.
     * Use on password change, forced logout, or account compromise.
     *
     * await Auth.jwt().revokeAllTokens(userId);
     * await Auth.jwt().revokeAllTokens(userId, 'admin'); // specific guard
     */
    public static async revokeAllTokens(userId: any, guard?: string): Promise<void> {
        if (guard) {
            // Targeted: only revoke tokens for a specific guard
            const records = await jwtRefreshStore.listByUser(userId);
            for (const record of records) {
                if (record.guard === guard) {
                    await jwtRefreshStore.revoke(record.jti);
                }
            }
        } else {
            // Revoke all guards
            await jwtRefreshStore.revokeAll(userId);
        }
    }

    /**
     * List all active refresh token sessions for a user.
     *
     * const sessions = await Auth.jwt().getActiveSessions(userId);
     * // Returns: [{ jti, userId, guard, createdAt, expiresAt }]
     */
    public static async getActiveSessions(userId: any): Promise<RefreshTokenRecord[]> {
        return jwtRefreshStore.listByUser(userId);
    }

    /**
     * Revoke a specific refresh token session by JTI.
     *
     * await Auth.jwt().revokeSession(jti);
     */
    public static async revokeSession(jti: string): Promise<void> {
        await jwtRefreshStore.revoke(jti);
    }
}
