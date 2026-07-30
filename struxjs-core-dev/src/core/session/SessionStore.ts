import crypto from "crypto";
import { SessionDriverInterface } from "./drivers/SessionDriverInterface.js";
import { FileSessionDriver } from "./drivers/FileSessionDriver.js";
import { MemorySessionDriver } from "./drivers/MemorySessionDriver.js";
import { DatabaseSessionDriver } from "./drivers/DatabaseSessionDriver.js";
import { RedisSessionDriver } from "./drivers/RedisSessionDriver.js";
import { config, env } from "../config/Config.js";

export class SessionStore {
    private id: string;
    private attributes: Record<string, any> = {};
    private flashData: Record<string, any> = {};
    private newFlashData: Record<string, any> = {};
    private isLoaded = false;
    private driver: SessionDriverInterface;
    private lifetimeMinutes: number;

    constructor(sessionId?: string, customDriver?: SessionDriverInterface, lifetimeMinutes = 120) {
        this.id = sessionId || crypto.randomBytes(24).toString("hex");
        this.lifetimeMinutes = lifetimeMinutes;

        if (customDriver) {
            this.driver = customDriver;
        } else {
            const driverName = (config("session.driver") || env("SESSION_DRIVER", "file")).toLowerCase();
            if (driverName === "memory") {
                this.driver = new MemorySessionDriver();
            } else if (driverName === "database") {
                const tableName = config("session.table") || env("SESSION_TABLE", "sessions");
                this.driver = new DatabaseSessionDriver(tableName);
            } else if (driverName === "redis") {
                this.driver = new RedisSessionDriver();
            } else {
                this.driver = new FileSessionDriver();
            }
        }
    }

    public getId(): string {
        return this.id;
    }

    public async load(): Promise<void> {
        if (this.isLoaded) return;
        this.isLoaded = true;

        const data = await this.driver.read(this.id);
        if (data) {
            this.attributes = data.attributes || {};
            this.flashData = data.newFlashData || {};
        } else {
            this.attributes = {};
            this.flashData = {};
        }
    }

    public get<T = any>(key: string, defaultValue?: T): T {
        if (this.attributes[key] !== undefined) return this.attributes[key];
        if (this.flashData[key] !== undefined) return this.flashData[key];
        return defaultValue as T;
    }

    public put(key: string, value: any): void {
        this.attributes[key] = value;
    }

    public set(key: string, value: any): void {
        this.put(key, value);
    }

    public has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    public exists(key: string): boolean {
        return this.has(key);
    }

    public forget(key: string): void {
        delete this.attributes[key];
        delete this.flashData[key];
    }

    public delete(key: string): void {
        this.forget(key);
    }

    public flush(): void {
        this.attributes = {};
        this.flashData = {};
        this.newFlashData = {};
    }

    public flash(key: string, value: any): void {
        this.newFlashData[key] = value;
    }

    public all(): Record<string, any> {
        return { ...this.attributes, ...this.flashData };
    }

    public regenerate(): string {
        this.driver.destroy(this.id);
        this.id = crypto.randomBytes(24).toString("hex");
        return this.id;
    }

    public async save(): Promise<void> {
        await this.driver.write(this.id, {
            attributes: this.attributes,
            newFlashData: this.newFlashData
        }, this.lifetimeMinutes);
    }
}
