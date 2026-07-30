import { env } from "struxjs";

export default {
    driver: env("SESSION_DRIVER", "file"),
    lifetime: Number(env("SESSION_LIFETIME", 120)),
    table: env("SESSION_TABLE", "sessions"),
    cookie: env("SESSION_COOKIE", "struxjs_session"),
    path: "/",
    domain: env("SESSION_DOMAIN", undefined),
    secure: env("SESSION_SECURE", false),
    http_only: true,
    same_site: "lax" as const
};
