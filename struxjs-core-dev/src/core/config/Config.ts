import { Container } from "../container/Container.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export class ConfigManager {
    private static store: Record<string, any> = {};

    constructor(private container: Container) { }

    /**
     * Load .env file and boot all configuration files into the container & Config store
     * @param appRootPath The absolute path to the root of the application
     */
    public async load(appRootPath: string): Promise<void> {
        // 1. Load .env file variables into process.env
        const envPath = path.join(appRootPath, ".env");
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath });
        }

        // 2. Scan the config/ directory of the application
        const configDir = path.join(appRootPath, "config");
        if (!fs.existsSync(configDir)) {
            return;
        }

        const files = fs.readdirSync(configDir);

        for (const file of files) {
            // Only process JavaScript or TypeScript files
            if (file.endsWith(".ts") || file.endsWith(".js")) {
                const configName = path.parse(file).name; // e.g., 'database' or 'app'
                const filePath = path.join(configDir, file);

                // Dynamically import the configuration file
                // Using file:// URL protocol to ensure ES Modules compatibility on Windows/Linux
                const fileUrl = pathToFileURL(filePath).href;
                const module = await import(fileUrl);

                // Extract the default export object from the config file
                const configValues = module.default || module;

                // Store in static repository
                ConfigManager.store[configName] = configValues;

                // 3. Bind to the container using a flat string token standard: 'config.filename'
                this.container.singleton(`config.${configName}`, () => configValues);
            }
        }
    }

    public static getStore(): Record<string, any> {
        return this.store;
    }

    public static set(key: string, value: any): void {
        const parts = key.split(".");
        let current = this.store;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part] || typeof current[part] !== "object") {
                current[part] = {};
            }
            current = current[part];
        }

        current[parts[parts.length - 1]] = value;
    }

    public static get<T = any>(key?: string, defaultValue?: any): T {
        if (!key) {
            return this.store as T;
        }

        const parts = key.split(".");
        let current: any = this.store;

        for (const part of parts) {
            if (current === undefined || current === null || typeof current !== "object") {
                return defaultValue;
            }
            current = current[part];
        }

        return current !== undefined ? current : defaultValue;
    }

    public static has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    public static clear(): void {
        this.store = {};
    }
}

/**
 * Static Config Facade
 */
export class Config {
    public static get<T = any>(key?: string, defaultValue?: any): T {
        return ConfigManager.get<T>(key, defaultValue);
    }

    public static set(key: string, value: any): void {
        ConfigManager.set(key, value);
    }

    public static has(key: string): boolean {
        return ConfigManager.has(key);
    }

    public static all(): Record<string, any> {
        return ConfigManager.getStore();
    }
}

/**
 * Global config() helper function
 * Usage:
 *   config('app.name')                     // 'StruxJS App'
 *   config('database.default', 'mysql')     // 'mysql'
 *   config({ 'app.debug': false })         // Sets config
 *   config()                              // Returns all config store
 */
export function config<T = any>(key?: string | Record<string, any>, defaultValue?: any): T {
    if (typeof key === "object" && key !== null) {
        for (const [k, v] of Object.entries(key)) {
            ConfigManager.set(k, v);
        }
        return undefined as any;
    }
    return ConfigManager.get<T>(key as string, defaultValue);
}

/**
 * Global env() helper function to read environment variables with smart type casting and fallback.
 * Usage:
 *   env('APP_NAME', 'StruxJS App')
 *   env('APP_DEBUG', false)
 *   env('DB_PORT', 3306)
 */
export function env<T = any>(key: string, defaultValue?: any): T {
    const val = process.env[key];

    if (val === undefined || val === null) {
        return defaultValue;
    }

    const lower = val.trim().toLowerCase();

    switch (lower) {
        case "true":
        case "(true)":
            return true as unknown as T;
        case "false":
        case "(false)":
            return false as unknown as T;
        case "empty":
        case "(empty)":
            return "" as unknown as T;
        case "null":
        case "(null)":
            return null as unknown as T;
    }

    return val as unknown as T;
}

/**
 * Global now() helper function returning Date instance configured for application timezone or custom timezone.
 * Usage:
 *   now()                          // Current Date in APP_TIMEZONE
 *   now('Asia/Ho_Chi_Minh')        // Current Date in Asia/Ho_Chi_Minh
 */
export function now(timezone?: string): Date {
    const tz = timezone || config("app.timezone") || process.env.APP_TIMEZONE || process.env.TZ || "UTC";
    if (tz) {
        process.env.TZ = tz;
    }
    return new Date();
}

/**
 * Global environment() helper function to check or retrieve application environment (APP_ENV).
 * Usage:
 *   environment()                      // returns current APP_ENV string e.g. "development", "staging", "production"
 *   environment('production')          // returns boolean (true if APP_ENV === 'production')
 *   environment('staging', 'local')    // returns boolean (true if APP_ENV is 'staging' or 'local')
 */
export function environment(...envs: string[]): any {
    const current = (config("app.env") || process.env.APP_ENV || process.env.NODE_ENV || "development").toString();
    if (envs.length === 0) return current;
    return envs.includes(current);
}
