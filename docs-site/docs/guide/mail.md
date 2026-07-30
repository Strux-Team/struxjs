# Mail

StruxJS provides a clean `Mail` facade and `Mailable` class system for sending emails. It supports SMTP, Mailgun, a log driver for development, and an in-memory driver for testing.

---

## Configuration

### Environment variables

```ini
MAIL_MAILER=log
MAIL_HOST=127.0.0.1
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=hello@example.com
MAIL_FROM_NAME=StruxJS

# Mailgun (only required when using the mailgun driver)
MAILGUN_SECRET=
MAILGUN_DOMAIN=
MAILGUN_ENDPOINT=api.mailgun.net
```

### `config/mail.ts`

```typescript
import { env } from "struxjs";

export default {
    default: env("MAIL_MAILER", "log"),

    from: {
        address: env("MAIL_FROM_ADDRESS", "hello@example.com"),
        name: env("MAIL_FROM_NAME", "StruxJS App"),
    },

    mailers: {
        smtp: {
            driver: "smtp",
            host: env("MAIL_HOST", "127.0.0.1"),
            port: Number(env("MAIL_PORT", 587)),
            secure: env("MAIL_ENCRYPTION", "tls") === "ssl",
            username: env("MAIL_USERNAME", ""),
            password: env("MAIL_PASSWORD", ""),
            fromAddress: env("MAIL_FROM_ADDRESS", "hello@example.com"),
            fromName: env("MAIL_FROM_NAME", "StruxJS App"),
        },
        mailgun: {
            driver: "mailgun",
            apiKey: env("MAILGUN_SECRET", ""),
            domain: env("MAILGUN_DOMAIN", ""),
            mailgunHost: env("MAILGUN_ENDPOINT", "api.mailgun.net"),
            fromAddress: env("MAIL_FROM_ADDRESS", "hello@example.com"),
            fromName: env("MAIL_FROM_NAME", "StruxJS App"),
        },
        log: {
            driver: "log",
        },
        array: {
            driver: "array",
        },
    },
};
```

---

## Available Drivers

### `smtp`

Sends emails through any SMTP server using `nodemailer`. Works with Gmail, Mailpit, Mailtrap, SendGrid, Amazon SES, and any other SMTP-compatible service.

```ini
MAIL_MAILER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=you@gmail.com
MAIL_PASSWORD=yourpassword
```

### `mailgun`

