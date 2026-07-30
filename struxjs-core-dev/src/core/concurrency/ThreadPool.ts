import { Worker } from "worker_threads";
import os from "os";

export class ThreadPool {
    private static maxWorkers = Math.max(1, os.cpus().length - 1);
    private static activeWorkers = 0;
    private static queue: Array<{ scriptPath: string; workerData: any; resolve: (res: any) => void; reject: (err: any) => void }> = [];

    /**
     * Set max worker threads allowed (default: CPU cores - 1)
     */
    public static setMaxWorkers(limit: number): void {
        this.maxWorkers = limit;
    }

    /**
     * Run a worker script off the main Event Loop thread
     */
    public static async run<T = any>(scriptPath: string, workerData: any = {}): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.activeWorkers >= this.maxWorkers) {
                this.queue.push({ scriptPath, workerData, resolve, reject });
            } else {
                this.executeWorker(scriptPath, workerData, resolve, reject);
            }
        });
    }

    private static executeWorker(scriptPath: string, workerData: any, resolve: (res: any) => void, reject: (err: any) => void): void {
        this.activeWorkers++;

        const worker = new Worker(scriptPath, { workerData });

        worker.on("message", (result) => {
            resolve(result);
            this.cleanupWorker();
        });

        worker.on("error", (error) => {
            reject(error);
            this.cleanupWorker();
        });

        worker.on("exit", (code) => {
            if (code !== 0) {
                reject(new Error(`[StruxJS ThreadPool Error]: Worker stopped with exit code ${code}`));
            }
            this.cleanupWorker();
        });
    }

    private static cleanupWorker(): void {
        this.activeWorkers--;
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            this.executeWorker(next.scriptPath, next.workerData, next.resolve, next.reject);
        }
    }
}
