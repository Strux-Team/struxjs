import { describe, test, expect, beforeEach } from "vitest";
import { Mail, Mailable, MailMessage, ArrayDriver } from "../src/index.js";

class WelcomeMail extends Mailable {
    constructor(private userName: string) {
        super();
    }

    public build(message: MailMessage): MailMessage {
        return message
            .subject("Welcome to StruxJS")
            .html(`<h1>Hello, ${this.userName}!</h1>`);
    }
}

describe("Mail System", () => {
    beforeEach(() => {
        Mail.fake();
        ArrayDriver.reset();
    });

    test("builds MailMessage with recipients, subject, and html body", async () => {
        const mailable = new WelcomeMail("Alice");
        const msg = await mailable.buildMessage(["alice@example.com"]);

        expect(msg.toAddresses).toEqual(["alice@example.com"]);
        expect(msg.subjectLine).toBe("Welcome to StruxJS");
        expect(msg.htmlBody).toBe("<h1>Hello, Alice!</h1>");
    });

    test("Mail.fake captures sent emails in ArrayDriver", async () => {
        await Mail.to("bob@example.com").send(new WelcomeMail("Bob"));

        const sent = ArrayDriver.all();
        expect(sent).toHaveLength(1);
        expect(sent[0].toAddresses).toContain("bob@example.com");
        expect(sent[0].subjectLine).toBe("Welcome to StruxJS");
        expect(ArrayDriver.sentTo("bob@example.com")).toBe(true);
    });

    test("Mail.fake asserts withSubject and reset", async () => {
        await Mail.to("charlie@example.com").send(new WelcomeMail("Charlie"));

        expect(ArrayDriver.withSubject("Welcome to StruxJS")).toHaveLength(1);

        ArrayDriver.reset();
        expect(ArrayDriver.all()).toHaveLength(0);
    });
});
