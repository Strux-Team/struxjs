import { MailDriver } from "./MailDriver.js";
import { MailMessage } from "../MailMessage.js";
import path from "path";
import fs from "fs";
import { TemplateEngine } from "../../view/TemplateEngine.js";

export interface MailgunConfig {
    apiKey: string;
    domain: string;
    /** "api.mailgun.net" (US) or "api.eu.mailgun.net" (EU) */
    host?: string;
    fromAddress?: string;
    fromName?: string;
}

export class MailgunDriver implements MailDriver {
    private baseUrl: string;

    constructor(private config: MailgunConfig) {
        const host = config.host || "api.mailgun.net";
        this.baseUrl = `https://${host}/v3/${config.domain}/messages`;
    }

    async send(message: MailMessage): Promise<void> {
        const htmlContent = await this.resolveHtml(message);
        const from = this.buildFrom(message);

        // Build form data payload
        const formParts: string[] = [];
        const encode = (k: string, v: string) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;

        formParts.push(encode("from", from));
        formParts.push(encode("to", message.toAddresses.join(",")));
        formParts.push(encode("subject", message.subjectLine));

        if (htmlContent) formParts.push(encode("html", htmlContent));
        if (message.textBody) formParts.push(encode("text", message.textBody));
        if (message.ccAddresses.length)  formParts.push(encode("cc",  message.ccAddresses.join(",")));
        if (message.bccAddresses.length) formParts.push(encode("bcc", message.bccAddresses.join(",")));
        if (message.replyToAddress)      formParts.push(encode("h:Reply-To", message.replyToAddress));
        for (const tag of message.tags)  formParts.push(encode("o:tag", tag));

        for (const [key, val] of Object.entries(message.headers)) {
            formParts.push(encode(`h:${key}`, val));
        }

        const body = formParts.join("&");
        const credentials = Buffer.from(`api:${this.config.apiKey}`).toString("base64");

        const res = await fetch(this.baseUrl, {
            method: "POST",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`[StruxJS Mail] Mailgun error ${res.status}: ${text}`);
        }
    }

    private buildFrom(message: MailMessage): string {
        const addr = message.fromAddress || this.config.fromAddress || "";
        const name = message.fromName   || this.config.fromName    || "";
        return name ? `${name} <${addr}>` : addr;
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
