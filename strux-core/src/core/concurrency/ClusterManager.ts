import cluster from "cluster";
import os from "os";

export class ClusterManager {
    /**
     * Check if current process is the primary cluster master
     */
    public static isPrimary(): boolean {
        return cluster.isPrimary || (cluster as any).isMaster;
    }

    /**
     * Fork HTTP worker processes across available CPU cores
     */
    public static fork(workersCount?: number): boolean {
        if (this.isPrimary()) {
            const count = workersCount || os.cpus().length;
            if (process.env.NODE_ENV !== "test") {
                console.log(`[StruxJS Cluster] Primary process PID ${process.pid} running. Forking ${count} workers...`);
            }

            for (let i = 0; i < count; i++) {
                cluster.fork();
            }

            cluster.on("exit", (worker, code, signal) => {
                if (process.env.NODE_ENV !== "test") {
                    console.log(`[StruxJS Cluster] Worker PID ${worker.process.pid} died (${signal || code}). Forking replacement...`);
                }
                cluster.fork();
            });

            return true;
        }
        return false;
    }

    /**
     * Register graceful shutdown hooks to close server and DB connections cleanly
     */
    public static registerGracefulShutdown(onShutdown: () => Promise<void>): void {
        const shutdown = async (signal: string) => {
            if (process.env.NODE_ENV !== "test") {
                console.log(`\n[StruxJS Shutdown] ${signal} received. Closing HTTP server and database connections gracefully...`);
            }
            try {
                await onShutdown();
            } catch (err: any) {
                if (process.env.NODE_ENV !== "test") {
                    console.error("[StruxJS Shutdown Error]:", err.message);
                }
            } finally {
                process.exit(0);
            }
        };

        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
    }
}
