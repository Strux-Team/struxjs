import { exec } from "child_process";
import fs from "fs";
import path from "path";

export type ScheduleEventCallback = () => any | Promise<any>;

export interface ScheduleEventOptions {
    withoutOverlapping: boolean;
    runInBackground: boolean;
    environments: string[];
    description: string;
    timezone: string | null;
}

/**
 * ScheduleEvent — represents a single scheduled task.
 *
 * You don't create this directly — use the Schedule builder:
 *   schedule.call(() => cleanTempFiles()).daily();
 *   schedule.command('db:seed').weekly();
 *   schedule.job(new ReportJob()).hourly();
 */
export class ScheduleEvent {
    /* ---------------------------------------------------------------------- */
    /*  Cron expression fields                                                 */
    /* ---------------------------------------------------------------------- */
    private _minute   = "*";
    private _hour     = "*";
    private _day      = "*";   // day-of-month
    private _month    = "*";
    private _weekday  = "*";   // 0 = Sunday

    /* ---------------------------------------------------------------------- */
    /*  State                                                                  */
    /* ---------------------------------------------------------------------- */
    private _description  = "";
    private _withoutOverlapping = false;
    private _runInBackground    = false;
    private _environments: string[] = [];
    private _timezone: string | null = null;
    private _lastRunAt: number | null = null;

    /** Lock file path for withoutOverlapping (stored per-description or auto-id) */
    private _lockFile: string;

    constructor(
        private readonly _callback: ScheduleEventCallback,
        private readonly _id: string
    ) {
        this._lockFile = path.join(
            process.cwd(), "storage", "framework", "schedule", `${_id}.lock`
        );
    }

    /* ---------------------------------------------------------------------- */
    /*  Frequency — cron expression                                            */
    /* ---------------------------------------------------------------------- */

    /** Set a raw cron expression (5-field: min hour dom month dow). */
    public cron(expression: string): this {
        const parts = expression.trim().split(/\s+/);
        if (parts.length !== 5) {
            throw new Error(`[StruxJS Scheduler] Invalid cron expression "${expression}". Expected 5 fields.`);
        }
        [this._minute, this._hour, this._day, this._month, this._weekday] = parts;
        return this;
    }

    /** Every minute — * * * * * */
    public everyMinute(): this { return this.cron("* * * * *"); }

    /** Every N minutes — */
    public everyMinutes(n: number): this { return this.cron(`*/${n} * * * *`); }

    /** Every 2 minutes */
    public everyTwoMinutes(): this { return this.everyMinutes(2); }
    /** Every 3 minutes */
    public everyThreeMinutes(): this { return this.everyMinutes(3); }
    /** Every 5 minutes */
    public everyFiveMinutes(): this { return this.everyMinutes(5); }
    /** Every 10 minutes */
    public everyTenMinutes(): this { return this.everyMinutes(10); }
    /** Every 15 minutes */
    public everyFifteenMinutes(): this { return this.everyMinutes(15); }
    /** Every 30 minutes */
    public everyThirtyMinutes(): this { return this.everyMinutes(30); }

    /** Every hour at :00 */
    public hourly(): this { return this.cron("0 * * * *"); }
    /** Every hour at :mm */
    public hourlyAt(minute: number): this { return this.cron(`${minute} * * * *`); }
    /** Every N hours */
    public everyHours(n: number): this { return this.cron(`0 */${n} * * *`); }
    public everyTwoHours(): this { return this.everyHours(2); }
    public everyThreeHours(): this { return this.everyHours(3); }
    public everySixHours(): this { return this.everyHours(6); }

    /** Daily at midnight */
    public daily(): this { return this.cron("0 0 * * *"); }
    /** Daily at HH:MM (24h) */
    public dailyAt(time: string): this {
        const [h, m] = time.split(":").map(Number);
        return this.cron(`${m ?? 0} ${h ?? 0} * * *`);
    }
    /** Twice a day at two times */
    public twiceDaily(first = 1, second = 13): this {
        return this.cron(`0 ${first},${second} * * *`);
    }

    /** Weekly on Sunday at midnight */
    public weekly(): this { return this.cron("0 0 * * 0"); }
    /** Weekly on a specific day and time (0=Sun … 6=Sat) */
    public weeklyOn(day: number, time = "0:0"): this {
        const [h, m] = time.split(":").map(Number);
        return this.cron(`${m ?? 0} ${h ?? 0} * * ${day}`);
    }

    /** Monthly on the 1st at midnight */
    public monthly(): this { return this.cron("0 0 1 * *"); }
    /** Monthly on a specific day and time */
    public monthlyOn(day = 1, time = "0:0"): this {
        const [h, m] = time.split(":").map(Number);
        return this.cron(`${m ?? 0} ${h ?? 0} ${day} * *`);
    }
    /** Twice a month */
    public twiceMonthly(first = 1, second = 16, time = "0:0"): this {
        const [h, m] = time.split(":").map(Number);
        return this.cron(`${m ?? 0} ${h ?? 0} ${first},${second} * *`);
    }

    /** Quarterly — 1st of Jan, Apr, Jul, Oct */
    public quarterly(): this { return this.cron("0 0 1 1,4,7,10 *"); }

