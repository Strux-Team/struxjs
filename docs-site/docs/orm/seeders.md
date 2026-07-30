# Seeders & Factories

Seeders populate your database with test or initial data. Each seeder is a class with a `run` method that contains your insertion logic. Factories pair with seeders to generate realistic fake data using `@faker-js/faker`, keeping seeder code concise.

---

## Creating a Seeder

Use the CLI to generate a new seeder class inside `database/seeders/`:

```bash
npx strux make:seeder <name>
```

The `Seeder` suffix is appended automatically if omitted - both `User` and `UserSeeder` produce the same file.

```bash
npx strux make:seeder UserSeeder
```

Generated file (`database/seeders/UserSeeder.ts`):

```typescript
import { Seeder } from "struxjs";

export default class UserSeeder extends Seeder {
    /**
     * Run the database seeds.
     */
    public async run(): Promise<void> {
        // Write your seeding logic here, e.g.:
        // await User.create({ name: "Admin", email: "admin@example.com" });
    }
}
```

---

## Running Seeders

### Run the default seeder

```bash
npx strux db:seed
```

Runs `DatabaseSeeder` by default - the conventional entry point that calls all other seeders.

```
Running database seeders...
  Seeding: DatabaseSeeder
  Seeding: UserSeeder
  Seeded:  UserSeeder (45ms)
  Seeded:  DatabaseSeeder (46ms)
Database seeding completed successfully.
```

### Run a specific seeder

Use the `--class` option to target any seeder directly:

```bash
npx strux db:seed --class=UserSeeder
```

### Run seeders after a fresh migration

The `migrate:fresh --seed` flag drops all tables, re-runs all migrations, then calls `DatabaseSeeder` automatically:

```bash
npx strux migrate:fresh --seed
```

---

## CLI Command Reference

| Command | Description |
| :--- | :--- |
| `npx strux make:seeder <name>` | Create a new seeder class |
| `npx strux db:seed` | Run `DatabaseSeeder` |
| `npx strux db:seed --class=<name>` | Run a specific seeder class |
| `npx strux migrate:fresh --seed` | Fresh migration + run `DatabaseSeeder` |

---

## DatabaseSeeder

`DatabaseSeeder` is the root seeder that orchestrates all others. Call individual seeders from it using `this.call()`:

```typescript
import { Seeder } from "struxjs";
import UserSeeder from "./UserSeeder.ts";
import ProductSeeder from "./ProductSeeder.ts";

export default class DatabaseSeeder extends Seeder {
    public async run(): Promise<void> {
        await this.call([
            UserSeeder,
            ProductSeeder,
        ]);
    }
}
```

`this.call()` runs each seeder in the array sequentially and logs the result of each one.

### Passing class references vs. string names

`this.call()` accepts both direct class references and string names:

```typescript
// Class reference (recommended - type-safe, import required)
await this.call([UserSeeder]);

// String name (resolved from database/seeders/ at runtime)
await this.call(["UserSeeder"]);
```

---

## Writing Seeder Logic

### Inserting records directly

Use your models inside `run()` to insert data:

```typescript
import { Seeder } from "struxjs";
import { User } from "../../app/Models/User.ts";

export default class AdminSeeder extends Seeder {
    public async run(): Promise<void> {
        await User.create({
            name: "Admin",
            email: "admin@example.com",
            role: "admin",
            status: true,
        });
    }
}
```

### Avoiding duplicate records

Use `firstOrCreate` to insert a record only if it does not already exist:

```typescript
await User.firstOrCreate(
    { email: "admin@example.com" },
    { name: "Admin", role: "admin", status: true }
);
```

---

## Factories

Factories generate model instances populated with fake data using `@faker-js/faker`. They are designed to be used inside seeders to create large volumes of realistic test data with minimal code.

### Creating a Factory

```bash
npx strux make:factory <name>
```

The `Factory` suffix is appended automatically if omitted.

```bash
npx strux make:factory UserFactory
```

Generated file (`database/factories/UserFactory.ts`):

```typescript
import { Factory } from "struxjs";
import { User } from "../../app/Models/User.ts";

export class UserFactory extends Factory<User> {
    protected model = User;

    /**
     * Define the model's default state.
     */
    public definition(): Record<string, any> {
        return {
            name: this.faker.person.fullName(),
            email: this.faker.internet.email(),
            status: true
        };
    }
}
```

The `definition()` method returns a plain object of column-value pairs. `this.faker` gives access to the full `@faker-js/faker` API.

### Factory methods

#### `Factory.new()`

Creates a new factory builder instance. Always start a factory chain with this static method:

```typescript
UserFactory.new()
```

#### `.count(n)`

Specifies how many records to generate:

```typescript
UserFactory.new().count(10)
```

#### `.create(attributes?)`

Generates and **persists** records to the database. Returns a single model instance when `count` is 1, or a `Collection` when `count` is greater than 1:

```typescript
// Create and save 10 users
await UserFactory.new().count(10).create();

// Create 1 user and save it
const user = await UserFactory.new().create();
```

#### `.make(attributes?)`

Generates model instances **without** saving them to the database:

```typescript
// Build 5 unsaved user instances
const users = UserFactory.new().count(5).make();
```

#### Overriding attributes

Pass an attributes object to either `create()` or `make()` to override specific fields from `definition()`:

```typescript
// All 5 users will have role "admin", everything else is generated
await UserFactory.new().count(5).create({ role: "admin" });
```

---

## Using Factories in Seeders

The typical pattern is to call a factory directly inside a seeder's `run` method:

```typescript
import { Seeder } from "struxjs";
import { UserFactory } from "../factories/UserFactory.ts";

export default class UserSeeder extends Seeder {
    public async run(): Promise<void> {
        await UserFactory.new().count(50).create();
    }
}
```

You can also combine manual records with factory-generated ones in the same seeder:

```typescript
import { Seeder } from "struxjs";
import { User } from "../../app/Models/User.ts";
import { UserFactory } from "../factories/UserFactory.ts";

export default class UserSeeder extends Seeder {
    public async run(): Promise<void> {
        // Fixed admin account
        await User.firstOrCreate(
            { email: "admin@example.com" },
            { name: "Admin", role: "admin", status: true }
        );

        // 49 randomly generated regular users
        await UserFactory.new().count(49).create({ role: "user" });
    }
}
```

---

## Faker Reference

`this.faker` inside `definition()` is the full `@faker-js/faker` instance. Common helpers used in definitions:

| Expression | Example output |
| :--- | :--- |
| `this.faker.person.fullName()` | `"Jane Doe"` |
| `this.faker.internet.email()` | `"jane.doe@example.com"` |
| `this.faker.internet.username()` | `"jane_doe42"` |
| `this.faker.lorem.sentence()` | `"Lorem ipsum dolor sit amet."` |
| `this.faker.lorem.paragraphs(2)` | Multi-paragraph text |
| `this.faker.number.int({ min: 1, max: 100 })` | `47` |
| `this.faker.datatype.boolean()` | `true` |
| `this.faker.date.past()` | `Date` object in the past |
| `this.faker.image.url()` | `"https://picsum.photos/..."` |
| `this.faker.helpers.arrayElement(["a", "b"])` | `"a"` or `"b"` |

Full API reference: [fakerjs.dev/api](https://fakerjs.dev/api/)
