import { Command as CommanderCommand } from "commander";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";

export abstract class Command {
    /**
     * The name and signature of the console command.
     * Example: 'email:send <user>'
     */
    protected signature: string = "";

    /**
     * The console command description.
     */
    protected description: string = "";

    /**
     * Configure options for the command.
     * Override this method to add custom .option() flags using Commander.
     */
    protected configure(command: CommanderCommand): void {
        // Example: command.option('--force', 'Force the operation');
    }

    /**
     * Execute the console command.
     */
    public abstract handle(...args: any[]): Promise<void> | void;

    /**
     * Register the command with the Commander program.
     * Used internally by the framework.
     */
    public register(program: CommanderCommand): void {
        const cmd = program
            .command(this.signature)
            .description(this.description);
            
        this.configure(cmd);

        cmd.action(async (...args: any[]) => {
            try {
                const configPath = path.join(process.cwd(), "config", "database.ts");
                const jsConfigPath = path.join(process.cwd(), "config", "database.js");

                let dbConfig: any = null;
                if (fs.existsSync(configPath)) {
                    const mod = await import(pathToFileURL(configPath).href);
                    dbConfig = mod.default || mod;
                } else if (fs.existsSync(jsConfigPath)) {
                    const mod = await import(pathToFileURL(jsConfigPath).href);
                    dbConfig = mod.default || mod;
                }

                if (dbConfig) {
                    const { BaseModel } = await import("../database/BaseModel.js");
                    await BaseModel.bootConnection(dbConfig);
                }
            } catch {}

            await this.handle(...args);
            process.exit(0);
        });
    }
}