    /** Yearly on Jan 1st */
    public yearly(): this { return this.cron("0 0 1 1 *"); }
    /** Yearly on a specific month/day */
    public yearlyOn(month = 1, day = 1, time = "0:0"): this {
        const [h, m] = time.split(":").map(Number);
        return this.cron(`${m ?? 0} ${h ?? 0} ${day} ${month} *`);
    }

    /** Only weekdays (Mon–Fri) */
    public weekdays(): this { this._weekday = "1-5"; return this; }
    /** Only weekends (Sat–Sun) */
    public weekends(): this { this._weekday = "6,0"; return this; }

    /** Run on specific days of the week (0=Sun) */
    public days(...days: number[]): this { this._weekday = days.join(","); return this; }
    public mondays(): this    { return this.days(1); }
    public tuesdays(): this   { return this.days(2); }
    public wednesdays(): this { return this.days(3); }
    public thursdays(): this  { return this.days(4); }
    public fridays(): this    { return this.days(5); }
    public saturdays(): this  { return this.days(6); }
    public sundays(): this    { return this.days(0); }

    /* ---------------------------------------------------------------------- */
    /*  Options                                                                */
    /* ---------------------------------------------------------------------- */

    /** Human-readable label shown in schedule:list. */
    public name(description: string): this { this._description = description; return this; }

    /**
     * Prevent the event from running if a previous instance is still executing.
     * Uses a lock file in storage/framework/schedule/.
     */
    public withoutOverlapping(): this { this._withoutOverlapping = true; return this; }

    /**
     * Run this event in a separate detached process (fire-and-forget).
     * Only applies to shell commands, not closures.
     */
    public runInBackground(): this { this._runInBackground = true; return this; }

    /** Only run in specific environments (process.env.APP_ENV). */
    public environments(...envs: string[]): this { this._environments = envs; return this; }

    /** Set the timezone for this event's schedule evaluation. */
    public timezone(tz: string): this { this._timezone = tz; return this; }

    /* ---------------------------------------------------------------------- */
    /*  Due check                                                              */
    /* ---------------------------------------------------------------------- */

    /**
     * Returns true if the cron expression matches the given date.
     */
    public isDue(date: Date = new Date()): boolean {
        // Environment guard
        if (this._environments.length > 0) {
            const env = process.env.APP_ENV || process.env.NODE_ENV || "production";
            if (!this._environments.includes(env)) return false;
        }

        // Use timezone-adjusted date if specified
        let d = date;
        if (this._timezone) {
            d = new Date(date.toLocaleString("en-US", { timeZone: this._timezone }));
        }

        return (
            this.matchField(this._minute,  d.getMinutes())  &&
            this.matchField(this._hour,    d.getHours())    &&
            this.matchField(this._day,     d.getDate())     &&
            this.matchField(this._month,   d.getMonth() + 1) &&
            this.matchField(this._weekday, d.getDay())
        );
    }

    private matchField(field: string, value: number): boolean {
        if (field === "*") return true;

        for (const part of field.split(",")) {
            // Step: */n or start/n
            if (part.includes("/")) {
                const [range, step] = part.split("/");
                const s = parseInt(step, 10);
                if (range === "*") {
                    if (value % s === 0) return true;
                } else if (range.includes("-")) {
                    const [lo, hi] = range.split("-").map(Number);
                    if (value >= lo && value <= hi && (value - lo) % s === 0) return true;
                }
                continue;
            }
            // Range: a-b
            if (part.includes("-")) {
                const [lo, hi] = part.split("-").map(Number);
                if (value >= lo && value <= hi) return true;
                continue;
            }
            // Exact
            if (parseInt(part, 10) === value) return true;
        }

        return false;
    }

    /* ---------------------------------------------------------------------- */
    /*  Execution                                                              */
    /* ---------------------------------------------------------------------- */

    public async run(): Promise<void> {
        if (this._withoutOverlapping && this.isLocked()) {
            console.log(`[StruxJS Scheduler] Skipping "${this.getDescription()}" — previous instance still running.`);
            return;
        }

        if (this._withoutOverlapping) this.acquireLock();

        try {
            await this._callback();
        } finally {
            if (this._withoutOverlapping) this.releaseLock();
        }

        this._lastRunAt = Date.now();
    }

    /* ---------------------------------------------------------------------- */
    /*  Lock file helpers (withoutOverlapping)                                 */
    /* ---------------------------------------------------------------------- */

    private isLocked(): boolean {
        return fs.existsSync(this._lockFile);
    }

    private acquireLock(): void {
        const dir = path.dirname(this._lockFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this._lockFile, String(process.pid), "utf-8");
    }

    private releaseLock(): void {
        if (fs.existsSync(this._lockFile)) fs.unlinkSync(this._lockFile);
    }

    /* ---------------------------------------------------------------------- */
    /*  Getters                                                                */
    /* ---------------------------------------------------------------------- */

    public getExpression(): string {
        return `${this._minute} ${this._hour} ${this._day} ${this._month} ${this._weekday}`;
    }

    public getDescription(): string {
        return this._description || this._id;
    }

    public getLastRunAt(): number | null {
        return this._lastRunAt;
    }
}
