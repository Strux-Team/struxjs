/**
 * MailMessage — fluent builder for composing email messages.
 *
 * Usage inside Mailable.build():
 *   return message
 *       .subject("Welcome!")
 *       .view("emails.welcome", { user })
 *       .cc("boss@example.com");
 */
export interface MailAttachment {
    /** Absolute path or Buffer content */
    content: string | Buffer;
    /** Filename shown to recipient */
    filename: string;
    /** MIME type, e.g. "application/pdf" */
    contentType?: string;
}

export class MailMessage {
    public toAddresses: string[] = [];
    public ccAddresses: string[] = [];
    public bccAddresses: string[] = [];
    public fromAddress: string = "";
    public fromName: string = "";
    public replyToAddress: string = "";
    public subjectLine: string = "";
    public htmlBody: string = "";
    public textBody: string = "";
    public viewTemplate: string = "";
    public viewData: Record<string, any> = {};
    public attachments: MailAttachment[] = [];
    public headers: Record<string, string> = {};
    public tags: string[] = [];
    public priority: 1 | 3 | 5 = 3; // 1=high, 3=normal, 5=low

    /* ------------------------------------------------------------------ */
    /*  Recipients                                                         */
    /* ------------------------------------------------------------------ */

    to(address: string | string[]): this {
        const list = Array.isArray(address) ? address : [address];
        this.toAddresses.push(...list);
        return this;
    }

    cc(address: string | string[]): this {
        const list = Array.isArray(address) ? address : [address];
        this.ccAddresses.push(...list);
        return this;
    }

    bcc(address: string | string[]): this {
        const list = Array.isArray(address) ? address : [address];
        this.bccAddresses.push(...list);
        return this;
    }

    replyTo(address: string): this {
        this.replyToAddress = address;
        return this;
    }

    /* ------------------------------------------------------------------ */
    /*  Sender                                                             */
    /* ------------------------------------------------------------------ */

    from(address: string, name?: string): this {
        this.fromAddress = address;
        if (name) this.fromName = name;
        return this;
    }

    /* ------------------------------------------------------------------ */
    /*  Content                                                            */
    /* ------------------------------------------------------------------ */

    subject(line: string): this {
        this.subjectLine = line;
        return this;
    }

    /**
     * Render a .strux view template as email HTML body.
     * @param template  Dot-notation path, e.g. "emails.welcome"
     * @param data      Variables passed to the template
     */
    view(template: string, data: Record<string, any> = {}): this {
        this.viewTemplate = template;
        this.viewData = data;
        return this;
    }

    /** Set raw HTML body directly (skips template engine). */
    html(content: string): this {
        this.htmlBody = content;
        return this;
    }

    /** Plain-text fallback body. */
    text(content: string): this {
        this.textBody = content;
        return this;
    }

    /* ------------------------------------------------------------------ */
    /*  Attachments                                                        */
    /* ------------------------------------------------------------------ */

    /** Attach a file by absolute path. */
    attach(filePath: string, filename?: string, contentType?: string): this {
        this.attachments.push({
            content: filePath,
            filename: filename || filePath.split("/").pop() || "attachment",
            contentType
        });
        return this;
    }

    /** Attach raw buffer/string data. */
    attachData(content: Buffer | string, filename: string, contentType?: string): this {
        this.attachments.push({ content, filename, contentType });
        return this;
    }

    /* ------------------------------------------------------------------ */
    /*  Extras                                                             */
    /* ------------------------------------------------------------------ */

    header(key: string, value: string): this {
        this.headers[key] = value;
        return this;
    }

    tag(name: string): this {
        this.tags.push(name);
        return this;
    }

    highPriority(): this {
        this.priority = 1;
        return this;
    }

    lowPriority(): this {
        this.priority = 5;
        return this;
    }
}
