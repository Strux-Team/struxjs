import { describe, test, expect, beforeEach } from "vitest";
import { Auth, JwtGuard, BaseModel, jwtBlacklist } from "../src/index.js";

import { Schema } from "../src/index.js";

class UserMock extends BaseModel {
    public table = "users";
    public id = 42;
    public email = "user@example.com";
}

describe("Auth & JWT Guard", () => {
    beforeEach(async () => {
        jwtBlacklist.flush();

        await BaseModel.bootConnection({
            client: "sqlite3",
            connection: { filename: ":memory:" },
            useNullAsDefault: true,
        });

        await Schema.dropTableIfExists("users");
        await Schema.create("users", (table) => {
            table.integer("id").primary();
            table.string("email");
        });

        await BaseModel.connection()("users").insert({ id: 42, email: "user@example.com" });

        Auth.extend("api", UserMock);
        Auth.configureJwt({
            secret: "super-secret-test-key-1234567890",
            ttl: 3600,
            refreshTtl: 86400,
        });
    });

    test("issues and verifies valid JWT access token", async () => {
        const user = new UserMock();
        const token = JwtGuard.issueToken(user, "api", { role: "admin" });

        expect(typeof token).toBe("string");

        const payload = await JwtGuard.verifyToken(token);
        expect(payload.sub).toBe(42);
        expect(payload.guard).toBe("api");
        expect(payload.role).toBe("admin");
    });

    test("issues token pair and refreshes token", async () => {
        const user = new UserMock();
        const pair = await JwtGuard.issueTokenPair(user, "api");

        expect(pair.token).toBeDefined();
        expect(pair.refreshToken).toBeDefined();

        const refreshed = await JwtGuard.refreshToken(pair.refreshToken, "api");
        expect(refreshed.token).toBeDefined();
        expect(refreshed.expiresIn).toBe(3600);
    });

    test("revokes token via blacklist and rejects verified token", async () => {
        const user = new UserMock();
        const token = JwtGuard.issueToken(user, "api");

        await JwtGuard.invalidate(token);

        await expect(JwtGuard.verifyToken(token)).rejects.toThrow("invalidated");
    });

    test("refresh token cannot be used as an access token or to access protected data", async () => {
        const { httpContextStorage } = await import("../src/core/http/HttpContext.js");
        const user = new UserMock();
        const pair = await JwtGuard.issueTokenPair(user, "api");

        // Access token verification
        const accessPayload = await JwtGuard.verifyAccessToken(pair.token);
        expect(accessPayload.type).toBe("access");

        // Refresh token must be rejected when verified as access token
        await expect(JwtGuard.verifyAccessToken(pair.refreshToken)).rejects.toThrow(
            "Cannot use a refresh token as an access token"
        );
        expect(await JwtGuard.tryVerifyAccessToken(pair.refreshToken)).toBeNull();

        // When accessing via HTTP Request Context with Access Token
        await httpContextStorage.run(
            {
                request: { headers: { authorization: `Bearer ${pair.token}` } } as any,
                reply: {} as any,
                session: null as any,
                userCache: new Map(),
            },
            async () => {
                expect(await Auth.jwt().check("api")).toBe(true);
                const authUser = await Auth.jwt().user<UserMock>("api");
                expect(authUser?.id).toBe(42);
                expect(await Auth.jwt().id("api")).toBe(42);
            }
        );

        // When accessing via HTTP Request Context with Refresh Token -> must be rejected
        await httpContextStorage.run(
            {
                request: { headers: { authorization: `Bearer ${pair.refreshToken}` } } as any,
                reply: {} as any,
                session: null as any,
                userCache: new Map(),
            },
            async () => {
                expect(await Auth.jwt().check("api")).toBe(false);
                expect(await Auth.jwt().user("api")).toBeNull();
                expect(await Auth.jwt().id("api")).toBeNull();
                expect(await Auth.jwt().payload("api")).toBeNull();
            }
        );
    });

    test("parses string duration TTL formats safely into integer seconds", async () => {
        const { parseTtlToSeconds } = await import("../src/index.js");

        expect(parseTtlToSeconds("30d", 604800)).toBe(30 * 24 * 3600);
        expect(parseTtlToSeconds("7d", 604800)).toBe(7 * 24 * 3600);
        expect(parseTtlToSeconds("1h", 3600)).toBe(3600);
        expect(parseTtlToSeconds("15m", 3600)).toBe(900);
        expect(parseTtlToSeconds("45s", 3600)).toBe(45);
        expect(parseTtlToSeconds("1w", 3600)).toBe(7 * 24 * 3600);
        expect(parseTtlToSeconds(120.9, 3600)).toBe(120);
        expect(parseTtlToSeconds("invalid_duration", 3600)).toBe(3600);
        expect(parseTtlToSeconds(NaN, 3600)).toBe(3600);
        expect(parseTtlToSeconds(-10, 3600)).toBe(3600);
        expect(parseTtlToSeconds(null, 3600)).toBe(3600);
    });

    test("JwtRefreshStore correctly falls back to memory and can find token even when Redis fails", async () => {
        const { jwtRefreshStore } = await import("../src/index.js");

        // Mock redis client that throws on SET (simulating redis error e.g. ERR value is not an integer or connection down)
        const mockFailingRedis: any = {
            set: async () => {
                throw new Error("ERR value is not an integer or out of range");
            },
            get: async () => null, // Redis returns null because it wasn't saved in Redis
            sadd: async () => {},
            expire: async () => {},
            del: async () => {},
            srem: async () => {},
            smembers: async () => [],
        };

        jwtRefreshStore.useRedisClient(mockFailingRedis);

        const jti = "test-failing-redis-jti-123";
        // Store token with string duration or float
        await jwtRefreshStore.store(jti, 42, "api", "7d");

        // Even though Redis set threw an error and Redis get returns null, find() MUST find it in memory fallback!
        const found = await jwtRefreshStore.find(jti);
        expect(found).not.toBeNull();
        expect(found?.jti).toBe(jti);
        expect(found?.userId).toBe(42);

        // Revoking removes it from memory too
        await jwtRefreshStore.revoke(jti);
        expect(await jwtRefreshStore.find(jti)).toBeNull();

        // Switch back to memory driver for subsequent tests
        jwtRefreshStore.useMemory();
    });

    test("accessToken and refreshToken share the same JTI", async () => {
        const user = new UserMock();
        const pair = await JwtGuard.issueTokenPair(user, "api");

        const accessPayload = await JwtGuard.verifyAccessToken(pair.token);
        const refreshPayload = await JwtGuard.verifyToken(pair.refreshToken);

        expect(accessPayload.jti).toBeDefined();
        expect(refreshPayload.jti).toBeDefined();
        expect(accessPayload.jti).toBe(refreshPayload.jti);
    });

    test("token rotation automatically invalidates old access token via shared JTI", async () => {
        Auth.configureJwt({
            rotation: true,
            ttl: 3600,
            refreshTtl: 86400,
        });

        const user = new UserMock();
        const pair = await JwtGuard.issueTokenPair(user, "api");

        // Prior to rotation: access token is completely valid
        expect(await JwtGuard.verifyAccessToken(pair.token)).toBeDefined();

        // Perform rotation
        const refreshed = await JwtGuard.refreshToken(pair.refreshToken, "api");

        // 1. Old access token MUST be invalidated immediately via shared JTI
        await expect(JwtGuard.verifyAccessToken(pair.token)).rejects.toThrow("invalidated");

        // 2. Old refresh token MUST also be rejected (revoked + blacklisted)
        await expect(JwtGuard.refreshToken(pair.refreshToken, "api")).rejects.toThrow();

        // 3. New access token and new refresh token MUST be valid
        const newAccessPayload = await JwtGuard.verifyAccessToken(refreshed.token);
        expect(newAccessPayload).toBeDefined();
        expect(newAccessPayload.jti).not.toBe((pair.token as any).jti);

        // Turn rotation back off
        Auth.configureJwt({ rotation: false });
    });
});
