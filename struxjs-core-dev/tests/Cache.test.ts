import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { MemoryDriver } from "../src/core/cache/drivers/MemoryDriver.js";
import { FileDriver } from "../src/core/cache/drivers/FileDriver.js";
import { Cache } from "../src/index.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Cache Drivers", () => {
    describe("MemoryDriver", () => {
        let driver: MemoryDriver;

        beforeEach(() => {
            driver = new MemoryDriver();
        });

        test("stores and retrieves items", async () => {
            await driver.put("foo", "bar");
            expect(await driver.get("foo")).toBe("bar");
        });

        test("returns null for non-existent items", async () => {
            expect(await driver.get("missing")).toBeNull();
        });

        test("handles item expiration (TTL)", async () => {
            await driver.put("short", "val", 0.05); // 50ms
            expect(await driver.get("short")).toBe("val");

            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(await driver.get("short")).toBeNull();
        });

        test("increments and decrements numeric values", async () => {
            expect(await driver.increment("counter", 5)).toBe(5);
            expect(await driver.increment("counter", 2)).toBe(7);
            expect(await driver.decrement("counter", 3)).toBe(4);
        });

        test("handles many operations and flush", async () => {
            await driver.putMany({ a: 1, b: 2 });
            expect(await driver.many(["a", "b"])).toEqual({ a: 1, b: 2 });

            await driver.flush();
            expect(await driver.get("a")).toBeNull();
        });
    });

    describe("FileDriver", () => {
        let tmpDir: string;
        let driver: FileDriver;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strux-cache-test-"));
            driver = new FileDriver(tmpDir);
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test("persists cache items to disk", async () => {
            await driver.put("disk_key", { data: 123 });
            expect(await driver.get("disk_key")).toEqual({ data: 123 });
            expect(await driver.has("disk_key")).toBe(true);

            await driver.forget("disk_key");
            expect(await driver.has("disk_key")).toBe(false);
        });

        test("flush removes all json files", async () => {
            await driver.put("k1", "v1");
            await driver.put("k2", "v2");
            await driver.flush();

            expect(await driver.get("k1")).toBeNull();
            expect(await driver.get("k2")).toBeNull();
        });
    });

    describe("Cache Facade", () => {
        test("remember method computes and caches missing values", async () => {
            let count = 0;
            const compute = async () => {
                count++;
                return `computed-${count}`;
            };

            const val1 = await Cache.remember("rem_key", 60, compute);
            const val2 = await Cache.remember("rem_key", 60, compute);

            expect(val1).toBe("computed-1");
            expect(val2).toBe("computed-1");
            expect(count).toBe(1);
        });
    });
});
