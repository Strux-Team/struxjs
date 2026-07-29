import { Mailable, MailMessage } from "struxjs";

export class WelcomeMail extends Mailable {
    constructor(
        // public readonly user: any,
    ) {
        super();
    }

    public build(message: MailMessage): MailMessage {
        return message
            .subject("Welcome Mail")
            .view("emails.welcome", {
                // Pass data to the view
            });
    }
}
