import { describe, test, expect, beforeEach } from "vitest";
import { Auth, JwtGuard, BaseModel } from "../src/index.js";

import { Schema } from "../src/index.js";

class UserMock extends BaseModel {
    public table = "users";
    public id = 42;
    public email = "user@example.com";
}

describe("Auth & JWT Guard", () => {
    beforeEach(async () => {
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
});
