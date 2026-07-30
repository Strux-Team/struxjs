import { MailDriver } from "./MailDriver.js";
import { MailMessage } from "../MailMessage.js";
import nodemailer, { Transporter } from "nodemailer";
import path from "path";
import fs from "fs";
import { TemplateEngine } from "../../view/TemplateEngine.js";

export interface SmtpConfig {
    host: string;
    port: number;
    secure?: boolean;         // true = TLS (port 465), false = STARTTLS (port 587)
    username?: string;
    password?: string;
    fromAddress?: string;
    fromName?: string;
    timeout?: number;
}

export class SmtpDriver implements MailDriver {
    private transporter: Transporter;

    constructor(private config: SmtpConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure ?? config.port === 465,
            auth: config.username ? {
                user: config.username,
                pass: config.password || ""
            } : undefined,
            connectionTimeout: (config.timeout || 30) * 1000
        });
    }

    async send(message: MailMessage): Promise<void> {
        const htmlContent = await this.resolveHtml(message);

        const mailOptions: any = {
            from: this.buildFrom(message),
            to:   message.toAddresses.join(", "),
            subject: message.subjectLine,
            html: htmlContent || undefined,
            text: message.textBody || undefined,
            headers: message.headers,
            priority: this.mapPriority(message.priority),
            attachments: message.attachments.map(a => ({
                filename: a.filename,
                contentType: a.contentType,
                ...(typeof a.content === "string" && fs.existsSync(a.content)
                    ? { path: a.content }
                    : { content: a.content })
            }))
        };

        if (message.ccAddresses.length)    mailOptions.cc  = message.ccAddresses.join(", ");
        if (message.bccAddresses.length)   mailOptions.bcc = message.bccAddresses.join(", ");
        if (message.replyToAddress)        mailOptions.replyTo = message.replyToAddress;

        await this.transporter.sendMail(mailOptions);
    }

    private buildFrom(message: MailMessage): string {
        const addr = message.fromAddress || this.config.fromAddress || "";
        const name = message.fromName   || this.config.fromName    || "";
        return name ? `"${name}" <${addr}>` : addr;
    }

    private async resolveHtml(message: MailMessage): Promise<string> {
        // Priority: explicit html() > view template
        if (message.htmlBody) return message.htmlBody;

        if (message.viewTemplate) {
            return this.renderView(message.viewTemplate, message.viewData);
        }

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

    private mapPriority(p: 1 | 3 | 5): "high" | "normal" | "low" {
        return p === 1 ? "high" : p === 5 ? "low" : "normal";
    }
}
