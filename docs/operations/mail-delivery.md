# Mail Delivery: Providers and Bounce Tracking

| | |
|---|---|
| **Status** | Current (Phase 9, [docs/20](../20-phase-9-templates-bulk-send-plan.md)) |
| **Version** | 1.0.0 |
| **Last updated** | 1 October 2026 |
| **Audience** | Whoever runs an Envelope deployment |
| **What this doc answers** | How do I send email from my own machine and from production, and how do I find out when an email did not arrive? |

---

## In Plain Terms

Envelope sends email for everything that needs a person to act: the link to sign, reminders, the finished
document. It sends through an ordinary mail account (SMTP), so the same code works with **Gmail on your own
machine** and with **a proper email-sending service in production**. Nothing in the code is tied to one
company. You choose by changing settings.

A sending service can also tell Envelope when an email **bounced** (the address does not exist or the inbox is
full) or was **reported as spam**. When it does, Envelope:

- writes it into the document's audit trail, so there is a record that the person may never have got their link;
- emails the sender, in plain words, naming the person and what to do;
- shows "Email undeliverable: check this address" next to that person on the document.

Without this, a link that never arrives looks exactly like a person who has not got round to signing. This
matters most for bulk send, where hundreds of emails go out at once.

What it does not do: it does not track opens or clicks, it does not stop you mailing an address that bounced,
and it only understands the providers listed below.

---

## Technical Detail

### Choosing where mail goes

Everything is configuration (`.env.example` explains each setting). The transport is always SMTP:

| Setting | Gmail, on your machine | A sending service, in production |
|---|---|---|
| `MAIL_TRANSPORT` | `smtp` (or `file` to write messages to a folder and send nothing) | `smtp` |
| `SMTP_HOST` | `smtp.gmail.com` | the service's SMTP host |
| `SMTP_PORT` | `587` | `587` (STARTTLS) or `465` with `SMTP_SECURE=true` |
| `SMTP_USER` / `SMTP_PASSWORD` | your address and a Google **App Password** | the credentials the service gives for SMTP |
| `SMTP_FROM` | `"Envelope <you@gmail.com>"` | an address on a domain you have verified with the service |

Examples of a production service (check their current documentation, these change):

- **Postmark:** host `smtp.postmarkapp.com`, user and password both the server's SMTP token, a verified
  sender signature or domain, and a transactional message stream.
- **Amazon SES:** host `email-smtp.<region>.amazonaws.com`, the SMTP credentials generated in the SES console
  (not your AWS keys), a verified domain, and production access granted.

Production mail should come from a domain with SPF, DKIM and DMARC set up, or it lands in spam whatever the
provider. That is the provider's setup guide, not something Envelope can do for you.

### How a bounce is matched to an email

When Envelope sends an email that is about someone on a document (the signing link and reminders, the
cancellation notice, their finished copy, a renewed download link), it chooses the `Message-ID` itself, of the
form `<uuid@your-from-domain>`, and remembers it in the `MailDelivery` table with the document and the person.
It also puts the same value in two headers a provider can hand back:

| Header | Who reads it |
|---|---|
| `X-Envelope-Ref` | Any provider that can echo custom headers in its report |
| `X-PM-Metadata-envelope-ref` | Postmark, which returns it as `Metadata` on a bounce |

Emails that are not about a person on a document (welcome, password reset, invitations to the workspace, the
sender's own notices) are not tracked.

### The endpoint

`POST /api/v1/mail-events/:adapter`

- **Off until you choose a secret.** With `MAIL_EVENTS_SECRET` unset the route answers `404`. Set it to 32 or
  more random characters (`openssl rand -base64 48`), different from every other secret in `.env`.
- **Authentication:** send the secret as `Authorization: Bearer <secret>`, or as the **password** of HTTP basic
  auth (any username). The second form is for providers that can only take a URL or a login, for example
  `https://hook:<secret>@envelope.example.com/api/v1/mail-events/postmark`. A wrong or missing secret is `401`
  and nothing is written. The secret is never logged.
- **Adapters:**

  | `:adapter` | Body | Notes |
  |---|---|---|
  | `postmark` | Postmark's bounce and spam-complaint webhook | Reads our reference from `Metadata["envelope-ref"]`. Ignores records that are not a failure to deliver (delivery, open, click, auto-reply, transient) |
  | `generic` | `{ "messageId": "<id@host>", "type": "BOUNCED" \| "COMPLAINED" }`, or a list of up to 100 | For any provider, through a small script or function of your own that translates its report |

- **Answer:** `202 { "events": n, "recorded": m }`. A message id Envelope never sent, and an event it already
  recorded, are both answered `202` with nothing recorded, so the endpoint never reveals which ids exist and a
  provider that retries does no harm.
- **What a recorded event does:** `MailDelivery.status` becomes `BOUNCED` or `COMPLAINED`; an `EMAIL_BOUNCED` or
  `EMAIL_COMPLAINED` event is appended to the document's audit trail (the provider's own explanation, which
  often repeats the address, is kept out of it); and the sender gets a "did not arrive" email unless the
  document is already finished or cancelled.

### Setting up Postmark

1. In the server's **Webhooks** settings add a webhook for the message stream you send from, with the URL above
   (secret as the basic-auth password) and **Bounce** and **Spam complaint** ticked.
2. Send a document to an address that does not exist, or use Postmark's bounce test addresses, and confirm the
   document shows "Email undeliverable".

### What has and has not been checked against a live provider

The code is tested against the webhook shape Postmark documents and against the `generic` format, end to end,
with no network. **It has not been run against a live Postmark or SES account in this repository.** The two
things to confirm on first use with any provider are that mail is accepted with the custom headers above, and
that the provider's bounce report carries them back. If it does not, use the `generic` adapter with a
translation that maps the provider's own message id to the `Message-ID` header, which every provider includes
in its delivery logs.

**Amazon SES** reports bounces through SNS notifications and needs an adapter of its own, which is not built
yet. Until then, SES sends mail fine but bounces are not tracked.

### Checking it works

```
curl -i -X POST "$ENVELOPE_URL/api/v1/mail-events/generic" \
  -H "Authorization: Bearer $MAIL_EVENTS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"messageId":"no-such-message@example.com","type":"BOUNCED"}'
```

`202` with `"recorded": 0` means the endpoint and the secret work; nothing was changed because that message
id does not exist. `404` means `MAIL_EVENTS_SECRET` is not set on the API; `401` means the secret is wrong.

### Decisions and limits

- [ADR 0029](../adr/0029-receive-delivery-events-through-one-neutral-authenticated-endpoint.md) records why
  the transport stays SMTP and why there is one neutral endpoint with adapters.
- Only bounces and complaints are recorded. There is no suppression list: a bounced address can be mailed again.
- A bounced or complained address is not blocked, and Envelope does not retry a bounced mail.
