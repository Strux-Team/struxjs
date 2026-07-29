import { Schedule } from "struxjs";

export default function (schedule: Schedule): void {
    // schedule
    //     .call(async () => {
    //         // await SessionStore.clearExpired();
    //     })
    //     .daily()
    //     .name("Clear expired sessions");

    // schedule
    //     .job(new SendWeeklyNewsletterJob())
    //     .weeklyOn(1, "08:00")
    //     .environments("production");

    // schedule
    //     .strux("cache:clear")
    //     .hourly()
    //     .withoutOverlapping();

}
