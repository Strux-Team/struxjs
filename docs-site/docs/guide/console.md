# Console Commands

StruxJS includes a built-in CLI (`npx strux`) with framework commands for generating files, running migrations, managing queues, and more. You can also create your own custom commands that are automatically discovered and registered.

---

## Running Commands

All CLI commands use the `npx strux` prefix:

```bash
npx strux <command> [arguments] [options]
```

---

## Creating a Custom Command

```bash
npx strux make:command SendEmailsCommand
```

Generated file (`app/Console/Commands/SendEmailsCommand.ts`):

```typescript
import { Command } from "struxjs";
import { Command as CommanderCommand } from "commander";

export class SendEmailsCommand extends Command {
    protected signature = "app:sendemails";
    protected description = "Description of SendEmailsCommand";

    protected configure(command: CommanderCommand): void {
        // Add options here, e.g.:
        // command.option("--force", "Force execution");
    }

    public async handle(...args: any[]): Promise<void> {
        console.log("Console command [SendEmailsCommand] executed successfully!");
    }
}
```

### Command properties

| Property | Description |
| :--- | :--- |
| `signature` | The CLI command name (e.g. `"app:sendemails"` → `npx strux app:sendemails`) |
| `description` | Help text shown in `npx strux --help` |

### `configure(command)`

Override this to add CLI options and arguments using Commander's fluent API:

```typescript
protected configure(command: CommanderCommand): void {
    command
        .option("--force", "Skip confirmation prompts")
        .option("--limit <number>", "Number of emails to send", "100");
}
```

### `handle(...args)`

The entry point for your command logic. The `args` array receives positional arguments and the parsed options object (last element):

```typescript
public async handle(...args: any[]): Promise<void> {
    const options = args[args.length - 1]; // Commander options object

    const limit = parseInt(options.limit, 10);
    const force = !!options.force;

    console.log(`Sending up to ${limit} emails. Force: ${force}`);
}
```

---

## Auto-Discovery

Any class in `app/Console/Commands/` that extends `Command` is **automatically discovered and registered** when you run `npx strux`. No manual registration is needed.

The scanner walks the directory recursively, so nested folders work too:

```
app/Console/Commands/
  SendEmailsCommand.ts        → npx strux app:sendemails
  Reports/GenerateCommand.ts  → npx strux app:generate
```

---

## Accessing the Database in Commands

By default, `npx strux` does not boot the full HTTP application. If your command needs the database, models, or config - create a `bootstrap-cli.ts` at your project root:

```typescript
// bootstrap-cli.ts
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Application, BaseModel } from "struxjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, ".env") });

const app = new Application(__dirname);
await app.bootstrap();

const dbConfig = app.container.make("config.database");
BaseModel.bootConnection(dbConfig);
```

When `bootstrap-cli.ts` exists, it is loaded automatically before any `npx strux` command runs. This gives your commands access to models, configs, cache, and the IoC container - without starting the HTTP server.

Example command using the database:

```typescript
import { Command } from "struxjs";
import { User } from "../../Models/User.js";

export class PruneUsersCommand extends Command {
    protected signature = "app:prune-users";
    protected description = "Delete inactive users older than 90 days";

    public async handle(): Promise<void> {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const deleted = await User.where("last_active_at", "<", cutoff).delete();
        console.log(`Pruned ${deleted} inactive users.`);
    }
}
```

---

## Practical Examples

### Command with required argument

```typescript
import { Command } from "struxjs";
import { Command as CommanderCommand } from "commander";
import { User } from "../../Models/User.js";

export class ActivateUserCommand extends Command {
    protected signature = "user:activate <userId>";
    protected description = "Activate a user account by ID";

    public async handle(userId: string): Promise<void> {
        const user = await User.findOrFail(userId);
        await user.update({ status: true });
        console.log(`User #${userId} (${user.email}) has been activated.`);
    }
}
```

```bash
npx strux user:activate 42
```

### Command with options

```typescript
import { Command } from "struxjs";
import { Command as CommanderCommand } from "commander";

export class SyncDataCommand extends Command {
    protected signature = "app:sync";
    protected description = "Sync data from external API";

