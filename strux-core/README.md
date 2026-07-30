<div align="center">
  <h1>StruxJS Core Engine</h1>
</div>

<p align="center">
  <strong>The underlying framework engine for StruxJS.</strong><br>
  Built for speed with Fastify, designed for developer happiness.
</p>

---

## What is this?

This repository contains the **Core Engine** of the StruxJS framework. It includes the IoC Container, the Active Record ORM, the HTTP Router (Fastify wrapper), and all fundamental services (Mail, Queue, Cache, Session, Broadcasting).

**If you are looking to start a new StruxJS project, DO NOT install this package manually.** Instead, use our official scaffolding CLI:

```bash
npx create-struxjs-app my-awesome-project
```

Visit the [Official Documentation](https://struxjs.vercel.app) to learn more about building applications with StruxJS.

## Manual Installation

If you are building an extension or a custom integration and need to install the core package directly:

```bash
npm install struxjs-core
```

## Contributing to the Core

We welcome contributions to the StruxJS Core Engine! 

1. Clone the main monorepo: `git clone https://github.com/Strux-Team/struxjs.git`
2. Navigate to this package: `cd strux-core`
3. Install dependencies from the root: `npm install`
4. Compile your TypeScript changes: `npm run build`

*For active local development, we recommend running the sandbox application at the root of the monorepo, which automatically live-reloads changes made to this core package.*

---

## License

The StruxJS Core is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
