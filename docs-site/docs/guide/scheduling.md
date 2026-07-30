# Task Scheduler

The Task Scheduler lets you define recurring background tasks - cleanups, reports, cache refreshes, bulk emails - in a clean, fluent API instead of managing cron entries manually. Tasks are registered in `routes/console.ts` and run either via a daemon process during development or a system cron in production.

---

## Defining Tasks

Create or edit `routes/console.ts`. The file must export a default function that receives a `Schedule` builder:

```typescript
import { Schedule } from "struxjs";

export default function (schedule: Schedule): void {
    schedule
        .call(async () => {
            // delete expired sessions, temp files, etc.
        })
        .daily()
        .name("Clear expired data");
}
```

This is the only file you need to edit. The CLI automatically loads it when running any `schedule:*` command.

---

## Task Types

### `schedule.call(callback)`

Schedule an arbitrary async function:

```typescript
schedule
    .call(async () => {
        await db.query("DELETE FROM temp_logs WHERE created_at < NOW() - INTERVAL 7 DAY");
    })
    .daily()
    .name("Purge old logs");
```

### `schedule.command(cmd)`

Schedule a shell command. Output is forwarded to stdout/stderr:

```typescript
schedule
    .command("node dist/cli/index.js db:seed --class=CacheSeeder")
    .weekly()
    .name("Weekly cache seed");
```

### `schedule.strux(signature)`

Shorthand for running a StruxJS CLI command. Resolves the path to the compiled CLI automatically:

```typescript
schedule
    .strux("cache:clear")
    .hourly()
    .withoutOverlapping();
```

### `schedule.job(jobInstance)`

Dispatch a StruxJS Job directly. The job's `handle()` is called in-process:

```typescript
import { GenerateReportJob } from "../app/Jobs/GenerateReportJob.js";

schedule
    .job(new GenerateReportJob())
    .weeklyOn(1, "08:00")
    .environments("production");
```

---

## Frequency Methods

Every task registration returns a `ScheduleEvent` with a fluent frequency API. All methods are chainable.

### Raw cron expression

```typescript
schedule.call(fn).cron("*/5 8-18 * * 1-5"); // Every 5 min, 8am–6pm, Mon–Fri
```

`cron()` expects a 5-field expression: `minute hour day-of-month month day-of-week`.

### Minutes

| Method | Cron | Description |
| :--- | :--- | :--- |
| `everyMinute()` | `* * * * *` | Every minute |
| `everyMinutes(n)` | `*/n * * * *` | Every N minutes |
| `everyTwoMinutes()` | `*/2 * * * *` | Every 2 minutes |
| `everyThreeMinutes()` | `*/3 * * * *` | Every 3 minutes |
| `everyFiveMinutes()` | `*/5 * * * *` | Every 5 minutes |
| `everyTenMinutes()` | `*/10 * * * *` | Every 10 minutes |
| `everyFifteenMinutes()` | `*/15 * * * *` | Every 15 minutes |
| `everyThirtyMinutes()` | `*/30 * * * *` | Every 30 minutes |

### Hours

| Method | Cron | Description |
| :--- | :--- | :--- |
| `hourly()` | `0 * * * *` | Every hour at :00 |
| `hourlyAt(minute)` | `m * * * *` | Every hour at `:mm` |
| `everyHours(n)` | `0 */n * * *` | Every N hours |
| `everyTwoHours()` | `0 */2 * * *` | Every 2 hours |
| `everyThreeHours()` | `0 */3 * * *` | Every 3 hours |
| `everySixHours()` | `0 */6 * * *` | Every 6 hours |

### Days

| Method | Cron | Description |
| :--- | :--- | :--- |
| `daily()` | `0 0 * * *` | Daily at midnight |
| `dailyAt("HH:MM")` | `m h * * *` | Daily at specific time |
| `twiceDaily(h1, h2)` | `0 h1,h2 * * *` | Twice a day (default: 1am and 1pm) |

### Weeks

| Method | Cron | Description |
| :--- | :--- | :--- |
| `weekly()` | `0 0 * * 0` | Weekly on Sunday at midnight |
| `weeklyOn(day, "HH:MM")` | `m h * * d` | Weekly on day (0=Sun…6=Sat) at time |

### Months

| Method | Cron | Description |
| :--- | :--- | :--- |
| `monthly()` | `0 0 1 * *` | Monthly on the 1st at midnight |
| `monthlyOn(day, "HH:MM")` | `m h d * *` | Monthly on a specific day and time |
| `twiceMonthly(d1, d2, "HH:MM")` | `m h d1,d2 * *` | Twice a month (default: 1st and 16th) |
| `quarterly()` | `0 0 1 1,4,7,10 *` | Quarterly (Jan, Apr, Jul, Oct 1st) |
| `yearly()` | `0 0 1 1 *` | Yearly on January 1st |
| `yearlyOn(month, day, "HH:MM")` | varies | Yearly on a specific date |

