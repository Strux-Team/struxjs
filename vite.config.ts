import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
    /*
    |--------------------------------------------------------------------------
    | Plugins
    |--------------------------------------------------------------------------
    */
    plugins: [
        tailwindcss()
    ],

    /*
    |--------------------------------------------------------------------------
    | Root — Vite serves files relative to this directory in dev mode
    |--------------------------------------------------------------------------
    */
    root: path.resolve(__dirname),

    /*
    |--------------------------------------------------------------------------
    | Base path
    | Dev:        "/"  — Vite serves at localhost:5173/<file>
    | Production: "/build/" — assets live under public/build/
    |--------------------------------------------------------------------------
    */
    base: command === "serve" ? "/" : "/build/",

    /*
    |--------------------------------------------------------------------------
    | Build
    |--------------------------------------------------------------------------
    */
    build: {
        outDir: path.resolve(__dirname, "public/build"),
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {
            input: {
                app:     path.resolve(__dirname, "resources/js/app.js"),
                "app-css": path.resolve(__dirname, "resources/css/app.css"),
            }
        }
    },

    /*
    |--------------------------------------------------------------------------
    | Dev Server
    |--------------------------------------------------------------------------
    */
    server: {
        port: 5173,
        strictPort: true,
        cors: { origin: "*" },
        watch: {
            // Only watch resources/ — ignore everything else (storage, dist, node_modules, etc.)
            // This prevents infinite reload loops caused by session/log/cache file writes
            ignored: [
                "**/node_modules/**",
                "**/dist/**",
                "**/storage/**",
                "**/public/**",
                "**/database/**",
                "**/.git/**",
                "**/bootstrap.ts",
                "**/app/**",
                "**/config/**",
                "**/routes/**",
            ]
        }
    },

    /*
    |--------------------------------------------------------------------------
    | Aliases
    |--------------------------------------------------------------------------
    */
    resolve: {
        alias: {
            "@":    path.resolve(__dirname, "resources/js"),
            "@css": path.resolve(__dirname, "resources/css"),
        }
    }
}));
