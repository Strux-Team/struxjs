import { env } from "struxjs";

export default {
    name: env("APP_NAME", "StruxJS Framework"),
    env: env("APP_ENV", "development"),
    debug: env("APP_DEBUG", true),
    url: env("APP_URL", "http://localhost:3000"),
    port: env("PORT", 3000),
    host: env("HOST", "127.0.0.1"),
    key: env("APP_KEY", "struxjs_secret_app_key_32bytes_long"),
    timezone: env("APP_TIMEZONE", "UTC"),
    locale: env("APP_LOCALE", "en"),
};
