import { env } from "struxjs";

export default {
    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    */

    enabled: env("CORS_ENABLED", true),

    origin: ["*"],

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-XSRF-TOKEN"],

    exposedHeaders: [],

    credentials: true,

    maxAge: 86400,
};