### Day-of-week helpers

```typescript
schedule.call(fn).weekdays();      // Monday–Friday only
schedule.call(fn).weekends();      // Saturday–Sunday only

schedule.call(fn).mondays();
schedule.call(fn).tuesdays();
schedule.call(fn).wednesdays();
schedule.call(fn).thursdays();
schedule.call(fn).fridays();
schedule.call(fn).saturdays();
schedule.call(fn).sundays();

// Specific days combination
schedule.call(fn).days(1, 3, 5);  // Mon, Wed, Fri
```

Day-of-week helpers can be combined with an hour/minute frequency:

```typescript
schedule
    .call(fn)
    .daily()
    .weekdays(); // Monday–Friday at midnight only
```

---

## Task Options

### `.name(description)`

Set a human-readable label shown in `schedule:list`:

```typescript
schedule.call(fn).daily().name("Purge expired sessions");
```

### `.runInBackground()`

Run the task in a separate detached process (fire-and-forget). Only applies to `command()` and `strux()` tasks, not `call()` callbacks:

```typescript
schedule
    .strux("queue:work")
    .everyMinute()
    .runInBackground();
```

### `.withoutOverlapping()`

Prevent a task from running if a previous instance is still executing. Uses a lock file in `storage/framework/schedule/`:

```typescript
schedule.strux("queue:work").everyMinute().withoutOverlapping();
```

### `.environments(...envs)`

Only run this task in specific environments. Checks `APP_ENV` or `NODE_ENV`:

```typescript
schedule
    .job(new SendNewsletterJob())
    .weekly()
    .environments("production");

// Multiple environments
schedule.call(fn).daily().environments("production", "staging");
```

### `.timezone(tz)`

Evaluate the cron expression in a specific timezone:

```typescript
schedule
    .call(fn)
    .dailyAt("09:00")
    .timezone("America/New_York");
```

---

## Running the Scheduler

### Development - daemon process

`schedule:work` starts a long-running daemon that ticks every minute, aligned to wall-clock minute boundaries:

```bash
npx strux schedule:work
```

The daemon runs immediately on start and then waits until the next `:00` seconds of each minute. Stop it with `Ctrl+C`.

### Production - system cron

In production, set up a single system cron entry that calls `schedule:run` every minute. StruxJS handles which tasks are actually due:

```cron
* * * * * cd /var/www/myapp && npx strux schedule:run >> /var/log/scheduler.log 2>&1
```

`schedule:run` runs all due tasks once and exits immediately - no long-running process needed.

### Testing - date override

Pass a specific ISO date to test which tasks would run at a given time:

```bash
npx strux schedule:run --date "2026-07-28T08:00:00.000Z"
```

---

## Listing Registered Tasks

```bash
npx strux schedule:list
```

Output:

```
[StruxJS Scheduler] 3 scheduled task(s):

  Expression    Description
  ----------    ----------------------------------------
  * * * * *     Hello
  0 0 * * *     Clear expired data
  0 */6 * * *   strux cache:clear
```

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `npx strux schedule:run` | Run all due tasks once and exit |
| `npx strux schedule:run --date <iso>` | Run tasks due at a specific date/time |
| `npx strux schedule:work` | Start the scheduler daemon (development) |
| `npx strux schedule:list` | List all registered tasks with their cron expressions |

---

## Production Setup

### Using a system cron

The recommended approach for production is a single system cron entry that calls `schedule:run` every minute. This requires no persistent process - the command runs, executes due tasks, and exits:

```cron
* * * * * cd /var/www/myapp && node dist/cli/index.js schedule:run >> /var/log/strux-scheduler.log 2>&1
```

Open your crontab with `crontab -e` and add the line above. Adjust the path to match your deployment directory.

### Using PM2

If you prefer a managed daemon over a system cron, run `schedule:work` under PM2:

```bash
pm2 start "node dist/cli/index.js schedule:work" --name "scheduler"
pm2 save
pm2 startup
```

PM2 will restart the process automatically if it crashes and persist it across server reboots.

### Using systemd

Create a service file at `/etc/systemd/system/strux-scheduler.service`:

```ini
[Unit]
Description=StruxJS Task Scheduler
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/myapp
ExecStart=node dist/cli/index.js schedule:work
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable strux-scheduler
sudo systemctl start strux-scheduler
sudo systemctl status strux-scheduler
```
