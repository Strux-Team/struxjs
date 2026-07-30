import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Log } from "../src/core/log/Log.js";
import fs from "fs";
import path from "path";

describe("Logging System", () => {
    const testLogDir = path.join(process.cwd(), "storage", "test_logs");
    const singleLogPath = path.join(testLogDir, "single.log");

    beforeEach(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });

    it("writes logs using SingleFileLogDriver", async () => {
        const { SingleFileLogDriver } = await import("../src/core/log/drivers/SingleFileLogDriver.js");
        const driver = new SingleFileLogDriver({ path: singleLogPath });

        driver.log("info", "User logged in", { userId: 42 });

        // Wait brief tick for async append
        await new Promise(res => setTimeout(res, 50));

        expect(fs.existsSync(singleLogPath)).toBe(true);
        const content = fs.readFileSync(singleLogPath, "utf8");
        expect(content).toContain("INFO: User logged in {\"userId\":42}");
    });

    it("writes daily logs using DailyFileLogDriver", async () => {
        const { DailyFileLogDriver } = await import("../src/core/log/drivers/DailyFileLogDriver.js");
        const driver = new DailyFileLogDriver({ path: path.join(testLogDir, "app.log"), days: 7 });

        driver.log("error", "Database connection lost");

        await new Promise(res => setTimeout(res, 50));

        const today = new Date().toISOString().split("T")[0];
        const expectedFile = path.join(testLogDir, `app-${today}.log`);

        expect(fs.existsSync(expectedFile)).toBe(true);
        const content = fs.readFileSync(expectedFile, "utf8");
        expect(content).toContain("ERROR: Database connection lost");
    });

    it("supports Log facade convenience methods", () => {
        expect(typeof Log.info).toBe("function");
        expect(typeof Log.error).toBe("function");
        expect(typeof Log.warning).toBe("function");
        expect(typeof Log.debug).toBe("function");
        expect(typeof Log.channel).toBe("function");
    });
});
