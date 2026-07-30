# Compiling Assets (Vite)

StruxJS integrates seamlessly with [Vite](https://vitejs.dev/) to provide instant Hot Module Replacement (HMR) during development and optimized, minified production asset bundles.

---

## Overview & Development Workflow

Asset compilation scripts are configured in `package.json`:

* `npm run dev:assets`: Launches the Vite development server on `http://localhost:5173` with instant HMR.
* `npm run build:assets`: Compiles, minifies, and outputs version-hashed assets into `public/build/` along with `.vite/manifest.json`.

---

## Injecting Assets in Views (`@vite`)

Use the `@vite()` directive inside your `.strux` view or layout templates to inject stylesheets and JavaScript entry points:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>StruxJS App</title>
    @vite('resources/css/app.css', 'resources/js/app.js')
</head>
<body>
    <div id="app"></div>
</body>
</html>
```

### How `@vite` Works Under the Hood

* **Development (`npm run dev:assets`)**: Automatically injects `@vite/client` and links assets directly to the local Vite dev server (`http://localhost:5173/resources/js/app.js`).
* **Production (`npm run build:assets`)**: Reads `public/build/.vite/manifest.json` and emits minified, cache-busted `<link rel="stylesheet">` and `<script type="module">` tags pointing to `public/build/assets/...`.

---

## Environment Variables (`VITE_DEV` & `VITE_PORT`)

StruxJS uses environment variables in `.env` to determine asset resolution mode:

```ini
# Vite Asset Compilation Settings
VITE_DEV=true
VITE_PORT=5173
```

### `VITE_DEV`
* **`true` (Development Mode)**: Instructs `@vite()` to inject Hot Module Replacement (HMR) scripts connected to the local Vite server (`http://localhost:5173/@vite/client`).
* **`false` (Production Mode)**: Instructs `@vite()` to resolve hashed, minified production assets from `public/build/.vite/manifest.json`.

### `VITE_PORT`
Defines the port for the Vite development server (defaults to `5173`). If you change `port` in `vite.config.ts`, update `VITE_PORT` in `.env` accordingly.

---

## Default `vite.config.ts`

StruxJS comes with a pre-configured `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
    plugins: [
        tailwindcss()
    ],
    root: path.resolve(__dirname),
    base: command === "serve" ? "/" : "/build/",
    build: {
        outDir: path.resolve(__dirname, "public/build"),
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {
            input: {
                app: path.resolve(__dirname, "resources/js/app.js"),
                "app-css": path.resolve(__dirname, "resources/css/app.css")
            }
        }
    },
    server: {
        port: 5173,
        strictPort: true,
        cors: { origin: "*" }
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "resources/js"),
            "@css": path.resolve(__dirname, "resources/css")
        }
    }
}));
```

---

## Setting Up Frontend Frameworks

### 1. Tailwind CSS (v4)

Tailwind CSS v4 is supported out of the box via `@tailwindcss/vite`.

Include the Tailwind directive in `resources/css/app.css`:

```css
@import "tailwindcss";
```

Inject the stylesheet in your view template:

```html
@vite('resources/css/app.css')
```

---

### 2. Setting Up React

To build single-page apps or mount interactive React components inside `.strux` views:

#### Step 1: Install React Dependencies

```bash
npm install react react-dom
npm install -D @vitejs/plugin-react @types/react @types/react-dom
```

#### Step 2: Configure `vite.config.ts`

Import `@vitejs/plugin-react` and add `react()` to your plugins array:

```typescript
import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        tailwindcss()
    ],
    // ...
    build: {
        rollupOptions: {
            input: {
                app: path.resolve(__dirname, "resources/js/app.jsx")
            }
        }
    }
}));
```

#### Step 3: Create Entry Component (`resources/js/app.jsx`)

```jsx
import React from "react";
import { createRoot } from "react-dom/client";

function App() {
    return (
        <div className="p-6 bg-blue-50 text-blue-900 rounded-lg">
            <h1 className="text-2xl font-bold">Hello from React in StruxJS!</h1>
        </div>
    );
}

const rootElement = document.getElementById("app");
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
```

#### Step 4: Include in View

```html
<div id="app"></div>
@vite('resources/js/app.jsx')
```

---

### 3. Setting Up Vue 3

To mount Vue 3 components inside `.strux` views:

#### Step 1: Install Vue Dependencies

```bash
npm install vue
npm install -D @vitejs/plugin-vue
```

#### Step 2: Configure `vite.config.ts`

Import `@vitejs/plugin-vue` and add `vue()` to your plugins array:

```typescript
import { defineConfig } from "vite";
import path from "path";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
    plugins: [
        vue(),
        tailwindcss()
    ],
    // ...
}));
```

#### Step 3: Create Vue Root Component (`resources/js/App.vue`)

```vue
<template>
  <div class="p-6 bg-emerald-50 text-emerald-900 rounded-lg">
    <h1 class="text-2xl font-bold">{{ message }}</h1>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const message = ref('Hello from Vue 3 in StruxJS!')
</script>
```

#### Step 4: Mount Vue in `resources/js/app.js`

```javascript
import { createApp } from 'vue'
import App from './App.vue'

const rootElement = document.getElementById('app')
if (rootElement) {
    const app = createApp(App)
    app.mount('#app')
}
```

#### Step 5: Include in View

```html
<div id="app"></div>
@vite('resources/js/app.js')
```

---

## Path Aliases

Vite path aliases allow clean imports without relative path nesting:

* `@`: Resolves to `resources/js/`
* `@css`: Resolves to `resources/css/`

Example import:

```javascript
import Button from "@/components/Button.jsx";
import "@css/app.css";
```
