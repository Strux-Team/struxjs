import { Command } from "struxjs";
import { Command as CommanderCommand } from "commander";

export class SendEmailsCommand extends Command {
    // The name and signature of the console command
    protected signature = "app:sendemails";
    
    // The console command description
    protected description = "Description of SendEmailsCommand";

    /**
     * Configure options for the command.
     */
    protected configure(command: CommanderCommand): void {
        // command.option('--force', 'Force execution');
    }

    // Execute the console command
    public async handle(...args: any[]): Promise<void> {
        console.log("Console command [SendEmailsCommand] executed successfully!");
    }
}
