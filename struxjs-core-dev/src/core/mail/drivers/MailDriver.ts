import { MailMessage } from "../MailMessage.js";

/**
 * MailDriver — interface all mail transport drivers must implement.
 */
export interface MailDriver {
    send(message: MailMessage): Promise<void>;
}
