import { Job } from "struxjs";
import { User } from "../Models/User.js";

export class SendLoginNotifyJob extends Job {
    /** Target queue — override or pass at dispatch time. */
    public queue = "default";

    /** Max retries before the job is marked as failed. */
    public tries = 3;

    constructor(/* public readonly someProperty: string */) {
        super();
    }

    public async handle(): Promise<void> {
        // TODO: implement job logic
        // console.log("[SendLoginNotifyJob] Executing...");
        const users = await User.all();
        console.log(users);

    }

    public async failed(error: Error): Promise<void> {
        // Optional: notify, clean up, etc. when all retries are exhausted
        console.error("[SendLoginNotifyJob] Permanently failed:", error.message);
    }
}
