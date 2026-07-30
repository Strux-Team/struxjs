import { MailDriver } from "./MailDriver.js";
import { MailMessage } from "../MailMessage.js";

/**
 * ArrayDriver — stores all sent emails in memory.
 * Designed for unit/feature testing — no real emails sent.
 *
 * Usage in tests:
 *   Mail.fake(); // switches to ArrayDriver
 *
 *   await Mail.to("user@example.com").send(new WelcomeMail(user));
 *
 *   const sent = Mail.sent();
 *   expect(sent).toHaveLength(1);
 *   expect(sent[0].toAddresses).toContain("user@example.com");
 */
export class ArrayDriver implements MailDriver {
    private static messages: MailMessage[] = [];

    async send(message: MailMessage): Promise<void> {
        ArrayDriver.messages.push(message);
    }

    /** Return all emails captured since last reset(). */
    static all(): MailMessage[] {
        return [...ArrayDriver.messages];
    }

    /** Clear captured emails. */
    static reset(): void {
        ArrayDriver.messages = [];
    }

    /** Check if any email was sent to the given address. */
    static sentTo(address: string): boolean {
        return ArrayDriver.messages.some(m => m.toAddresses.includes(address));
    }

    /** Find emails with a specific subject. */
    static withSubject(subject: string): MailMessage[] {
        return ArrayDriver.messages.filter(m => m.subjectLine === subject);
    }
}
