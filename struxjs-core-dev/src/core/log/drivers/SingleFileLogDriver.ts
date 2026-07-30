import fs from "fs";
import path from "path";
import { LogDriverInterface, LogLevel } from "../LogDriverInterface.js";

export class SingleFileLogDriver implements LogDriverInterface {
    private filePath: string;

    constructor(options?: { path?: string }) {
        const rawPath = options?.path || "storage/logs/strux.log";
        this.filePath = path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
        this.ensureDirectoryExists();
    }

    private ensureDirectoryExists(): void {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    public log(level: LogLevel, message: string, context?: Record<string, any>): void {
        const timestamp = new Date().toISOString();
        const contextStr = context && Object.keys(context).length > 0 ? " " + JSON.stringify(context) : "";
        const line = `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}\n`;

        fs.appendFile(this.filePath, line, (err) => {
            if (err) {
                console.error("[StruxJS Logger Error]: Failed to write to log file:", err.message);
            }
        });
    }
}
