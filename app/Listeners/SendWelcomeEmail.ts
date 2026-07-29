import { Listener } from "struxjs";
import { Event } from "struxjs";

export class SendWelcomeEmail extends Listener {
    public async handle(event: Event): Promise<void> {
        // TODO: implement listener logic
        console.log('SendWelcomeEmail');
        
    }

    public async failed(event: Event, error: Error): Promise<void> {
        // Optional: handle permanent failure
    }
}
