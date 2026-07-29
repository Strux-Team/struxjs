import { env } from "struxjs";

export default {
    /*
    |--------------------------------------------------------------------------
    | Default Log Channel
    |--------------------------------------------------------------------------
    |
    | This option controls the default log channel that gets used when
    | writing messages to the logs. The name specified here should
    | match one of the channels defined in the "channels" array below.
    |
    */
    default: env("LOG_CHANNEL", "stack"),

    /*
    |--------------------------------------------------------------------------
    | Log Channels
    |--------------------------------------------------------------------------
    |
    | Here you may configure the log channels for your application.
    | Available Drivers: "single", "daily", "console", "stack"
    |
    */
    channels: {
        stack: {
            driver: "stack",
            channels: ["console", "daily"]
        },

        single: {
            driver: "single",
            path: "storage/logs/strux.log",
            level: env("LOG_LEVEL", "debug")
        },

        daily: {
            driver: "daily",
            path: "storage/logs/strux.log",
            days: 14,
            level: env("LOG_LEVEL", "debug")
        },

        console: {
            driver: "console",
            level: env("LOG_LEVEL", "debug")
        }
    }
};
