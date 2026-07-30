# create-struxjs-app

The official scaffolding CLI tool for **StruxJS** – a powerful, modern Node.js framework for crafting robust APIs and Web applications with a clean, Laravel-inspired architecture.

## Installation

You do not need to install this package globally. You can use `npx` to bootstrap a new project anywhere on your system:

```bash
npx create-struxjs-app my-awesome-project
```

Alternatively, you can initialize a project in the current directory (ensure it is empty):

```bash
npx create-struxjs-app .
```

## What it does

When you run this CLI tool, it will:
1. Scaffold a clean, optimized StruxJS directory structure (Controllers, Models, Middlewares, etc.)
2. Automatically copy and set up your `.env` configuration file
3. Generate a secure `APP_KEY` and `JWT_SECRET` for your application
4. Set up the correct `storage/public` symlinks for asset handling
5. Run `npm install` to prepare all dependencies
6. Provide you with the official StruxJS VSCode extension (`.vsix`) for optimal Developer Experience

## Running your new project

Once the scaffolding is complete, jump into your new project and start the development server:

```bash
cd my-awesome-project
npm run dev
```

For more comprehensive documentation on routing, models, caching, and more, please visit the [StruxJS Official Documentation](https://struxjs.vercel.app).

## License

This project is licensed under the MIT License.