    protected configure(command: CommanderCommand): void {
        command
            .option("--dry-run", "Preview changes without applying them")
            .option("--source <url>", "API endpoint URL");
    }

    public async handle(...args: any[]): Promise<void> {
        const options = args[args.length - 1];

        if (options.dryRun) {
            console.log("Dry run - no changes will be made.");
        }

        const source = options.source || "https://api.example.com/data";
        console.log(`Syncing from ${source}...`);
    }
}
```

```bash
npx strux app:sync --source https://api.myapp.com --dry-run
```

### Dispatching a job from a command

```typescript
import { Command } from "struxjs";
import { dispatch } from "struxjs";
import { GenerateReportJob } from "../../Jobs/GenerateReportJob.js";

export class GenerateReportCommand extends Command {
    protected signature = "report:generate";
    protected description = "Dispatch a report generation job to the queue";

    public async handle(): Promise<void> {
        await dispatch(new GenerateReportJob());
        console.log("Report generation job dispatched.");
    }
}
```

---

## Built-in CLI Reference

### Application

| Command | Description |
| :--- | :--- |
| `npx strux key:generate` | Generate `APP_KEY` and write to `.env` |
| `npx strux key:generate --show` | Print the key without modifying `.env` |
| `npx strux route:list` | List all registered HTTP routes |
| `npx strux storage:link` | Create `public/storage` symlink |

### Generators

| Command | Description |
| :--- | :--- |
| `npx strux make:command <name>` | Create a custom console command |
| `npx strux make:controller <name>` | Create a controller |
| `npx strux make:controller <name> --resource` | Create a resource controller |
| `npx strux make:model <name>` | Create a model |
| `npx strux make:middleware <name>` | Create a middleware |
| `npx strux make:request <name>` | Create a FormRequest validation class |
| `npx strux make:migration <name>` | Create a migration file |
| `npx strux make:seeder <name>` | Create a seeder |
| `npx strux make:factory <name>` | Create a factory |
| `npx strux make:job <name>` | Create a job |
| `npx strux make:event <name>` | Create an event |
| `npx strux make:listener <name>` | Create a listener |
| `npx strux make:view <name>` | Create a `.strux` view template |
| `npx strux make:layout <name>` | Create a `.strux` layout template |
| `npx strux make:mail <name>` | Create a Mailable class |
| `npx strux make:resource <name>` | Create an API Resource transformer class |
| `npx strux make:resource <name> --collection` | Create a Resource + ResourceCollection class |
| `npx strux make:pagination <name>` | Create a custom pagination view template |

### Database

| Command | Description |
| :--- | :--- |
| `npx strux migrate` | Run pending migrations |
| `npx strux migrate:rollback` | Roll back the last batch |
| `npx strux migrate:rollback --step=<n>` | Roll back the last N batches |
| `npx strux migrate:reset` | Roll back all migrations |
| `npx strux migrate:refresh` | Reset and re-run all migrations |
| `npx strux migrate:fresh` | Drop all tables and re-run |
| `npx strux migrate:fresh --seed` | Fresh migration + seed |
| `npx strux migrate:status` | Show migration run status |
| `npx strux db:seed` | Run `DatabaseSeeder` |
| `npx strux db:seed --class=<name>` | Run a specific seeder |

### Queue

| Command | Description |
| :--- | :--- |
| `npx strux queue:work` | Start a queue worker |
| `npx strux queue:failed` | List failed jobs |
| `npx strux queue:retry <id>` | Retry a failed job |
| `npx strux queue:retry all` | Retry all failed jobs |
| `npx strux queue:flush` | Delete all failed jobs |
| `npx strux queue:table` | Generate database queue migrations |

### Cache

| Command | Description |
| :--- | :--- |
| `npx strux cache:clear` | Flush the default cache store |
| `npx strux cache:clear -s <store>` | Flush a specific store |
| `npx strux cache:table` | Generate the database cache migration |

### Scheduler

| Command | Description |
| :--- | :--- |
| `npx strux schedule:run` | Run due tasks once and exit |
| `npx strux schedule:work` | Start the scheduler daemon |
| `npx strux schedule:list` | List all registered tasks |
