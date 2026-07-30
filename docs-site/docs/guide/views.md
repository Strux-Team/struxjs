# Views & `.strux` Template Engine

StruxJS includes a built-in server-side template engine (`.strux`) featuring layout inheritance, partial subviews, conditional logic, loops, XSS-safe escaping, form helpers, authorization guards, and Vite asset integration.

---

## Creating Views & Layouts via CLI

StruxJS provides CLI commands for generating view templates and layout scaffolds inside `resources/views/`.

### Generate a View Template (`make:view`)

Create a view template using dot notation or slash path:

```bash
npx strux make:view users.index
```

Creates `resources/views/users/index.strux` with default layout scaffolding.

### Generate a Layout Template (`make:layout`)

Create a master layout scaffold inside `resources/views/layouts/`:

```bash
npx strux make:layout app
```

Creates `resources/views/layouts/app.strux`.

---

## Template Extension & Directory Location

View templates are stored inside `resources/views/` using the `.strux` file extension.

Render templates from Controllers or Routes using dot notation:

```typescript
// Renders: resources/views/users/profile.strux
return response.view("users.profile", { user });
```

Or using the global `view()` helper:

```typescript
import { view } from "struxjs";

return view("dashboard", { stats });
```

## Sharing Data with All Views (Global Helpers)

Occasionally, you may need to share specific data or custom helper functions across all views rendered by your application. You can do this using the `TemplateEngine.share()` method. 

The best place to register global view helpers is within the `boot` method of your `AppServiceProvider`:

```typescript
// app/Providers/AppServiceProvider.ts
import { TemplateEngine } from "struxjs";

export class AppServiceProvider {
    public async boot() {
        // Register a global helper function
        TemplateEngine.share("formatDate", (dateStr: string) => {
            const date = new Date(dateStr);
            return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
        });
        
        // Share a global variable
        TemplateEngine.share("appName", "StruxJS App");
    }
}
```

Once shared, you can access these variables or functions directly in **any** `.strux` view without explicitly passing them from your controllers:

```html
<!-- Renders: StruxJS App -->
<h1>{{ appName }}</h1>

<!-- Calls the global helper -->
<p>Created: {{ formatDate(user.created_at) }}</p>
```

---

## Syntax & Output Escaping

::: v-pre
### 1. Escaped Output (`{{ }}`)
Values rendered inside double curly braces `{{ }}` are automatically escaped using `__escapeHtml` to prevent XSS (Cross-Site Scripting) attacks:

```html
<h1>Hello, {{ user.name }}!</h1>
```

### 2. Unescaped Raw Output (`{!! !!}`)
Render unescaped HTML content using `{!! !!}`:

```html
<div class="content">
    {!! post.renderedContent !!}
</div>
```

### 3. Server-Side Comments (`{{-- --}}`)
Comments wrapped inside `{{-- --}}` are stripped during template compilation:

```html
{{-- This is a hidden server-side comment --}}
```

### 4. Raw Blocks (`@verbatim`)
Wrap blocks in `@verbatim ... @endverbatim` to output raw syntax without directive parsing (useful for Vue or Alpine.js syntax):

```html
@verbatim
    <div v-for="item in items">
        {{ item.title }}
    </div>
@endverbatim
```

### 5. Raw Code Exec (`@js`)
Execute raw TypeScript / JavaScript statements:

```html
@js
    const timestamp = Date.now();
@endjs
```

### 6. JSON Serialization (`@json`)
Serialize variables or objects directly to JSON string format:

```html
<script>
    const userData = @json(user);
</script>
```
:::

---

## Control Structures & Directives

::: v-pre
### Conditionals (`@if`, `@unless`, `@isset`, `@empty`)

```html
@if(user.role === 'admin')
    <p>Admin Dashboard</p>
@elseif(user.role === 'editor')
    <p>Editor Panel</p>
@else
    <p>User Profile</p>
@endif
```

```html
@unless(user.isBanned)
    <p>Welcome back!</p>
@endunless

@isset(user.avatar)
    <img src="{{ user.avatar }}" alt="Avatar" />
@endisset

@empty(users)
    <p>No users found.</p>
@endempty
```

### Loops (`@foreach`, `@forelse`)

#### `@foreach`
Iterate over arrays or iterable collections:

```html
<ul>
@foreach(users as user)
    <li>{{ user.name }} (Index: {{ loop.index }}, Count: {{ loop.count }})</li>
@endforeach
</ul>
```

Inside `@foreach` loops, the `loop` object provides iteration metadata:
* `loop.index`: Current 0-based index.
* `loop.iteration`: Current 1-based iteration counter.
* `loop.first`: Returns `true` on the first iteration.
* `loop.last`: Returns `true` on the last iteration.
* `loop.count`: Total item count in the collection.

