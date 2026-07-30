import { LogDriverInterface, LogLevel } from "./LogDriverInterface.js";
import { ConsoleLogDriver } from "./drivers/ConsoleLogDriver.js";
import { SingleFileLogDriver } from "./drivers/SingleFileLogDriver.js";
import { DailyFileLogDriver } from "./drivers/DailyFileLogDriver.js";
import { StackLogDriver } from "./drivers/StackLogDriver.js";
import { config, env } from "../config/Config.js";

export class Logger {
    private drivers: Map<string, LogDriverInterface> = new Map();

    public channel(channelName?: string): LogDriverInterface {
        const targetChannel: string = String(channelName || config("logging.default") || env("LOG_CHANNEL", "stack"));

        if (this.drivers.has(targetChannel)) {
            return this.drivers.get(targetChannel)!;
        }

        const driver = this.createDriver(targetChannel);
        this.drivers.set(targetChannel, driver);
        return driver;
    }

    private createDriver(channelName: string): LogDriverInterface {
        const loggingConfig = config(`logging.channels.${channelName}`) || {};
        const driverName = loggingConfig.driver || channelName;

        switch (driverName) {
            case "single":
                return new SingleFileLogDriver(loggingConfig);
            case "daily":
                return new DailyFileLogDriver(loggingConfig);
            case "console":
                return new ConsoleLogDriver();
            case "stack": {
                const subChannels: string[] = loggingConfig.channels || ["console", "daily"];
                const instances = subChannels.map(ch => this.channel(ch));
                return new StackLogDriver(instances);
            }
            default:
                return new ConsoleLogDriver();
        }
    }

    public emergency(message: string, context?: Record<string, any>): void {
        this.channel().log("emergency", message, context);
    }

    public alert(message: string, context?: Record<string, any>): void {
        this.channel().log("alert", message, context);
    }

    public critical(message: string, context?: Record<string, any>): void {
        this.channel().log("critical", message, context);
    }

    public error(message: string | Error, context?: Record<string, any>): void {
        const msg = message instanceof Error ? message.message : message;
        const ctx = message instanceof Error ? { stack: message.stack, ...context } : context;
        this.channel().log("error", msg, ctx);
    }

    public warning(message: string, context?: Record<string, any>): void {
        this.channel().log("warning", message, context);
    }

    public notice(message: string, context?: Record<string, any>): void {
        this.channel().log("notice", message, context);
    }

    public info(message: string, context?: Record<string, any>): void {
        this.channel().log("info", message, context);
    }

    public debug(message: string, context?: Record<string, any>): void {
        this.channel().log("debug", message, context);
    }
}

export const Log = new Logger();
