import { MailDriver } from "./drivers/MailDriver.js";
import { SmtpDriver } from "./drivers/SmtpDriver.js";
import { MailgunDriver } from "./drivers/MailgunDriver.js";
import { LogDriver } from "./drivers/LogDriver.js";
import { ArrayDriver } from "./drivers/ArrayDriver.js";
import { Mailable } from "./Mailable.js";
import { MailMessage } from "./MailMessage.js";
import { Container } from "../container/Container.js";

export type MailDriverName = "smtp" | "mailgun" | "log" | "array";

export interface MailTransportConfig {
    driver: MailDriverName;

    // SMTP
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string;
    password?: string;
    timeout?: number;

    // Mailgun
    apiKey?: string;
    domain?: string;
    mailgunHost?: string;

    // Log
    logPath?: string;

    // Shared
    fromAddress?: string;
    fromName?: string;
}

export interface MailConfig {
    default: string;
    mailers: {
        [name: string]: MailTransportConfig;
    };
    from?: {
        address: string;
        name?: string;
    };
}

/**
 * PendingMail — returned by Mail.to() / Mail.cc() / Mail.bcc()
 * Chains recipients onto a mailable before sending.
 *
 *   await Mail.to("user@example.com").send(new WelcomeMail(user));
 *   await Mail.to(["a@x.com", "b@x.com"]).mailer("smtp").send(new NewsletterMail());
 */
export class PendingMail {
    private toList:  string[] = [];
    private ccList:  string[] = [];
    private bccList: string[] = [];
    private mailerName?: string;

    constructor(private mail: typeof Mail) {}

    to(address: string | string[]): this {
        const list = Array.isArray(address) ? address : [address];
        this.toList.push(...list);
        return this;
    }

    cc(address: string | string[]): this {
        const list = Array.isArray(address) ? address : [address];
        this.ccList.push(...list);
        return this;
    }

    bcc(address: string | string[]): this {
        const list = Array.isArray(address) ? address : [address];
        this.bccList.push(...list);
        return this;
    }

    /** Select a named mailer connection (overrides the default). */
    mailer(name: string): this {
        this.mailerName = name;
        return this;
    }

    /** Send the mailable immediately. */
    async send(mailable: Mailable): Promise<void> {
        const message = await mailable.buildMessage(this.toList);
        message.ccAddresses.push(...this.ccList);
        message.bccAddresses.push(...this.bccList);

        // Apply global from if message has no from set
        if (!message.fromAddress && Mail.globalFrom.address) {
            message.from(Mail.globalFrom.address, Mail.globalFrom.name);
        }

        const driver = Mail.resolveDriver(this.mailerName);
        await driver.send(message);
    }

    /**
     * Queue the mailable for background delivery via the Queue system.
     * Requires Queue to be booted.
     */
    async queue(mailable: Mailable, options?: { queue?: string; delay?: number; connection?: string }): Promise<void> {
        const { SendMailJob } = await import("./SendMailJob.js");
        const message = await mailable.buildMessage(this.toList);
        message.ccAddresses.push(...this.ccList);
        message.bccAddresses.push(...this.bccList);

        if (!message.fromAddress && Mail.globalFrom.address) {
            message.from(Mail.globalFrom.address, Mail.globalFrom.name);
        }

        const { dispatch } = await import("../queue/Queue.js");
        await dispatch(new SendMailJob(message, this.mailerName), options);
    }

    /** Send and swallow errors — useful for non-critical notifications. */
    async sendOrFail(mailable: Mailable): Promise<void> {
        try {
            await this.send(mailable);
        } catch (err: any) {
            console.error(`[StruxJS Mail] Failed to send: ${err.message}`);
        }
    }
}

/**
 * Mail — static facade for sending emails.
 *
 * Bootstrap (in bootstrap.ts or AppServiceProvider):
 *   Mail.boot(app.container);
 *
 * Usage:
 *   await Mail.to("user@example.com").send(new WelcomeMail(user));
 *   await Mail.to(users.map(u => u.email)).queue(new NewsletterMail());
 *   await Mail.to("dev@app.com").mailer("log").send(new AlertMail());
 *
 * Testing:
 *   Mail.fake();
 *   // ... run code that sends mail ...
 *   expect(Mail.sent()).toHaveLength(1);
 */
export class Mail {
    private static drivers: Map<string, MailDriver> = new Map();
    private static container: Container | null = null;
    private static defaultMailer = "log";
    public  static globalFrom: { address: string; name?: string } = { address: "" };
    private static fakeMode = false;

    /* ------------------------------------------------------------------ */
    /*  Bootstrap                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Boot the Mail system. Call once during application startup.
     *
     *   Mail.boot(app.container);
     */
    public static boot(container: Container): void {
        this.container = container;

        try {
            const cfg = container.make<MailConfig>("config.mail");
            if (cfg?.default) this.defaultMailer = cfg.default;
            if (cfg?.from?.address) {
                this.globalFrom = { address: cfg.from.address, name: cfg.from.name };
            }
        } catch {
            // config.mail not yet loaded — defaults apply (log driver)
        }

        // Auto-register internal SendMailJob for deserialization by the Queue worker
        import("../queue/Job.js").then(({ Job }) => {
            import("./SendMailJob.js").then(({ SendMailJob }) => {
                Job.register(SendMailJob);
            }).catch(() => {});
        }).catch(() => {});
    }

