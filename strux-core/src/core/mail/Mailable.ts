import { MailMessage } from "./MailMessage.js";

/**
 * Mailable — abstract base class for all application mailables.
 *
 * Usage:
 *   export class WelcomeMail extends Mailable {
 *       constructor(private user: User) { super(); }
 *
 *       build(message: MailMessage): MailMessage {
 *           return message
 *               .subject("Welcome to our platform!")
 *               .view("emails.welcome", { user: this.user });
 *       }
 *   }
 *
 *   // Send immediately
 *   await Mail.to("user@example.com").send(new WelcomeMail(user));
 *
 *   // Queue for background delivery
 *   await Mail.to("user@example.com").queue(new WelcomeMail(user));
 */
export abstract class Mailable {
    /** Override to set a default FROM address for this mailable. */
    public fromAddress: string = "";
    public fromName: string = "";

    /**
     * Build the mail message.
     * Called automatically by the mailer — do not call directly.
     *
     * @param message  A fresh MailMessage builder instance
     * @returns        The configured MailMessage
     */
    public abstract build(message: MailMessage): MailMessage | Promise<MailMessage>;

    /**
     * Render the mailable into a MailMessage envelope.
     * @internal — used by Mail facade and drivers
     */
    public async buildMessage(overrideTo?: string[]): Promise<MailMessage> {
        const message = new MailMessage();

        // Apply mailable-level from if set
        if (this.fromAddress) {
            message.from(this.fromAddress, this.fromName || undefined);
        }

        // Run user-defined build()
        const built = await this.build(message);

        // Apply override recipients (from Mail.to(...))
        if (overrideTo && overrideTo.length > 0) {
            built.toAddresses = overrideTo;
        }

        return built;
    }
}
