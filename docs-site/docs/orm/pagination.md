# Pagination

StruxJS ORM provides automatic query pagination out-of-the-box via the `paginate(perPage, page)` method on Model query builders. It returns a `PaginationResult` instance containing data collections, page metadata, JSON serialization, and HTML link rendering.

---

## Basic Usage

Call `.paginate()` on any Model or Query Builder instance:

```typescript
import { User } from "../app/Models/User.js";

// Paginate 15 records per page (automatically reads ?page= query parameter from request)
const users = await User.paginate(15);

// Specify explicit page index manually
const pageTwoUsers = await User.paginate(10, 2);
```

---

## Metadata Properties

The `PaginationResult` instance exposes metadata properties describing the dataset:

```typescript
const users = await User.paginate(10);

console.log(users.data);        // Collection of Model instances
console.log(users.total);       // Total count of matching records in database (e.g. 150)
console.log(users.perPage);     // Number of items per page (e.g. 10)
console.log(users.currentPage); // Active page number (e.g. 1)
console.log(users.lastPage);    // Total number of pages (e.g. 15)
console.log(users.from);        // Starting index of items on current page (e.g. 1)
console.log(users.to);          // Ending index of items on current page (e.g. 10)
```

---

## Iterating Paginated Results in Views

`PaginationResult` instances implement `Symbol.iterator` and internal array converters. In `.strux` template views, you can iterate directly over paginated objects using `@foreach` or `@forelse` without appending `.data`:

```html
<!-- Direct iteration over paginated result (Recommended) -->
@foreach(users as user)
    <tr>
        <td>{{ user.id }}</td>
        <td>{{ user.name }}</td>
        <td>{{ user.email }}</td>
    </tr>
@endforeach

<!-- Render pagination links below -->
{!! users.links() !!}
```

Accessing `users.data` or `users.data.all()` remains fully supported for backward compatibility.

---

## JSON API Response Format

When returning a paginated result directly inside an API Controller method via `res.json()`, StruxJS automatically serializes the object into a structured JSON payload:

```typescript
export class UserApiController {
    public async index(req, res) {
        const users = await User.where("status", "active").paginate(10);

        return res.json(users);
    }
}
```

### Serialized JSON Response Structure

```json
{
  "data": [
    { "id": 1, "name": "Alice", "email": "alice@example.com" },
    { "id": 2, "name": "Bob", "email": "bob@example.com" }
  ],
  "total": 50,
  "perPage": 10,
  "currentPage": 1,
  "lastPage": 5,
  "from": 1,
  "to": 10
}
```

---

## Template Engine Rendering (`.strux`)

Render HTML pagination controls directly inside `.strux` views using the `{!! !!}` unescaped expression syntax:

```html
<!-- resources/views/users/index.strux -->
<div class="container mx-auto p-4">
    <h1 class="text-2xl font-bold mb-4">Users Directory</h1>

    <ul class="divide-y divide-gray-200">
        @foreach(users.data.all() as user)
            <li class="py-2">{{ user.name }} ({{ user.email }})</li>
        @endforeach
    </ul>

    <!-- Render Tailwind CSS Pagination Controls -->
    <div class="mt-6">
        {!! users.links() !!}
    </div>
</div>
```

---

## Preserving Query Parameters (`withQueryString()`)

To preserve existing HTTP query string parameters (such as search filters or sort orders) across pagination links, chain `.withQueryString()` before calling `.links()`:

```html
<!-- Preserves URL parameters like ?search=john&role=admin when clicking page links -->
{!! users.withQueryString().links() !!}
```

---

## Pagination Styling & Custom Views

### Tailwind CSS (Default)
Calling `users.links()` without arguments generates responsive Tailwind CSS navigation controls:

```html
{!! users.links() !!}
{!! users.links('tailwind') !!}
```

---

### Bootstrap 5
Pass `'bootstrap'` to render Bootstrap 5 compatible `<nav><ul class="pagination">` structures:

```html
{!! users.links('bootstrap') !!}
```

---

### Custom Pagination Template View

Generate a customizable `.strux` pagination view file using the CLI generator command:

```bash
# Generates resources/views/pagination/custom.strux (Tailwind preset)
npx strux make:pagination custom

# Generates resources/views/pagination/simple.strux (Minimal prev/next preset)
npx strux make:pagination simple

# Generates resources/views/pagination/bootstrap.strux (Bootstrap 5 preset)
npx strux make:pagination bootstrap
```

Pass the pagination view name to `.links()` (supports short names like `'custom'` or full view paths like `'pagination.custom'`):

```html
<!-- Automatically resolves to resources/views/pagination/custom.strux -->
{!! users.links('custom') !!}

<!-- Or pass full dot-notation view path -->
{!! users.links('pagination.custom') !!}
```

Inside your custom view file (`resources/views/partials/pagination.strux`), access the `paginator` context object:

```html
<!-- resources/views/partials/pagination.strux -->
<nav class="custom-pagination">
    @if(!paginator.onFirstPage)
        <a href="{{ paginator.previousPageUrl }}">Previous</a>
    @endif

    @foreach(paginator.pages as item)
        @if(item.disabled)
            <span>...</span>
        @else
            <a href="{{ item.url }}" class="{{ item.active ? 'active' : '' }}">{{ item.page }}</a>
        @endif
    @endforeach

    @if(paginator.hasMorePages)
        <a href="{{ paginator.nextPageUrl }}">Next</a>
    @endif
</nav>
```
