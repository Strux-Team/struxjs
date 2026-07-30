import { Schedule } from "./Schedule.js";
import { Scheduler } from "./Scheduler.js";

/**
 * ConsoleKernel — abstract base class for the application's task scheduler.
 *
 * Extend this in your app and override schedule() to register tasks:
 *
 *   // app/Console/Kernel.ts
 *   import { ConsoleKernel, Schedule } from "struxjs";
 *
 *   export class Kernel extends ConsoleKernel {
 *       protected schedule(schedule: Schedule): void {
 *           schedule
 *               .call(() => this.cleanTempFiles())
 *               .daily()
 *               .name("Clean temp files");
 *
 *           schedule
 *               .command("node dist/cli/index.js db:seed --class=CacheSeeder")
 *               .hourly()
 *               .withoutOverlapping();
 *
 *           schedule
 *               .job(new GenerateReportJob())
 *               .weeklyOn(1, "08:00")      // Monday 08:00
 *               .environments("production");
 *       }
 *   }
 *
 * Register in bootstrap.ts:
 *   import { Kernel } from "./app/Console/Kernel.js";
 *   app.useScheduler(new Kernel());
 *
 * Or use CLI:
 *   npx strux schedule:work     — daemon, ticks every minute
 *   npx strux schedule:run      — run due tasks once and exit
 *   npx strux schedule:list     — list all registered tasks
 */
export abstract class ConsoleKernel {
    private _scheduler: Scheduler | null = null;

    /* ---------------------------------------------------------------------- */
    /*  User API                                                               */
    /* ---------------------------------------------------------------------- */

    /**
     * Define your scheduled tasks here.
     * Called lazily the first time the scheduler is accessed.
     */
    protected abstract schedule(schedule: Schedule): void;

    /* ---------------------------------------------------------------------- */
    /*  Internal plumbing                                                      */
    /* ---------------------------------------------------------------------- */

    /**
     * Get (or lazily build) the Scheduler instance.
     * Calling this triggers schedule() exactly once.
     */
    public getScheduler(): Scheduler {
        if (!this._scheduler) {
            this._scheduler = new Scheduler();
            const builder   = new Schedule(this._scheduler);
            this.schedule(builder);
        }
        return this._scheduler;
    }

    /**
     * Run all tasks that are due right now.
     * Safe to call every minute from a cron / daemon.
     */
    public async tick(date?: Date): Promise<void> {
        await this.getScheduler().tick(date);
    }

    /**
     * Return a summary of all registered tasks.
     */
    public list(): Array<{ description: string; expression: string }> {
        return this.getScheduler().list();
    }
}
