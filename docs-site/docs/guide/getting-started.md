# Getting Started

This guide walks through creating and running a new StruxJS application.

---

## Prerequisites

Ensure your system meets the following requirements before installing StruxJS:

* **Node.js**: Version 18.0.0 or higher
* **Package Manager**: npm (v9+), pnpm, or yarn

---

## Creating a New Project

Use `npx create-struxjs-app` to scaffold a new application. The CLI automatically sets up the project directory, installs required dependencies, and configures default environment variables:

```bash
npx create-struxjs-app my-app
```

Alternatively, run:

```bash
npm create strux-app@latest my-app
```

Once installation completes, navigate to your project directory:

```bash
cd my-app
```

---

## Running the Application

### Development Mode

Start the backend application server with live reload enabled:

```bash
npm run dev
```

The application server will boot and listen at `http://localhost:3000`.

### Development Assets Mode

To compile and hot-reload frontend assets (Vite / Tailwind CSS) during development, run:

```bash
npm run dev:assets
```

---

## Production Deployment

### Building Backend Code

Compile TypeScript source files for production:

```bash
npm run build
```

Start the compiled backend production server:

```bash
npm start
```

### Building Frontend Assets

Compile and minify frontend assets for production:

```bash
npm run build:assets
```
