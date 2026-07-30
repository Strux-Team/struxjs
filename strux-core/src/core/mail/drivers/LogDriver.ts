import { MailDriver } from "./MailDriver.js";
import { MailMessage } from "../MailMessage.js";
import path from "path";
import fs from "fs";
import { TemplateEngine } from "../../view/TemplateEngine.js";

/**
 * LogDriver — writes email content to the application log file.
 * Perfect for local development — no real email sent.
 *
 * Set MAIL_DRIVER=log in .env to activate.
 */
export class LogDriver implements MailDriver {
    private logPath: string;

    constructor(logPath?: string) {
        this.logPath = logPath || path.join(process.cwd(), "storage", "logs", "mail.log");
    }

    async send(message: MailMessage): Promise<void> {
        const htmlContent = await this.resolveHtml(message);
        const timestamp = new Date().toISOString();

        const entry = [
            ``,
            `================================================================================`,
            ` StruxJS Mail — ${timestamp}`,
            `================================================================================`,
            ` From:    ${message.fromAddress}${message.fromName ? ` (${message.fromName})` : ""}`,
            ` To:      ${message.toAddresses.join(", ")}`,
            message.ccAddresses.length  ? ` CC:      ${message.ccAddresses.join(", ")}`  : null,
            message.bccAddresses.length ? ` BCC:     ${message.bccAddresses.join(", ")}` : null,
            message.replyToAddress      ? ` Reply-To: ${message.replyToAddress}`         : null,
            ` Subject: ${message.subjectLine}`,
            `--------------------------------------------------------------------------------`,
            ` HTML Body:`,
            htmlContent || "(none)",
            message.textBody ? `\n Text Body:\n${message.textBody}` : null,
            message.attachments.length
                ? ` Attachments: ${message.attachments.map(a => a.filename).join(", ")}`
                : null,
            `================================================================================`,
        ].filter(Boolean).join("\n");

        // Ensure log directory exists
        const logDir = path.dirname(this.logPath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        fs.appendFileSync(this.logPath, entry + "\n");

        console.log(`\x1b[36m[StruxJS Mail] Email logged → ${this.logPath}\x1b[0m`);
        console.log(`\x1b[36m  To: ${message.toAddresses.join(", ")} | Subject: ${message.subjectLine}\x1b[0m`);
    }

    private async resolveHtml(message: MailMessage): Promise<string> {
        if (message.htmlBody) return message.htmlBody;
        if (message.viewTemplate) return this.renderView(message.viewTemplate, message.viewData);
        return "";
    }

    private renderView(template: string, data: Record<string, any>): string {
        const cleanName = template.replace(/\./g, path.sep);
        const viewPath  = path.join(process.cwd(), "resources", "views", `${cleanName}.strux`);

        if (!fs.existsSync(viewPath)) {
            throw new Error(`[StruxJS Mail] View not found: ${viewPath}`);
        }

        const engine = new TemplateEngine();
        return engine.render(viewPath, data);
    }
}
