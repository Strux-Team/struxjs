import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { SessionStore, MemorySessionDriver, FileSessionDriver } from "../src/index.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Session Management", () => {
    describe("MemorySessionDriver", () => {
        test("stores and loads session data in memory", async () => {
            const memoryDriver = new MemorySessionDriver();
            const session = new SessionStore("sess_123", memoryDriver);

            session.put("user_id", 42);
            session.flash("message", "Success");
            await session.save();

            const reloadedSession = new SessionStore("sess_123", memoryDriver);
            await reloadedSession.load();

            expect(reloadedSession.get("user_id")).toBe(42);
            expect(reloadedSession.get("message")).toBe("Success");
        });

        test("handles flash data lifecycle across requests", async () => {
            const memoryDriver = new MemorySessionDriver();

            // Request 1: Set flash data
            const session1 = new SessionStore("sess_456", memoryDriver);
            session1.flash("notice", "Logged in");
            await session1.save();

            // Request 2: Flash data becomes readable, but won't persist to Request 3 unless re-flashed
            const session2 = new SessionStore("sess_456", memoryDriver);
            await session2.load();
            expect(session2.get("notice")).toBe("Logged in");
            await session2.save();

            // Request 3: Flash data expired
            const session3 = new SessionStore("sess_456", memoryDriver);
            await session3.load();
            expect(session3.get("notice")).toBeUndefined();
        });
    });

    describe("FileSessionDriver", () => {
        let tmpDir: string;
        let fileDriver: FileSessionDriver;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strux-session-test-"));
            fileDriver = new FileSessionDriver(tmpDir);
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test("persists session data to file on disk", async () => {
            const session = new SessionStore("file_sess_1", fileDriver);
            session.put("token", "secret_abc");
            await session.save();

            const reloaded = new SessionStore("file_sess_1", fileDriver);
            await reloaded.load();

            expect(reloaded.get("token")).toBe("secret_abc");
        });
    });
});
