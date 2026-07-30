# Localization (i18n)

StruxJS provides a built-in localization and translation engine, allowing you to easily support multiple languages in your application. The framework makes it simple to retrieve strings in various languages using either flat JSON files or grouped files inside a language-specific directory.

---

## Configuration

The default language for your application is configured in the `.env` file via the `APP_LOCALE` variable. If a translation is not found in the active locale, the framework will gracefully fall back to the `APP_FALLBACK_LOCALE` language.

```ini
# .env
APP_LOCALE=en
APP_FALLBACK_LOCALE=en
```

Alternatively, you can manage this in your `config/app.ts` file if you have published it.

---

## Defining Translations

Translation strings are stored in the `resources/lang` directory. StruxJS supports two different ways of structuring your translation files: **Single JSON files** or **Grouped Subdirectories**.

### 1. Single JSON File (Recommended for simple apps)

For applications with a relatively small number of translatable strings, you can define translations in a single JSON file per language at the root of `resources/lang`.

```json
// resources/lang/en.json
{
    "Welcome to our application": "Welcome to our application",
    "Hello :name": "Hello :name"
}
```

```json
// resources/lang/vi.json
{
    "Welcome to our application": "Chào mừng đến với ứng dụng",
    "Hello :name": "Xin chào :name"
}
```

### 2. Grouped Subdirectories (Recommended for complex apps)

For larger applications, it's often better to group translations into separate files based on their context (e.g., `auth`, `validation`, `messages`). You can create a subdirectory for each language:

```
resources/
└── lang/
    ├── en/
    │   ├── auth.json
    │   └── messages.json
    └── vi/
        ├── auth.json
        └── messages.json
```

```json
// resources/lang/en/auth.json
{
    "failed": "These credentials do not match our records.",
    "throttle": "Too many login attempts. Please try again in :seconds seconds."
}
```

---

## Retrieving Translations

You may retrieve translation strings from your language files using the global `trans()` or `__()` helper functions. They both behave exactly the same.

### Basic Retrieval

If you are using the **Single JSON File** approach, simply pass the exact string:

```typescript
import { trans, __ } from "struxjs";

const welcome = trans("Welcome to our application");
// Or using the alias
const welcome2 = __("Welcome to our application");
```

If you are using **Grouped Subdirectories**, you retrieve the strings using "dot" notation. The first part is the file name, and the second part is the key:

```typescript
// Retrieves from resources/lang/en/auth.json
const message = trans("auth.failed"); 
```

### Replacing Parameters (Placeholders)

If your translation strings contain placeholders (prefixed with a `:` or wrapped in `{}`), you can pass an object of replacements as the second argument to `trans()`:

```typescript
// Assuming translation is: "Welcome back, :name!"
const greeting = trans("Welcome back, :name!", { name: "Alice" });

// Assuming translation is: "You have {count} messages."
const unread = trans("You have {count} messages.", { count: 5 });
```

---

## Using Translations in Views

The `trans` and `__` helpers are automatically injected into the `.strux` template engine, meaning you can use them directly in your views without importing anything:

```html
<!-- Single JSON translation -->
<h1>{{ __('Welcome to our application') }}</h1>

<!-- Grouped translation with parameters -->
<p>{{ trans('messages.greeting', { name: user.name }) }}</p>
```

---

## Changing the Active Language at Runtime

You may occasionally need to change the active language dynamically at runtime (for example, based on the authenticated user's preference or a URL parameter). You can do this using the `LangManager.setLocale()` method:

```typescript
import { LangManager, Request, Response } from "struxjs";

export class LanguageController {
    public change(request: Request, response: Response) {
        const locale = request.input("locale");
        
        if (["en", "vi", "fr"].includes(locale)) {
            LangManager.setLocale(locale);
        }

        return response.redirect().back();
    }
}
```

You can also check the current locale:

```typescript
const currentLocale = LangManager.getLocale();
```

> **Note:** Translations are cached in memory for performance. If you are developing and changing JSON files, you might need to restart the server or call `LangManager.clearCache()` to see the updates immediately.
