# 0026. Scan Uploads with ClamAV and Accept Them When the Scanner Is Down

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

The upload pipeline (docs/10, "Upload Hardening") has a malware-scan step, and a `MalwareScanner`
seam with a pass-through implementation that accepts everything and says so in the log. A signing
product stores files that other people will open, so before launch that step must be real. Two
choices are not obvious:

- **What scans.** A managed service adds a paid third party and cannot exist in the test
  environment. ClamAV (`clamd`) is free, runs in a container beside Postgres and Redis, and speaks a
  small documented TCP protocol.
- **What happens when the scanner cannot answer.** Refusing uploads keeps unscanned files out but
  turns a scanner outage into a product outage; accepting them keeps senders working but lets
  unscanned files in for the length of the outage.

## Decision

We will scan with `clamd` and fail open with an alert, and:

1. **`ClamdMalwareScanner`** implements `MalwareScanner`. It speaks the `INSTREAM` protocol over
   `node:net` (a length-prefixed chunk stream, about sixty lines), so it needs no dependency. It
   is selected with `MALWARE_SCANNER=clamav`; the default `none` keeps today's pass-through, and
   `CLAMAV_HOST`, `CLAMAV_PORT` and `CLAMAV_TIMEOUT_MS` configure it.
2. **A detection rejects the upload** with the existing `MALWARE_DETECTED`, and logs the signature
   name (never the file).
3. **Unavailable means accepted, loudly.** A connect error, a timeout or a scanner `ERROR` reply
   accepts the file, logs a warning on that upload, and raises the `malware-scanner-unavailable`
   alert (`AlertService`, gated to one email per interval), so an outage is noticed within minutes.
4. **Production may not run with `none` unnoticed.** With `NODE_ENV=production` and
   `MALWARE_SCANNER=none` the API refuses to start unless `MALWARE_SCANNER_ALLOW_NONE=true` is set,
   so leaving scanning off is a decision, not a default.
5. **Tests do not need signatures.** ClamAV's signature database needs internet to download, which
   tests do not have. Tests run the real client against a real local TCP server that speaks the
   `clamd` reply format, the same way webhook tests use a real local HTTP receiver. The docker
   compose service exists for development and manual checks.

We rejected:

- **Failing closed.** Safer per file, but the scanner becomes a hard dependency of every upload.
  Chosen for now; revisit if unscanned acceptances are ever seen in the alerts.
- **A managed scanning API.** Cost, a data-processing agreement for patient documents, and nothing
  to run in tests.
- **A ClamAV npm client.** The protocol is small and the dependency would sit on the upload path.

## Consequences

**Easier:**

- Real scanning behind an existing seam; nothing else in the pipeline changes.
- An outage is visible (a log line per accepted upload and an alert), not silent.

**Harder:**

- One more container to run, keep updated (`freshclam`) and monitor.
- Four new env vars, plumbed through the schema, `.env.example`, the API test env and the browser
  stack.

**Accepted:**

- During a scanner outage, uploads are accepted unscanned. There is no record on the document of
  which files those were and no later rescan; both are candidates if the alert is ever seen.
- Scanning covers uploads through the API and the embedded editor (one validator); it does not
  rescan files already stored.
- Signature quality is ClamAV's: it will miss what it does not know.
