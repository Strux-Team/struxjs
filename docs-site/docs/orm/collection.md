# Collections

All StruxJS ORM queries returning multiple records (such as `User.all()`, `User.get()`, `User.where().get()`, and `User.findManyOrFail()`) return a **`Collection`** instance powered by `collect.js`.

Collections wrap native JavaScript arrays with fluent, chainable helper methods for filtering, mapping, grouping, sorting, and aggregating data.

---

## Creating Collections

In addition to receiving collections from ORM queries, wrap any native array using the `collect` helper:

```typescript
import { collect } from "struxjs";

const collection = collect([1, 2, 3, 4, 5]);
```

---

## Method Reference

### Data Extraction & Conversion

#### `.all()`
Returns the underlying raw JavaScript array:

```typescript
const users = await User.all();
const rawArray = users.all(); // Returns User[]
```

#### `.first(callback?)`
Returns the first element in the collection (or the first element passing a truth test callback):

```typescript
const firstUser = users.first();
const firstAdmin = users.first(user => user.role === 'admin');
```

#### `.last(callback?)`
Returns the last element in the collection:

```typescript
const lastUser = users.last();
```

#### `.pluck(valueKey, keyBy?)`
Retrieves all values for a given key:

```typescript
const emails = users.pluck('email').all(); // ['alice@example.com', 'bob@example.com']

// Keyed by ID
const namesById = users.pluck('name', 'id').all(); // { 1: 'Alice', 2: 'Bob' }
```

#### `.toArray()` / `.toJson()`
Converts the collection to a plain array or JSON string representation:

```typescript
const arrayData = users.toArray();
const jsonString = users.toJson();
```

---

### Filtering & Searching

#### `.filter(callback)`
Filters the collection using a callback truth test:

```typescript
const activeUsers = users.filter(user => user.status === 'active');
```

#### `.reject(callback)`
Inverse of `.filter()`. Returns items where the callback returns `false`:

```typescript
const nonBannedUsers = users.reject(user => user.isBanned);
```

#### `.where(key, value)` / `.whereIn(key, values)`
Filters items by property value equality or array inclusion:

```typescript
const admins = users.where('role', 'admin');
const specificRoles = users.whereIn('role', ['admin', 'editor']);
```

#### `.unique(key?)`
Returns unique items from the collection:

```typescript
const uniqueRoles = users.pluck('role').unique();
```

---

### Transformation & Mapping

#### `.map(callback)`
Iterates through the collection and passes each value to the given callback:

```typescript
const formattedNames = users.map(user => user.name.toUpperCase());
```

#### `.flatMap(callback)`
Maps collection items and flattens the result by one level:

```typescript
const allTags = posts.flatMap(post => post.tags);
```

#### `.chunk(size)`
Splits the collection into smaller collections of a given size:

```typescript
const chunks = users.chunk(10); // Collection of collections (10 items each)
```

---

### Grouping & Keying

#### `.groupBy(key)`
Groups collection items by a given property or callback return value:

```typescript
const groupedByRole = users.groupBy('role');
// Output: { admin: Collection([...]), user: Collection([...]) }
```

#### `.keyBy(key)`
Keys the collection by the specified property:

```typescript
const usersById = users.keyBy('id');
// Output: { 1: UserObj, 2: UserObj }
```

---

### Sorting

#### `.sortBy(key)` / `.sortByDesc(key)`
Sorts the collection by a given property key or callback function:

```typescript
const sortedByName = users.sortBy('name');
const sortedByDateDesc = users.sortByDesc('created_at');
```

---

### Aggregations & Math

#### `.count()`
Returns the total number of items in the collection:

```typescript
const total = users.count();
```

#### `.sum(key?)` / `.avg(key?)` / `.min(key?)` / `.max(key?)`
Computes mathematical aggregates over collection items:

```typescript
const totalRevenue = orders.sum('total_amount');
const averageAge = users.avg('age');
const minPrice = products.min('price');
const maxPrice = products.max('price');
```

---

### State Checks

#### `.isEmpty()` / `.isNotEmpty()`
Checks if the collection contains zero or more than zero items:

```typescript
if (users.isEmpty()) {
    console.log("No users found.");
}
```

#### `.contains(key, value?)`
Checks if the collection contains a given value or key-value pair:

```typescript
const hasAdmin = users.contains('role', 'admin');
```

---

## Method Chaining Example

Collections shine when chaining multiple operations together:

```typescript
import { User } from "../app/Models/User.js";

export class UserController {
    public async getTopSpenders(req, res) {
        const users = await User.all();

        const topSpenders = users
            .filter(user => user.status === 'active')
            .sortByDesc(user => user.totalSpent)
            .take(5)
            .map(user => ({
                id: user.id,
                name: user.name,
                totalSpent: user.totalSpent
            }))
            .all();

        return res.json({ topSpenders });
    }
}
```