#### `@forelse`
Combines a loop with an `@empty` fallback block:

```html
@forelse(posts as post)
    <article>
        <h2>{{ post.title }}</h2>
    </article>
@empty
    <p>No blog posts published yet.</p>
@endforelse
```

### Authorization Guards (`@auth`, `@guest`, `@role`, `@can`)

```html
@auth
    <p>Welcome, {{ user.name }}</p>
@endauth

@guest
    <a href="/login">Please Log In</a>
@endguest

@role('admin')
    <button>Admin Settings</button>
@endrole

@can('edit-post')
    <button>Edit Post</button>
@endcan
```
:::

---

## Form Directives

### `@csrf`
Generates a hidden HTML input containing the active request's CSRF token:

```html
<form action="/login" method="POST">
    @csrf
    <!-- Generates: <input type="hidden" name="_token" value="..."> -->
</form>
```

### `@method('PUT')`
Spoofs HTTP methods (`PUT`, `PATCH`, `DELETE`) in standard HTML forms:

```html
<form action="/users/42" method="POST">
    @csrf
    @method('PUT')
    <!-- Generates: <input type="hidden" name="_method" value="PUT"> -->
</form>
```

::: v-pre
### `@error('field')`
Renders a block when validation errors exist for the specified field key, injecting the error `message` variable:

```html
<input type="text" name="email" value="{{ old('email') }}" />
@error('email')
    <span class="error">{{ message }}</span>
@enderror
```

### HTML Attribute Helpers
Conditionally output boolean HTML attributes:

```html
<input type="checkbox" name="subscribe" @checked(user.isSubscribed) />
<option value="dark" @selected(user.theme === 'dark')>Dark Theme</option>
<button type="submit" @disabled(isProcessing)>Submit</button>
<input type="text" name="code" @readonly(isLocked) />
<input type="email" name="email" @required(isRequired) />
```
:::

---

## Layout Inheritance & Partial Subviews

::: v-pre
### Master Layout (`resources/views/layouts/app.strux`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>My Application</title>
    @vite('resources/css/app.css', 'resources/js/app.js')
</head>
<body>
    <header>
        <h1>Site Header</h1>
    </header>

    <main>
        @slot('content')
    </main>
</body>
</html>
```

### Child View (`resources/views/home.strux`)

```html
@extends('layouts.app')

@section('content')
    <h2>Welcome to Home Page</h2>
    <p>This content is injected into the master layout slot.</p>
@endsection
```

### Including Subviews (`@include`, `@includeIf`)

Include smaller component templates into views using `@include` or `@includeIf`:

```html
@include('partials.navbar')
@includeIf('partials.announcement_banner')
```
:::

---

## Vite Asset Integration (`@vite`)

Inject compiled CSS and JavaScript assets using `@vite()`:

```html
@vite('resources/css/app.css', 'resources/js/app.js')
```

* **Development Mode**: Connects directly to the Vite HMR hot-reload server (`http://localhost:5173`).
* **Production Mode**: Parses `public/build/.vite/manifest.json` and outputs minified, version-hashed `<link>` and `<script>` tags.

---

## IDE Setup & Syntax Highlighting

Since `.strux` template syntax is built on Blade-style directives (`@if`, `@foreach`, `@extends`, `{{ }}`), configuring syntax highlighting across IDEs requires associating `.strux` files with Blade or HTML syntax grammar.

### 1. Visual Studio Code, Antigravity IDE & Cursor

Open your IDE `settings.json` configuration file (or press `Cmd+,` / `Ctrl+,` and search for **File Associations**):

Add the following file association mapping:

```json
{
  "files.associations": {
    "*.strux": "blade"
  }
}
```

If the `blade` language mode is not installed, associate `.strux` with `html`:

```json
{
  "files.associations": {
    "*.strux": "html"
  }
}
```

#### Recommended Extension
Install the **Laravel Blade Snippets** extension in VS Code, Antigravity IDE, or Cursor to enable syntax colorization, snippet completion, and auto-formatting for `.strux` files.

### 2. JetBrains IDEs (WebStorm, PhpStorm, IntelliJ IDEA)

1. Open `Settings` / `Preferences` (`Cmd+,` on macOS or `Ctrl+Alt+S` on Windows/Linux).
2. Navigate to **Editor** ➔ **File Types**.
3. Locate **Blade** (or **HTML**) in the Recognized File Types list.
4. Under **File Name Patterns**, click **+** (Add) and enter:
   ```
   *.strux
   ```
5. Click **Apply** and **OK**.
