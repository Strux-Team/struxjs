import { Job } from "../queue/Job.js";
import { MailMessage } from "./MailMessage.js";
import { Mail } from "./Mail.js";

/**
 * SendMailJob — internal job used by Mail.to(...).queue(mailable).
 * Serializes the fully-built MailMessage and sends it via the queue worker.
 *
 * @internal — not intended for direct use. Use Mail.to(...).queue() instead.
 */
export class SendMailJob extends Job {
    public queue = "default";
    public tries = 3;
    public timeout = 60;

    private serializedMessage: Record<string, any>;
    private mailerName?: string;

    constructor(message: MailMessage, mailerName?: string) {
        super();
        // Serialize MailMessage to plain object for queue storage
        this.serializedMessage = {
            toAddresses:    message.toAddresses,
            ccAddresses:    message.ccAddresses,
            bccAddresses:   message.bccAddresses,
            fromAddress:    message.fromAddress,
            fromName:       message.fromName,
            replyToAddress: message.replyToAddress,
            subjectLine:    message.subjectLine,
            htmlBody:       message.htmlBody,
            textBody:       message.textBody,
            viewTemplate:   message.viewTemplate,
            viewData:       message.viewData,
            headers:        message.headers,
            tags:           message.tags,
            priority:       message.priority,
            // Note: attachments with Buffer content are not serializable — file paths are fine
            attachments:    message.attachments.filter(a => typeof a.content === "string").map(a => ({
                content:     a.content,
                filename:    a.filename,
                contentType: a.contentType
            }))
        };
        this.mailerName = mailerName;
    }

    async handle(): Promise<void> {
        const message = new MailMessage();
        Object.assign(message, this.serializedMessage);

        const driver = Mail.resolveDriver(this.mailerName);
        await driver.send(message);
    }

    async failed(error: Error): Promise<void> {
        console.error(`[StruxJS Mail] SendMailJob failed after ${this.tries} attempts: ${error.message}`);
        console.error(`  To: ${this.serializedMessage.toAddresses?.join(", ")}`);
        console.error(`  Subject: ${this.serializedMessage.subjectLine}`);
    }
}
