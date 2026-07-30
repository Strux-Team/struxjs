import fs from "fs";
import path from "path";
import { LogDriverInterface, LogLevel } from "../LogDriverInterface.js";

export class DailyFileLogDriver implements LogDriverInterface {
    private baseDir: string;
    private filePrefix: string;
    private maxDays: number;

    constructor(options?: { path?: string; days?: number }) {
        const rawPath = options?.path || "storage/logs/strux.log";
        const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);

        this.baseDir = path.dirname(absolutePath);
        const ext = path.extname(absolutePath) || ".log";
        const basename = path.basename(absolutePath, ext);
        this.filePrefix = basename;
        this.maxDays = options?.days || 14;

        this.ensureDirectoryExists();
    }

    private ensureDirectoryExists(): void {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    private getTodayFilePath(): string {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        return path.join(this.baseDir, `${this.filePrefix}-${today}.log`);
    }

    private pruneOldLogs(): void {
        try {
            const files = fs.readdirSync(this.baseDir);
            const now = Date.now();
            const maxAgeMs = this.maxDays * 24 * 60 * 60 * 1000;

            for (const file of files) {
                if (file.startsWith(this.filePrefix + "-") && file.endsWith(".log")) {
                    const filePath = path.join(this.baseDir, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        } catch {
            // Silence background pruning errors
        }
    }

    public log(level: LogLevel, message: string, context?: Record<string, any>): void {
        this.ensureDirectoryExists();
        const filePath = this.getTodayFilePath();
        const timestamp = new Date().toISOString();
        const contextStr = context && Object.keys(context).length > 0 ? " " + JSON.stringify(context) : "";
        const line = `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}\n`;

        fs.appendFile(filePath, line, (err) => {
            if (err) {
                console.error("[StruxJS Logger Error]: Failed to write daily log file:", err.message);
            }
        });

        // Periodically prune old log files
        this.pruneOldLogs();
    }
}
