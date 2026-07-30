import { describe, test, expect, afterAll } from "vitest";
import { Redis } from "../src/index.js";

describe("Standalone Redis Engine", () => {
    afterAll(async () => {
        try {
            await Redis.disconnect();
        } catch {
            // Ignore if redis is not running locally during unit tests
        }
    });

    test("exposes Redis class with static methods and connection manager", () => {
        expect(typeof Redis.connection).toBe("function");
        expect(typeof Redis.get).toBe("function");
        expect(typeof Redis.set).toBe("function");
        expect(typeof Redis.hset).toBe("function");
        expect(typeof Redis.hgetall).toBe("function");
        expect(typeof Redis.disconnect).toBe("function");
    });
});
