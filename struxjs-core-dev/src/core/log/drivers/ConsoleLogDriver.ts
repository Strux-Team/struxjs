import { LogDriverInterface, LogLevel } from "../LogDriverInterface.js";

export class ConsoleLogDriver implements LogDriverInterface {
    private colors: Record<LogLevel, string> = {
        emergency: "\x1b[41m\x1b[37m", // Red bg
        alert:     "\x1b[41m\x1b[37m",
        critical:  "\x1b[31m",       // Red
        error:     "\x1b[31m",       // Red
        warning:   "\x1b[33m",       // Yellow
        notice:    "\x1b[36m",       // Cyan
        info:      "\x1b[32m",       // Green
        debug:     "\x1b[90m"        // Gray
    };

    public log(level: LogLevel, message: string, context?: Record<string, any>): void {
        const timestamp = new Date().toISOString();
        const color = this.colors[level] || "\x1b[0m";
        const reset = "\x1b[0m";

        const contextStr = context && Object.keys(context).length > 0 ? " " + JSON.stringify(context) : "";
        const formatted = `[${timestamp}] ${color}${level.toUpperCase()}${reset}: ${message}${contextStr}`;

        if (level === "error" || level === "critical" || level === "emergency") {
            console.error(formatted);
        } else if (level === "warning") {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
    }
}
