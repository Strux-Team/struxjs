import { defineConfig } from "vitepress";

export default defineConfig({
  title: "StruxJS Docs",
  description: "Official Documentation for StruxJS Framework",
  cleanUrls: true,

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/struxjs_icon.png" }],
  ],

  themeConfig: {
    siteTitle: "StruxJS",
    logo: "/struxjs_icon.png",

    nav: [
      { text: "Getting Started", link: "/guide/getting-started" },
      { text: "Routing", link: "/guide/routing" },
      { text: "Controllers", link: "/guide/controllers" },
      { text: "Middleware", link: "/guide/middleware" },
      {
        text: "Core Architecture",
        items: [
          { text: "Container & IoC", link: "/guide/container" },
          { text: "Database & ORM", link: "/orm/getting-started" },
          { text: "Cache & Redis", link: "/guide/cache" },
          { text: "Queue & Jobs", link: "/guide/queue" },
          { text: "Events & Scheduling", link: "/guide/events" }
        ]
      }
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is StruxJS?", link: "/guide/what-is-struxjs" },
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Directory Structure", link: "/guide/directory-structure" }
        ]
      },
      {
        text: "HTTP & Basics",
        items: [
          { text: "Routing", link: "/guide/routing" },
          { text: "Controllers", link: "/guide/controllers" },
          { text: "Middleware", link: "/guide/middleware" },
          { text: "Validation", link: "/guide/validation" },
          { text: "HTTP Request", link: "/guide/request" },
          { text: "HTTP Response", link: "/guide/response" },
          { text: "Cookies", link: "/guide/cookies" },
          { text: "File Uploads & Storage", link: "/guide/file-uploads" },
          { text: "Views & .strux Engine", link: "/guide/views" },
          { text: "Localization (i18n)", link: "/guide/localization" },
          { text: "Compiling Assets (Vite)", link: "/guide/vite" },
          { text: "Debugging & Dump", link: "/guide/debugging" }
        ]
      },
      {
        text: "ORM & Database",
        items: [
          { text: "Getting Started", link: "/orm/getting-started" },
          { text: "Models", link: "/orm/models" },
          { text: "Migrations", link: "/orm/migrations" },
          { text: "Seeders & Factories", link: "/orm/seeders" },
          { text: "Collection", link: "/orm/collection" },
          { text: "Relationships", link: "/orm/relationships" },
          { text: "Query Filters & Scopes", link: "/orm/queries" },
          { text: "Aggregations & Grouping", link: "/orm/aggregates" },
          { text: "Raw SQL Queries", link: "/orm/raw-queries" },
          { text: "Pagination", link: "/orm/pagination" }
        ]
      },
      {
        text: "Architecture & Services",
        items: [
          { text: "Service Container & IoC", link: "/guide/container" },
          { text: "Console Commands", link: "/guide/console" },
          { text: "API Resources", link: "/guide/resources" },
          { text: "Mail", link: "/guide/mail" },
          { text: "Cache & Redis", link: "/guide/cache" },
          { text: "Redis", link: "/guide/redis" },
          { text: "Session", link: "/guide/session" },
          { text: "Queue & Background Workers", link: "/guide/queue" },
          { text: "Task Scheduler", link: "/guide/scheduling" },
          { text: "Event System", link: "/guide/events" },
          { text: "Broadcasting & WebSocket", link: "/guide/broadcasting" },
          { text: "Concurrency & Node.js", link: "/guide/concurrency" }
        ]
      },
      {
        text: "Security",
        items: [
          { text: "Authentication", link: "/security/auth" },
          { text: "Authorization", link: "/security/authorization" },
          { text: "CORS", link: "/security/cors" }
        ]
      }
    ],

    search: {
      provider: "local"
    },

    socialLinks: [
      { icon: "github", link: "https://github.com" }
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 StruxJS Team"
    }
  }
});
