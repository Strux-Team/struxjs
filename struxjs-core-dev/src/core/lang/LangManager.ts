import fs from "fs";
import path from "path";
import { config, env } from "../config/Config.js";

export class LangManager {
    private static locale: string | null = null;
    private static fallbackLocale: string = "en";
    private static translationsCache: Map<string, Record<string, any>> = new Map();

    /**
     * Get current active locale (e.g. 'en', 'vi')
     */
    public static getLocale(): string {
        if (this.locale) return this.locale;
        return config("app.locale") || env("APP_LOCALE", "en");
    }

    /**
     * Set current active locale dynamically
     */
    public static setLocale(locale: string): void {
        this.locale = locale;
    }

    /**
     * Get fallback locale
     */
    public static getFallbackLocale(): string {
        return config("app.fallback_locale") || env("APP_FALLBACK_LOCALE", "en") || this.fallbackLocale;
    }

    /**
     * Set fallback locale
     */
    public static setFallbackLocale(locale: string): void {
        this.fallbackLocale = locale;
    }

    /**
     * Load translations dictionary for a specific locale
     */
    private static loadLocaleData(locale: string): Record<string, any> {
        if (this.translationsCache.has(locale)) {
            return this.translationsCache.get(locale)!;
        }

        const langDir = path.join(process.cwd(), "resources", "lang");
        const merged: Record<string, any> = {};

        if (!fs.existsSync(langDir)) {
            this.translationsCache.set(locale, merged);
            return merged;
        }

        // 1. Check for single JSON file e.g. resources/lang/en.json
        const jsonFile = path.join(langDir, `${locale}.json`);
        if (fs.existsSync(jsonFile)) {
            try {
                const content = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
                Object.assign(merged, content);
            } catch {}
        }

        // 2. Check for subfolder e.g. resources/lang/en/*.json
        const localeSubdir = path.join(langDir, locale);
        if (fs.existsSync(localeSubdir) && fs.statSync(localeSubdir).isDirectory()) {
            const files = fs.readdirSync(localeSubdir);
            for (const file of files) {
                if (file.endsWith(".json")) {
                    const groupName = path.basename(file, ".json");
                    try {
                        const content = JSON.parse(fs.readFileSync(path.join(localeSubdir, file), "utf-8"));
                        merged[groupName] = content;
                    } catch {}
                }
            }
        }

        this.translationsCache.set(locale, merged);
        return merged;
    }

    /**
     * Clear cached translations in memory (useful for testing or hot-reloading)
     */
    public static clearCache(): void {
        this.translationsCache.clear();
    }

    /**
     * Retrieve translation string for a given key with optional placeholder replacements
     * @param key Key string e.g. "auth.failed" or "Welcome, :name"
     * @param replace Optional object containing replacements e.g. { name: "Alex" }
     * @param locale Optional override locale
     */
    public static get(key: string, replace: Record<string, any> = {}, locale?: string): string {
        const activeLocale = locale || this.getLocale();
        const fallback = this.getFallbackLocale();

        let translation = this.resolveKey(key, activeLocale);

        if (translation === undefined && activeLocale !== fallback) {
            translation = this.resolveKey(key, fallback);
        }

        if (translation === undefined || typeof translation !== "string") {
            translation = key;
        }

        // Perform placeholder replacements e.g. :name or {name}
        for (const [param, val] of Object.entries(replace)) {
            const replacementValue = String(val);
            translation = translation.replace(new RegExp(`:${param}`, "g"), replacementValue);
            translation = translation.replace(new RegExp(`\\{${param}\\}`, "g"), replacementValue);
        }

        return translation;
    }

    /**
     * Check if a translation key exists
     */
    public static has(key: string, locale?: string): boolean {
        const activeLocale = locale || this.getLocale();
        const translation = this.resolveKey(key, activeLocale);
        return translation !== undefined;
    }

    private static resolveKey(key: string, locale: string): any {
        const dict = this.loadLocaleData(locale);

        // Direct key lookup in dict (e.g. dict["Welcome back"])
        if (dict[key] !== undefined) {
            return dict[key];
        }

        // Nested dot notation lookup e.g. "auth.failed" -> dict["auth"]["failed"]
        const parts = key.split(".");
        let current: any = dict;
        for (const part of parts) {
            if (current && typeof current === "object" && part in current) {
                current = current[part];
            } else {
                return undefined;
            }
        }
        return current;
    }
}

/**
 * Global helper trans() / __()
 */
export function trans(key: string, replace: Record<string, any> = {}, locale?: string): string {
    return LangManager.get(key, replace, locale);
}

export function __(key: string, replace: Record<string, any> = {}, locale?: string): string {
    return LangManager.get(key, replace, locale);
}

export const Lang = LangManager;
