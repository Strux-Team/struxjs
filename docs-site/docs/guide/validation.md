# Validation

StruxJS provides a built-in validation engine supporting inline request validation, dedicated `FormRequest` classes, custom error messages, custom attribute aliases, and asynchronous database verification rules.

---

## Inline Request Validation

Validate incoming request payloads directly inside Controller actions using `request.validate()`:

```typescript
import { Request, Response } from "struxjs";

export class UserController {
    public async store(request: Request, response: Response) {
        const validatedData = await request.validate(
            {
                name: "required|min:2|max:50",
                email: "required|email|unique:users,email",
                role: "required|in:admin,editor,user"
            },
            {
                "email.required": "Please provide an email address.",
                "email.unique": "This email address is already registered."
            },
            {
                email: "Email Address",
                name: "Full Name"
            }
        );

        return response.json(validatedData);
    }
}
```

---

## FormRequest Classes

For complex validation logic, create dedicated `FormRequest` classes using the StruxJS CLI:

```bash
npx strux make:request RegisterRequest
```

Generated file (`app/Requests/RegisterRequest.ts`):

```typescript
import { FormRequest } from "struxjs";

export class RegisterRequest extends FormRequest {
    /**
     * Define validation rules for the request payload.
     */
    public rules(): Record<string, string> {
        return {
            name: "required|min:2|max:50",
            email: "required|email|unique:users,email",
            password: "required|min:6|confirmed",
            avatar: "file|image|max:2048"
        };
    }

    /**
     * Define custom error messages for specific rule violations.
     */
    public messages(): Record<string, string> {
        return {
            "email.unique": "This email address is already taken.",
            "password.confirmed": "Password confirmation does not match."
        };
    }

    /**
     * Define user-friendly attribute aliases for field names.
     */
    public attributes(): Record<string, string> {
        return {
            email: "Email Address",
            name: "Full Name",
            password: "Password"
        };
    }
}
```

### Accessing Route Parameters inside FormRequest

Access URL parameters (such as `:id` in `/users/:id`) directly inside your `FormRequest` class using `this.param('name')` or `this.params`:

```typescript
import { FormRequest } from "struxjs";

export class UpdateUserRequest extends FormRequest {
    public rules(): Record<string, string> {
        // Retrieve the 'id' parameter from the route URL
        const userId = this.param("id"); // Or this.params.id

        return {
            name: "required|min:2",
            // Exclude current user ID from unique database check during update
            email: `required|email|unique:users,email,${userId}`
        };
    }
}
```

### Controller Usage

Inject the `FormRequest` class into your Controller action. **Remember the camelCase parameter naming rule** (`registerRequest: RegisterRequest`):

```typescript
import { Response } from "struxjs";
import { RegisterRequest } from "../Requests/RegisterRequest.js";
import { UserService } from "../Services/UserService.js";

export class AuthController {
    public async register(registerRequest: RegisterRequest, response: Response, userService: UserService) {
        // Retrieve validated & sanitized input payload
        const data = registerRequest.validated(); // Or registerRequest.all()

        const user = await userService.create(data);
        return response.json(user);
    }
}
```

---

## Message Placeholders (`:attribute` and `:value`)

StruxJS error messages support dynamic placeholders that are replaced during validation:

* **`:attribute`**: Replaced by the custom attribute alias defined in `attributes()` (defaults to the raw field key if no custom attribute alias is defined).
* **`:value`**: Replaced by the parameter value passed to the rule (e.g. `6` for `min:6`, `2048` for `max:2048`, or `png,jpg` for `mimes:png,jpg`).

### Example

```typescript
export class RegisterRequest extends FormRequest {
    public rules(): Record<string, string> {
        return {
            email: "required|email",
            password: "required|min:6",
            avatar: "file|max:2048"
        };
    }

    public messages(): Record<string, string> {
        return {
            // Global rule message using :attribute placeholder
            "required": "The :attribute field cannot be left blank.",

            // Specific field rule message using :attribute and :value placeholders
            "password.min": "The :attribute must contain at least :value characters.",
            "avatar.max": "The :attribute file size must not exceed :value KB."
        };
    }

    public attributes(): Record<string, string> {
        return {
            email: "Email Address",
            password: "User Password",
            avatar: "Profile Picture"
        };
    }
}
```

### Generated Error Messages
* Validation failure on `email` `required` ➔ `"The Email Address field cannot be left blank."`
* Validation failure on `password` `min:6` ➔ `"The User Password must contain at least 6 characters."`
* Validation failure on `avatar` `max:2048` ➔ `"The Profile Picture file size must not exceed 2048 KB."`

---

## Validation Failure & Redirect Behavior

When validation fails, StruxJS throws a `ValidationError` and automatically handles the response based on request headers and route context:

### 1. API & JSON Requests (`/api/*` or `Accept: application/json`)
Returns an HTTP `422 Unprocessable Entity` JSON response containing error messages:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "email": [
      "This email address is already taken."
    ],
    "password": [
      "Password confirmation does not match."
    ]
  }
}
```

### 2. Stateful Web Requests (`routes/web.ts`)
For standard HTML form submissions, StruxJS automatically:
1. Flashes all validation error messages to the HTTP Session.
2. Flashes previous form input values (`old`) to the session (excluding sensitive password fields).
3. Redirects the client back to the previous form page (`HTTP 302 Redirect`).

---

## Accessing Validation Errors & Old Input in Views

In server-rendered `.strux` HTML templates, use global template helpers to display validation error alerts and restore previous input values:

### 1. Retrieving Previous Input (`old()`)

Keep form fields populated after a validation redirect:

```html
<input 
    type="text" 
    name="name" 
    value="{{ old('name') }}" 
    placeholder="Enter your full name" 
