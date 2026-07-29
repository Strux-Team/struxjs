import { env } from "struxjs";

const mailConfig = {
    default: env("MAIL_MAILER", "log"),

    from: {
        address: env("MAIL_FROM_ADDRESS", "hello@example.com"),
        name: env("MAIL_FROM_NAME", "StruxJS App"),
    },

    mailers: {
        smtp: {
            driver: "smtp",
            host: env("MAIL_HOST", "127.0.0.1"),
            port: Number(env("MAIL_PORT", 587)),
            secure: env("MAIL_ENCRYPTION", "tls") === "ssl",
            username: env("MAIL_USERNAME", ""),
            password: env("MAIL_PASSWORD", ""),
            timeout: 30,
            fromAddress: env("MAIL_FROM_ADDRESS", "hello@example.com"),
            fromName: env("MAIL_FROM_NAME", "StruxJS App"),
        },

        mailgun: {
            driver: "mailgun",
            apiKey: env("MAILGUN_SECRET", ""),
            domain: env("MAILGUN_DOMAIN", ""),
            mailgunHost: env("MAILGUN_ENDPOINT", "api.mailgun.net"),
            fromAddress: env("MAIL_FROM_ADDRESS", "hello@example.com"),
            fromName: env("MAIL_FROM_NAME", "StruxJS App"),
        },

        log: {
            driver: "log",
            logPath: env("MAIL_LOG_PATH", ""),
        },

        array: {
            driver: "array",
        },
    },
};

export default mailConfig;