Sends emails via the [Mailgun](https://mailgun.com) HTTP API. No SMTP credentials required. Supports both the US (`api.mailgun.net`) and EU (`api.eu.mailgun.net`) endpoints.

```ini
MAIL_MAILER=mailgun
MAILGUN_SECRET=key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_ENDPOINT=api.mailgun.net
```

### `log`

Writes the full email - headers, HTML, text - to `storage/logs/mail.log`. No emails are actually sent. The default driver for local development.

```ini
MAIL_MAILER=log
```

### `array`

Stores emails in memory. Used for testing with `Mail.fake()`. See [Testing](#testing).

---

## Creating a Mailable

```bash
npx strux make:mail WelcomeMail
```

This generates both the Mailable class and a view template:

- `app/Mail/WelcomeMail.ts`
- `resources/views/emails/welcome.strux`

Generated Mailable (`app/Mail/WelcomeMail.ts`):

```typescript
import { Mailable, MailMessage } from "struxjs";

export class WelcomeMail extends Mailable {
    constructor(
        public readonly user: User
    ) {
        super();
    }

    public build(message: MailMessage): MailMessage {
        return message
            .subject("Welcome to our platform!")
            .view("emails.welcome", { user: this.user });
    }
}
```

### `build(message)`

The only required method. Return the configured `MailMessage`. All recipient, subject, content, and attachment configuration happens here using the fluent `MailMessage` builder.

### Per-mailable from address

Override the sender for a specific mailable:

```typescript
export class AlertMail extends Mailable {
    public fromAddress = "alerts@yourdomain.com";
    public fromName    = "System Alerts";

    public build(message: MailMessage): MailMessage {
        return message.subject("System alert").view("emails.alert");
    }
}
```

### CLI options

```bash
# Generate with a custom view path
npx strux make:mail InvoiceMail --view emails.invoices.invoice

# Generate a plain-text email (no view template)
npx strux make:mail NotificationMail --markdown
```

---

## MailMessage Builder

The `MailMessage` instance passed to `build()` provides a fluent API for composing the email.

### Recipients

```typescript
message.to("user@example.com")
message.to(["a@example.com", "b@example.com"])
message.cc("manager@example.com")
message.bcc("audit@example.com")
message.replyTo("support@example.com")
```

### Sender

```typescript
message.from("noreply@example.com", "My App")
```

### Subject

```typescript
message.subject("Your order has shipped")
```

### Content

#### View template (recommended)

Renders a `.strux` template as HTML:

```typescript
message.view("emails.order-shipped", { order, user })
```

Templates live in `resources/views/`. Dot-notation maps to folder paths: `emails.order-shipped` → `resources/views/emails/order-shipped.strux`.

#### Raw HTML

```typescript
message.html("<h1>Hello!</h1><p>Your order is on its way.</p>")
```

#### Plain text

```typescript
message.text("Hello! Your order is on its way.")
```

Both `html()` and `text()` can be combined for clients that prefer plain text.

### Attachments

#### Attach a file by path

```typescript
message.attach("/var/invoices/invoice-42.pdf", "invoice.pdf", "application/pdf")
```

#### Attach raw data (Buffer or string)

```typescript
const csv = "name,email\nAlice,alice@example.com";
message.attachData(Buffer.from(csv), "users.csv", "text/csv")
```

### Extra options

```typescript
message.header("X-Custom-Header", "value")
message.tag("welcome")         // Mailgun tag for analytics
message.highPriority()         // priority = 1
message.lowPriority()          // priority = 5
```

---

## Sending Mail

### `Mail.to().send(mailable)`

Send immediately in the current request:

```typescript
import { Mail } from "struxjs";
import { WelcomeMail } from "../Mail/WelcomeMail.js";

await Mail.to("alice@example.com").send(new WelcomeMail(user));
```

### Multiple recipients

```typescript
await Mail.to(["alice@example.com", "bob@example.com"]).send(new NewsletterMail());
```

### CC and BCC

```typescript
await Mail.to("alice@example.com")
    .cc("manager@example.com")
    .bcc("audit@example.com")
    .send(new OrderConfirmation(order));
```

### Specific mailer

Override the default mailer for a single send:

```typescript
await Mail.to("alice@example.com")
    .mailer("smtp")
    .send(new WelcomeMail(user));
```

### `sendOrFail()`

Send and silently swallow errors - useful for non-critical notifications:

```typescript
await Mail.to("alice@example.com").sendOrFail(new WelcomeMail(user));
```

### Raw message (no Mailable class)

Send a one-off email without creating a Mailable class:

```typescript
await Mail.raw(message =>
    message
        .to("alice@example.com")
        .subject("Quick notice")
        .html("<p>Something happened.</p>")
);
```

---

## Queued Mail

Send email in the background via the Queue system. The email is serialized and processed by a queue worker, so the HTTP response is not delayed:

```typescript
await Mail.to("alice@example.com").queue(new WelcomeMail(user));
```

### Queue options

```typescript
await Mail.to("alice@example.com").queue(new WelcomeMail(user), {
    queue: "emails",
    delay: 30,            // send after 30 seconds
    connection: "redis",
});
```

### Requirements

Queued mail works out of the box. `Mail` and the internal `SendMailJob` are automatically booted and registered via `AppServiceProvider`.

A running worker is still needed to process the jobs:

```bash
npx strux queue:work --queue emails
```

`SendMailJob` retries up to 3 times with a 60-second timeout per attempt.

::: warning Attachments and queuing
When using `.queue()`, only file-path attachments (`attach("/path/to/file.pdf")`) are serializable. Attachments added with `attachData(buffer, ...)` using a `Buffer` are **not** preserved through the queue. Use file paths for queued mail with attachments.
:::

---

## Email Templates

Email templates use the standard `.strux` template engine located in `resources/views/`. Reference them with dot-notation in `message.view()`:

```
resources/views/emails/welcome.strux         → "emails.welcome"
resources/views/emails/orders/shipped.strux  → "emails.orders.shipped"
```

Example template (`resources/views/emails/welcome.strux`):

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: sans-serif; background: #f4f4f4; }
        .wrapper { max-width: 600px; margin: 40px auto; background: #fff; padding: 40px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <h1>Welcome, {{ user.name }}!</h1>
        <p>Thanks for joining. Your account is ready.</p>
        <a href="{{ appUrl }}/dashboard">Go to Dashboard</a>
    </div>
</body>
</html>
```

Data passed to `message.view("emails.welcome", { user, appUrl })` is available as template variables.

---

## Testing

### `Mail.fake()`

Switch to the in-memory `ArrayDriver`. All mail sent after calling `fake()` is stored in memory and not actually delivered:

```typescript
import { Mail } from "struxjs";

Mail.fake();

await Mail.to("alice@example.com").send(new WelcomeMail(user));

// Assert emails were sent
const sent = Mail.sent();
console.log(sent.length); // 1
console.log(sent[0].toAddresses); // ["alice@example.com"]
console.log(sent[0].subjectLine); // "Welcome to our platform!"
```

### Assertion helpers

```typescript
// Assert an email was sent to a specific address (throws if not)
Mail.assertSentTo("alice@example.com");

// Assert no emails were sent (throws if any were sent)
Mail.assertNothingSent();
```

### Restore real mail

```typescript
Mail.restore(); // switches back to the configured default driver
```

---

## Custom Driver

Register a custom mail driver by implementing the `MailDriver` interface and passing it to `Mail.extend()`:

```typescript
import { MailDriver, MailMessage } from "struxjs";

class PostmarkDriver implements MailDriver {
    async send(message: MailMessage): Promise<void> {
        // Send via Postmark API
    }
}
```

```typescript
// app/Providers/AppServiceProvider.ts
Mail.extend("postmark", new PostmarkDriver());
```

Then reference it in `config/mail.ts`:

```typescript
mailers: {
    postmark: {
        driver: "postmark",
    },
}
```

```ini
MAIL_MAILER=postmark
```
