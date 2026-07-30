import { LogDriverInterface, LogLevel } from "../LogDriverInterface.js";

export class StackLogDriver implements LogDriverInterface {
    constructor(private drivers: LogDriverInterface[]) {}

    public log(level: LogLevel, message: string, context?: Record<string, any>): void {
        for (const driver of this.drivers) {
            try {
                driver.log(level, message, context);
            } catch (err: any) {
                console.error("[StruxJS StackLogDriver Error]:", err.message);
            }
        }
    }
}
