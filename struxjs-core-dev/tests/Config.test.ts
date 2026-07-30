import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { Container, ConfigManager, Config, config } from "../src/index.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("ConfigManager and config() Helper", () => {
    let tmpDir: string;
    let container: Container;

    beforeEach(() => {
        container = new Container();
        ConfigManager.clear();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strux-config-test-"));
        fs.mkdirSync(path.join(tmpDir, "config"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("loads .env and config files into IoC container singletons and Config store", async () => {
        // Write .env
        fs.writeFileSync(path.join(tmpDir, ".env"), "TEST_APP_NAME=StruxApp\n");

        // Write config/app.js
        fs.writeFileSync(
            path.join(tmpDir, "config", "app.js"),
            "export default { name: process.env.TEST_APP_NAME || 'Default', env: 'testing', database: { host: '127.0.0.1' } };"
        );

        const manager = new ConfigManager(container);
        await manager.load(tmpDir);

        const appConfig = container.make<{ name: string; env: string }>("config.app");
        expect(appConfig).toBeDefined();
        expect(appConfig.name).toBe("StruxApp");
        expect(appConfig.env).toBe("testing");

        // Test Config facade and config() helper
        expect(config("app.name")).toBe("StruxApp");
        expect(config("app.database.host")).toBe("127.0.0.1");
        expect(config("app.non_existent", "fallback")).toBe("fallback");

        expect(Config.get("app.name")).toBe("StruxApp");
        expect(Config.has("app.env")).toBe(true);

        // Test setting values dynamically
        config({ "app.debug": true });
        expect(config("app.debug")).toBe(true);
    });

    test("env() helper function reads environment variables with smart type casting and fallback", async () => {
        const { env } = await import("../src/index.js");

        process.env.TEST_STR = "Hello";
        process.env.TEST_BOOL_TRUE = "true";
        process.env.TEST_BOOL_FALSE = "false";
        process.env.TEST_NULL = "null";

        expect(env("TEST_STR")).toBe("Hello");
        expect(env("TEST_BOOL_TRUE")).toBe(true);
        expect(env("TEST_BOOL_FALSE")).toBe(false);
        expect(env("TEST_NULL")).toBe(null);
        expect(env("NON_EXISTENT_VAR", "default_val")).toBe("default_val");
    });

    test("now() helper sets process.env.TZ and returns Date instance", async () => {
        const { now } = await import("../src/index.js");

        const date = now("Asia/Ho_Chi_Minh");
        expect(date instanceof Date).toBe(true);
        expect(process.env.TZ).toBe("Asia/Ho_Chi_Minh");
    });
});
