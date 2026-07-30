import { ScheduleEvent, ScheduleEventCallback } from "./ScheduleEvent.js";
import { Scheduler } from "./Scheduler.js";
import { exec } from "child_process";

/**
 * Schedule — fluent entry point for registering scheduled tasks.
 *
 * Used inside Console/Kernel.ts:
 *
 *   protected schedule(schedule: Schedule): void {
 *       schedule.call(() => cleanTemp()).daily();
 *       schedule.command('db:seed').weekly();
 *       schedule.job(new GenerateReportJob()).hourly();
 *   }
 */
export class Schedule {
    constructor(private readonly scheduler: Scheduler) {}

    /* ---------------------------------------------------------------------- */
    /*  Task registration                                                      */
    /* ---------------------------------------------------------------------- */

    /**
     * Schedule an arbitrary async callback.
     *
     *   schedule.call(async () => {
     *       await db.query('DELETE FROM temp_logs WHERE created_at < NOW() - INTERVAL 7 DAY');
     *   }).daily();
     */
    public call(callback: ScheduleEventCallback): ScheduleEvent {
        const event = new ScheduleEvent(callback, this.scheduler.nextId());
        this.scheduler.addEvent(event);
        return event;
    }

    /**
     * Schedule a shell command.
     *
     *   schedule.command('php artisan cache:clear').hourly();
     *   schedule.command('node dist/cli/index.js db:seed').weekly();
     */
    public command(cmd: string): ScheduleEvent {
        const callback: ScheduleEventCallback = () =>
            new Promise<void>((resolve, reject) => {
                exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
                    if (stdout) process.stdout.write(stdout);
                    if (stderr) process.stderr.write(stderr);
                    if (err) reject(err);
                    else resolve();
                });
            });

        const event = new ScheduleEvent(callback, this.scheduler.nextId());
        this.scheduler.addEvent(event);
        return event.name(cmd);
    }

    /**
     * Schedule a StruxJS Job instance (dispatches to the queue).
     *
     *   schedule.job(new GenerateReportJob()).daily();
     */
    public job(jobInstance: { serialize: () => any; handle: () => Promise<void> }): ScheduleEvent {
        const jobName  = jobInstance.constructor.name;
        const callback: ScheduleEventCallback = () => jobInstance.handle();

        const event = new ScheduleEvent(callback, this.scheduler.nextId());
        this.scheduler.addEvent(event);
        return event.name(`Job: ${jobName}`);
    }

    /**
     * Schedule a Strux CLI command by name.
     *
     *   schedule.strux('db:seed').weekly();
     *   schedule.strux('cache:clear').hourly();
     */
    public strux(signature: string): ScheduleEvent {
        const cliPath = `node ${process.cwd()}/dist/cli/index.js`;
        return this.command(`${cliPath} ${signature}`).name(`strux ${signature}`);
    }
}
