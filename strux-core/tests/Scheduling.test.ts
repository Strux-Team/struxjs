import { describe, test, expect, beforeEach } from "vitest";
import { Scheduler, Schedule } from "../src/index.js";

describe("Task Scheduler", () => {
    let scheduler: Scheduler;
    let schedule: Schedule;

    beforeEach(() => {
        scheduler = new Scheduler();
        schedule = new Schedule(scheduler);
    });

    test("registers tasks with frequency rules", () => {
        schedule.call(() => {}).everyFiveMinutes();
        schedule.call(() => {}).hourly();
        schedule.call(() => {}).daily();

        expect(scheduler.count()).toBe(3);
        const list = scheduler.list();
        expect(list[0].expression).toBe("*/5 * * * *");
        expect(list[1].expression).toBe("0 * * * *");
        expect(list[2].expression).toBe("0 0 * * *");
    });

    test("detects due events at matching dates", () => {
        schedule.call(() => {}).everyMinute(); // due every minute
        schedule.call(() => {}).cron("15 10 * * *"); // due at 10:15

        // Match date 2026-07-27 10:15:00
        const dateMatch = new Date(2026, 6, 27, 10, 15, 0);
        const dueMatch = scheduler.dueEvents(dateMatch);
        expect(dueMatch).toHaveLength(2);

        // Date 2026-07-27 10:16:00
        const dateMismatch = new Date(2026, 6, 27, 10, 16, 0);
        const dueMismatch = scheduler.dueEvents(dateMismatch);
        expect(dueMismatch).toHaveLength(1); // only everyMinute
    });

    test("executes due tasks on tick", async () => {
        let executed = false;
        schedule.call(async () => {
            executed = true;
        }).everyMinute();

        await scheduler.tick(new Date());

        expect(executed).toBe(true);
    });
});