    /* ------------------------------------------------------------------ */
    /*  Entry points                                                       */
    /* ------------------------------------------------------------------ */

    /** Begin building a mail with recipient(s). */
    public static to(address: string | string[]): PendingMail {
        return new PendingMail(this).to(address);
    }

    /** Begin building a mail with CC recipient(s). */
    public static cc(address: string | string[]): PendingMail {
        return new PendingMail(this).cc(address);
    }

    /** Begin building a mail with BCC recipient(s). */
    public static bcc(address: string | string[]): PendingMail {
        return new PendingMail(this).bcc(address);
    }

    /**
     * Send a raw MailMessage directly without a Mailable class.
     *
     *   await Mail.raw(msg => msg.to("a@b.com").subject("Hi").html("<b>Hello</b>"));
     */
    public static async raw(
        builder: (message: MailMessage) => MailMessage | Promise<MailMessage>,
        mailerName?: string
    ): Promise<void> {
        const message = await builder(new MailMessage());

        if (!message.fromAddress && this.globalFrom.address) {
            message.from(this.globalFrom.address, this.globalFrom.name);
        }

        const driver = this.resolveDriver(mailerName);
        await driver.send(message);
    }

    /* ------------------------------------------------------------------ */
    /*  Driver resolution                                                  */
    /* ------------------------------------------------------------------ */

    /** @internal */
    public static resolveDriver(mailerName?: string): MailDriver {
        // Fake mode — always use ArrayDriver
        if (this.fakeMode) {
            return new ArrayDriver();
        }

        const name = mailerName || this.defaultMailer;

        if (this.drivers.has(name)) {
            return this.drivers.get(name)!;
        }

        const driver = this.buildDriver(name);
        this.drivers.set(name, driver);
        return driver;
    }

    private static buildDriver(name: string): MailDriver {
        // If no container — fall back to LogDriver
        if (!this.container) {
            return new LogDriver();
        }

        let cfg: MailConfig | undefined;
        try {
            cfg = this.container.make<MailConfig>("config.mail");
        } catch {
            return new LogDriver();
        }

        const mailerCfg = cfg?.mailers?.[name];
        if (!mailerCfg) {
            console.warn(`[StruxJS Mail] Mailer "${name}" not found in config/mail.ts — falling back to LogDriver.`);
            return new LogDriver();
        }

        switch (mailerCfg.driver) {
            case "smtp":
                return new SmtpDriver({
                    host:        mailerCfg.host || "127.0.0.1",
                    port:        mailerCfg.port || 587,
                    secure:      mailerCfg.secure,
                    username:    mailerCfg.username,
                    password:    mailerCfg.password,
                    fromAddress: mailerCfg.fromAddress || cfg?.from?.address,
                    fromName:    mailerCfg.fromName    || cfg?.from?.name,
                    timeout:     mailerCfg.timeout
                });

            case "mailgun":
                return new MailgunDriver({
                    apiKey:      mailerCfg.apiKey || "",
                    domain:      mailerCfg.domain || "",
                    host:        mailerCfg.mailgunHost,
                    fromAddress: mailerCfg.fromAddress || cfg?.from?.address,
                    fromName:    mailerCfg.fromName    || cfg?.from?.name
                });

            case "log":
                return new LogDriver(mailerCfg.logPath);

            case "array":
                return new ArrayDriver();

            default:
                console.warn(`[StruxJS Mail] Unknown driver "${(mailerCfg as any).driver}" — using LogDriver.`);
                return new LogDriver();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Testing helpers                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Switch to fake (in-memory) mode. All mail will be captured, not sent.
     * Call in your test setup.
     */
    public static fake(): void {
        this.fakeMode = true;
        ArrayDriver.reset();
    }

    /** Restore real mail sending after fake(). */
    public static restore(): void {
        this.fakeMode = false;
    }

    /** Return all captured emails (only works after fake()). */
    public static sent(): MailMessage[] {
        return ArrayDriver.all();
    }

    /** Assert that an email was sent to a given address. */
    public static assertSentTo(address: string): void {
        if (!ArrayDriver.sentTo(address)) {
            throw new Error(`[StruxJS Mail] Expected mail to be sent to "${address}" but none was found.`);
        }
    }

    /** Assert no emails were sent. */
    public static assertNothingSent(): void {
        const all = ArrayDriver.all();
        if (all.length > 0) {
            throw new Error(`[StruxJS Mail] Expected no mail to be sent, but ${all.length} were sent.`);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Manual driver registration (advanced)                             */
    /* ------------------------------------------------------------------ */

    /** Register a custom driver instance under a name. */
    public static extend(name: string, driver: MailDriver): void {
        this.drivers.set(name, driver);
    }
}
