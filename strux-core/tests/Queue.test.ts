import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { Job, Queue, QueueWorker } from "../src/index.js";
import { FileDriver } from "../src/core/queue/drivers/FileDriver.js";
import fs from "fs";
import path from "path";
import os from "os";

class SampleJob extends Job {
    public static handled: string[] = [];

    constructor(public payloadText: string) {
        super();
    }

    public async handle(): Promise<void> {
        SampleJob.handled.push(this.payloadText);
    }
}

class FailingJob extends Job {
    public static failedErrors: string[] = [];

    constructor(public message: string) {
        super();
        this.tries = 1;
    }

    public async handle(): Promise<void> {
        throw new Error(this.message);
    }

    public async failed(error: Error): Promise<void> {
        FailingJob.failedErrors.push(error.message);
    }
}

describe("Queue System", () => {
    beforeEach(() => {
        SampleJob.handled = [];
        FailingJob.failedErrors = [];
        Job.register(SampleJob, FailingJob);
    });

    test("serializes and deserializes job instance", () => {
        const original = new SampleJob("hello world");
        const envelope = original.serialize();

        expect(envelope.jobClass).toBe("SampleJob");
        expect(envelope.payload).toEqual({ payloadText: "hello world" });

        const deserialized = Job.deserialize(envelope) as SampleJob;
        expect(deserialized).toBeInstanceOf(SampleJob);
        expect(deserialized.payloadText).toBe("hello world");
    });

    test("SyncDriver executes job immediately upon push", async () => {
        const sampleJob = new SampleJob("immediate execution");
        await Queue.push(sampleJob);

        expect(SampleJob.handled).toEqual(["immediate execution"]);
    });

    test("FileDriver queues and pops jobs, QueueWorker processes them", async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strux-queue-test-"));
        const driver = new FileDriver(tmpDir);

        try {
            const job = new SampleJob("queued in file");
            await driver.push(job.serialize(), "default");

            expect(await driver.size("default")).toBe(1);

            const worker = new QueueWorker({
                driverOverride: driver,
                stopWhenEmpty: true,
                sleep: 0.01,
            });

            await worker.work();

            expect(SampleJob.handled).toEqual(["queued in file"]);
            expect(await driver.size("default")).toBe(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test("QueueWorker moves job to failed state after max tries", async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strux-queue-fail-test-"));
        const driver = new FileDriver(tmpDir);

        try {
            const failingJob = new FailingJob("Fatal queue error");
            await driver.push(failingJob.serialize(), "default");

            const worker = new QueueWorker({
                driverOverride: driver,
                stopWhenEmpty: true,
                maxTries: 1,
                sleep: 0.01,
            });

            await worker.work();

            expect(FailingJob.failedErrors).toEqual(["Fatal queue error"]);
            const failed = await driver.getFailed();
            expect(failed.length).toBe(1);
            expect(failed[0].lastError).toContain("Fatal queue error");
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
