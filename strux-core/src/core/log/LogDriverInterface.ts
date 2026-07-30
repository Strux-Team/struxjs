export type LogLevel = "emergency" | "alert" | "critical" | "error" | "warning" | "notice" | "info" | "debug";

export interface LogDriverInterface {
    log(level: LogLevel, message: string, context?: Record<string, any>): void | Promise<void>;
}
