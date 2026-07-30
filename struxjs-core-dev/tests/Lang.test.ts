import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { Lang, trans, __ } from "../src/index.js";

describe("Localization (Lang / i18n Engine)", () => {
    const langDir = path.join(process.cwd(), "resources", "lang");

    beforeEach(() => {
        Lang.clearCache();
        Lang.setLocale("en");
        if (!fs.existsSync(langDir)) {
            fs.mkdirSync(langDir, { recursive: true });
        }
    });

    afterEach(() => {
        Lang.clearCache();
        // Cleanup test files if created
        const enJson = path.join(langDir, "en.json");
        const viJson = path.join(langDir, "vi.json");
        if (fs.existsSync(enJson)) fs.unlinkSync(enJson);
        if (fs.existsSync(viJson)) fs.unlinkSync(viJson);
    });

    test("reads default locale and returns key when translation is missing", () => {
        expect(Lang.getLocale()).toBe("en");
        expect(Lang.get("messages.not_found")).toBe("messages.not_found");
    });

    test("translates keys from single locale JSON file with placeholders", () => {
        const enJson = path.join(langDir, "en.json");
        const viJson = path.join(langDir, "vi.json");

        fs.writeFileSync(enJson, JSON.stringify({
            welcome: "Welcome, :name!",
            "auth.failed": "These credentials do not match our records."
        }));

        fs.writeFileSync(viJson, JSON.stringify({
            welcome: "Chào mừng, :name!",
            "auth.failed": "Thông tin đăng nhập không chính xác."
        }));

        expect(Lang.get("welcome", { name: "Alex" })).toBe("Welcome, Alex!");
        expect(trans("auth.failed")).toBe("These credentials do not match our records.");

        // Switch to Vietnamese
        Lang.setLocale("vi");
        expect(__("welcome", { name: "Alex" })).toBe("Chào mừng, Alex!");
        expect(__("auth.failed")).toBe("Thông tin đăng nhập không chính xác.");
    });
});
