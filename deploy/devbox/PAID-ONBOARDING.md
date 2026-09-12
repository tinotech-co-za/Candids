# Managed Candids payment and delivery

Use the dedicated devbox backend and fixed public app
`https://candids-pilot.tinomuzambi.com`. The backend enforces five active events;
each expires within 30 days and allows 50 guests, 100 photos and 200 MB total.
Agree scope, event expiry and the normal seven-day protected backup rotation and the failure/manual-removal
process in writing. A failed cleanup can delay removal; do not promise an
unconditional deletion deadline. Check `~/.local/share/tinotech-candids/status/health.json` is healthy and
fresh (under ten minutes), and review capacity before accepting another event.
Do not sell a larger or indefinite service from these results.

The app has no public event-creation endpoint. A private operator activates an
accepted, fully paid event. Deposits require separate scope/delivery review and
are rejected by this automatic activation command. This implementation has been
verified with network-free payment fixtures; the first real paid event and its
actual delivery still require normal operator acceptance. Do not create a fake
purchase to make that evidence positive.

## Accepted event record

Keep the buyer's written acceptance and a mode-0600 JSON record outside Git.
Use the exact invoice, normalized buyer email, description, amount and quote
expiry from Tinotech's canonical accepted-quote flow. The signed description
must include `Candids`, the exact event name and its ISO event date. The private
record additionally binds the agreed event expiry and retention terms. An
unrelated SERVICES receipt cannot substitute for this accepted event.

The JSON has these fields (replace every placeholder from the real acceptance):

```json
{
  "service": "candids-managed-event-v1",
  "quote": {
    "invoiceId": "THE-ACCEPTED-INVOICE",
    "email": "THE-ACCEPTED-BUYER-ADDRESS",
    "description": "Candids THE EXACT EVENT NAME YYYY-MM-DD",
    "amountMinor": 0,
    "totalMinor": 0,
    "acceptedAt": "EXACT-QUOTE-ACCEPTANCE-ISO-TIME",
    "expiresAt": "EXACT-QUOTE-EXPIRY-ISO-TIME"
  },
  "event": {
    "name": "THE EXACT EVENT NAME",
    "eventDate": "YYYY-MM-DD",
    "expiresAt": "AGREED-EVENT-EXPIRY-ISO-TIME-WITHIN-30-DAYS",
    "origin": "https://candids-pilot.tinomuzambi.com"
  },
  "terms": {
    "version": "candids-managed-v1",
    "acceptedAt": "EXACT-QUOTE-ACCEPTANCE-ISO-TIME",
    "backupRetentionDays": 7,
    "backupRetentionPolicy": "daily-rotation-with-failure-review"
  }
}
```

The placeholder JSON is deliberately not a valid order. The amounts must be
positive integer ZAR cents and equal the agreed full amount. Neither tool creates
a checkout, charge, refund or email.

## Verify, provision and prepare delivery

Use the existing private SERVICES operator environment and the dedicated Convex
admin environment. Never put either in Next, a browser, Git or a delivery draft.
The receipt helper pins the reviewed canonical Tinotech verifier's SHA256 and
only calls `https://www.tinotech.co.za/api/payments/paystack`. If the canonical
module changes, review it and update the pin before proceeding. It checks live
provider identity, the signed quote, buyer, full amount, invoice and fresh bounded
refund/dispute results. A masked or unavailable credential is not payment proof.

Open the dedicated SSH loopback tunnel described in README.md. From the reviewed
checkout with Node 24 on PATH, use an existing mode-0700 private journal directory:

```sh
python3 scripts/fulfill-paid.py /private/accepted-event.json /private/candids-fulfillments --operator-env /private/candids-operator.env --service-env /private/service-operator.env
```

The tool writes and fsyncs random host/recovery/guest keys before its single
backend mutation. The backend transaction binds the payment reference and provider
transaction to exactly one event and request. Preserve this journal after any
ambiguous response. Retry the same accepted file with the same journal; never
change the invoice, capabilities or transaction to work around a failure. A
changed or recovered event will not silently regenerate old delivery links.

The resulting `.delivery.json` is a **prepared, unsent** draft addressed only to
the verified buyer. Review it and the original accepted scope. Re-run verification
if its `reviewBy` time has passed (15 minutes), then use the authorized Tinotech
shared delivery process. Do not send from this script or invent a new contact.
Keep host and recovery links private; only the guest invitation is shareable.
Record actual delivery separately in the shared contact journal. The local
fulfillment directory contains raw capabilities and the buyer address: back it up
to protected operator storage before sending, never to a public artifact. Backend
backups contain capability hashes, not the original delivery keys; the private
operator journal is also required to recover an unsent delivery.

A minimal backend payment ledger survives photo expiry to prevent duplicate
fulfillment. It contains reference, provider transaction identity, request hashes
and album identity, without a buyer address, raw capability or photo. Album photo
retention and the agreed normal seven-day backup rotation and failure review remain separate.

## Later refunds, disputes and outages

The activation check is a point-in-time check. It does **not** continuously enforce
payment validity. Before delivery, before the event, and when a payment case or
refund request arrives, recheck its existing private fulfillment record:

```sh
python3 scripts/recheck-paid.py /private/candids-fulfillments/REFERENCE.json --operator-env /private/candids-operator.env --service-env /private/service-operator.env
```

A reversal, mismatched receipt or provider outage writes
`review-required-or-provider-unavailable` and exits 2. Inspect the existing
provider case and private `.payment-review.json`; it does not automatically
suspend service, delete photos or change the agreed expiry. Do not describe a
provider outage as a confirmed refund or repeat the purchase.

After the operator reviews a refund/dispute case, suspend new uploads **before**
arranging a refund using the same command with `--suspend-uploads refund-request`,
`refund`, `dispute` or `operator-review`. This explicit action is journaled before
its idempotent backend mutation. It issues no refund. Host settings cannot reopen
suspended uploads; guest admission, new reservations and in-flight finalization
are blocked. Host access/recovery, existing photo export and privacy deletion
remain available until the original expiry. Coordinate the agreed export and
retention with the buyer through the authorized Tinotech process. Resuming a
suspended event requires a reviewed operator change after the case is resolved;
there is deliberately no public or unconditional resume command.


## Backup failure and overdue removal

The normal daily schedule retains six recent recovery points and removes each
archive before seven days. The age cutoff includes the next daily interval and a
scheduling margin. If a backup/copy/cleanup operation fails, retention may take
longer; the health service marks the current backup failure or staleness. Inspect
the dedicated service journals, preserve a verified recent recovery point, and
complete the same strictly scoped archive cleanup as soon as the failure is
resolved. Do not silently keep an old archive as a latest-success exception. If
an old recovery point must be retained beyond the accepted rotation for a specific
incident, agree and record that exception with the affected host and its removal
date. Never delete unrelated archives, running data or an accepted-case journal
as a generic cleanup. No real event is currently provisioned by these scripts.