/>
```

### 2. Displaying Error Messages (`errors`)

The `errors` view helper provides methods for inspecting validation errors:

* `errors.has('field')`: Returns `true` if validation errors exist for `field`.
* `errors.first('field')`: Returns the first error message for `field`.
* `errors.get('field')`: Returns an array of error messages for `field`.
* `errors.all()`: Returns an object containing all validation errors.

### Complete Form Template Example (`register.strux`)

```html
<form action="/register" method="POST">
    <!-- CSRF Token Protection -->
    <input type="hidden" name="_token" value="{{ csrf_token() }}" />

    <!-- Name Field -->
    <div>
        <label>Full Name</label>
        <input type="text" name="name" value="{{ old('name') }}" />
        @if(errors.has('name'))
            <span class="text-red-500">{{ errors.first('name') }}</span>
        @endif
    </div>

    <!-- Email Field -->
    <div>
        <label>Email Address</label>
        <input type="email" name="email" value="{{ old('email') }}" />
        @if(errors.has('email'))
            <span class="text-red-500">{{ errors.first('email') }}</span>
        @endif
    </div>

    <!-- Password Field -->
    <div>
        <label>Password</label>
        <input type="password" name="password" />
        @if(errors.has('password'))
            <span class="text-red-500">{{ errors.first('password') }}</span>
        @endif
    </div>

    <button type="submit">Register</button>
</form>
```

---

## Available Validation Rules

### `required`
The field under validation must be present in the request payload and not empty (non-empty string, non-null, non-undefined). For file upload fields, verifies a valid file was uploaded.

```typescript
{ name: "required" }
```

### `email`
The field under validation must be formatted as a valid email address.

```typescript
{ email: "email" }
```

### `unique:table,column,exceptId,idColumn`
The field value must be unique within the specified database table. Performed asynchronously via database query.

* `table`: Database table name (required).
* `column`: Table column name (optional; defaults to request field name).
* `exceptId`: Record ID to exclude from uniqueness check (optional; useful for updates).
* `idColumn`: Name of primary key column to exclude (optional; defaults to `id`).

```typescript
// Basic uniqueness check on 'users' table, 'email' column
{ email: "unique:users,email" }

// Ignore existing record with ID = 42 during user update
{ email: "unique:users,email,42" }

// Ignore existing record with custom primary key column 'user_id' = 42
{ email: "unique:users,email,42,user_id" }
```

### `min:value`
Enforces minimum boundary rules based on field type:
* **Numeric values**: Field value must be greater than or equal to `value`.
* **String values**: String length must be at least `value` characters.
* **File uploads**: Uploaded file size must be at least `value` kilobytes (KB).

```typescript
{ age: "numeric|min:18" }
{ password: "min:8" }
{ document: "file|min:100" } // Minimum 100 KB
```

### `max:value`
Enforces maximum boundary rules based on field type:
* **Numeric values**: Field value must not exceed `value`.
* **String values**: String length must not exceed `value` characters.
* **File uploads**: Uploaded file size must not exceed `value` kilobytes (KB).

```typescript
{ age: "numeric|max:120" }
{ bio: "max:500" }
{ avatar: "image|max:2048" } // Maximum 2 MB (2048 KB)
```

### `numeric`
The field under validation must be a valid number or numeric string.

```typescript
{ price: "numeric" }
```

### `alpha`
The field under validation must contain entirely alphabetic characters (`[a-zA-Z]`).

```typescript
{ code: "alpha" }
```

### `alpha_num`
The field under validation must contain entirely alphanumeric characters (`[a-zA-Z0-9]`).

```typescript
{ username: "alpha_num" }
```

### `confirmed`
The field under validation must have a matching `:field_confirmation` field in the request payload. For example, if validating `password`, a matching `password_confirmation` field must exist with identical value.

```typescript
{ password: "confirmed" }
```

### `in:foo,bar,...`
The field under validation must be included in the given list of allowed values.

```typescript
{ role: "in:admin,editor,user" }
```

### `file`
The field under validation must be a valid, successfully uploaded file.

```typescript
{ document: "file" }
```

### `image`
The field under validation must be an authentic image file (verified via file extension and magic byte MIME type header inspection). Supported extensions: `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`, `bmp`.

```typescript
{ avatar: "image" }
```

### `mimes:ext1,ext2,...`
The field under validation must be an authentic uploaded file whose real MIME extension matches one of the specified allowed extensions.

```typescript
{ attachment: "mimes:pdf,docx,xlsx" }
```

---

## Custom Callback Rules & Custom Messages

Pass an array of custom asynchronous validator functions for complex business logic. Custom messages for callback rules are defined using `field.custom_0`, `field.custom_1` (matching callback array index):

```typescript
export class CustomRequest extends FormRequest {
    public rules(): Record<string, any> {
        return {
            domain: [
                async (value: string) => {
                    return value.endsWith(".com") || value.endsWith(".org");
                }
            ]
        };
    }

    public messages(): Record<string, string> {
        return {
            "domain.custom_0": "The domain name must end with .com or .org extension."
        };
    }
}
```
