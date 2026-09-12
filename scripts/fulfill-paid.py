#!/usr/bin/env python3
"""Verify an accepted paid Candids event, provision once, and prepare private delivery."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import urllib.request

ORIGIN = "https://candids.tinotech.co.za"
CHECKOUT = Path(__file__).resolve().parents[1]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def instant(value):
    if not isinstance(value, str):
        raise ValueError("Use an explicit ISO date/time")
    result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Date/time must include its timezone")
    return result.timestamp()


def accepted_event(value, now):
    if value.get("service") != "candids-managed-event-v1":
        raise ValueError("An accepted Candids event is required")
    quote, event, terms = value["quote"], value["event"], value["terms"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{2,79}", quote["invoiceId"]):
        raise ValueError("Invalid accepted invoice")
    email = quote["email"].strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Invalid verified host address")
    amount, total = quote["amountMinor"], quote["totalMinor"]
    if type(amount) is not int or type(total) is not int or not 100 <= amount <= 100000000 or amount != total:
        raise ValueError("Automated event activation requires a fully paid quote; review deposits separately")
    name, description = event["name"].strip(), quote["description"].strip()
    if not name or len(name) > 80 or re.search(r"[\x00-\x1f\x7f]", name + description) or len(description) > 300:
        raise ValueError("Invalid accepted event scope")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", event["eventDate"]) or dt.date.fromisoformat(event["eventDate"]).isoformat() != event["eventDate"]:
        raise ValueError("Invalid event date")
    if "candids" not in description.lower() or name not in description or event["eventDate"] not in description:
        raise ValueError("The signed quote must name Candids, this event and its date")
    accepted, expiry = instant(quote["acceptedAt"]), instant(quote["expiresAt"])
    if accepted > now or accepted >= expiry or expiry - accepted > 31 * 86400:
        raise ValueError("Invalid accepted quote timing")
    event_expiry = instant(event["expiresAt"])
    if not now < event_expiry <= now + 30 * 86400 or event["origin"] != ORIGIN:
        raise ValueError("Use the fixed app origin and an event expiry within30 days")
    if terms != {"version": "candids-managed-v1", "acceptedAt": quote["acceptedAt"], "backupRetentionDays": 7, "backupRetentionPolicy": "daily-rotation-with-failure-review"}:
        raise ValueError("Record acceptance of the managed event, normal backup rotation and failure-review terms")
    normalized = {
        "service": value["service"],
        "quote": {key: quote[key] for key in ("invoiceId", "amountMinor", "totalMinor", "acceptedAt", "expiresAt")},
        "event": {"name": name, "eventDate": event["eventDate"], "expiresAt": event["expiresAt"], "origin": ORIGIN},
        "terms": terms,
    }
    normalized["quote"].update(email=email, description=description)
    reference = "tino-service-" + digest("live:" + quote["invoiceId"] + ":" + email)[:32]
    return normalized, reference


def match_receipt(value, reference, receipt):
    quote = value["quote"]
    expected = {"schemaVersion": 1, "reference": reference, "invoiceId": quote["invoiceId"],
                "emailHash": digest(quote["email"]), "amountMinor": quote["amountMinor"],
                "totalMinor": quote["totalMinor"], "currency": "ZAR", "mode": "live",
                "description": quote["description"], "quoteExpired": False, "reversalsClear": True}
    if not isinstance(receipt, dict) or any(type(receipt.get(k)) is not type(v) or receipt[k] != v for k, v in expected.items()):
        raise ValueError("The fresh payment receipt does not match this accepted event")
    if not re.fullmatch(r"[1-9][0-9]{0,19}", receipt.get("transactionId", "")):
        raise ValueError("A canonical provider transaction identity is required")
    if receipt["expiresAt"] != quote["expiresAt"] or instant(receipt["issuedAt"]) < instant(quote["acceptedAt"]) - 60 or not instant(receipt["issuedAt"]) - 60 <= instant(receipt["paidAt"]) <= instant(quote["expiresAt"]):
        raise ValueError("Payment timing differs from the accepted quote")


def private_path(path, directory=False):
    path = Path(path).resolve()
    if path == CHECKOUT or CHECKOUT in path.parents:
        raise ValueError("Private operator records must be outside the checkout")
    if not path.exists() or (not directory and not path.is_file()) or (directory and not path.is_dir()) or path.stat().st_mode & 0o077:
        raise ValueError("Operator paths must be private files/directories")
    return path


def atomic_json(path, value):
    temp = path.with_name(path.name + ".partial")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temp, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def fulfill(value, journal, verify, provision, now=None):
    now = now if now is not None else dt.datetime.now(dt.timezone.utc).timestamp()
    value, reference = accepted_event(value, now)
    journal = private_path(journal, directory=True)
    lock = os.open(journal / ".fulfillment.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt = verify(reference)
        match_receipt(value, reference, receipt)
        record_path = journal / (reference + ".json")
        if record_path.is_symlink():
            raise ValueError("Private journal must not contain symlinks")
        input_digest = digest(canonical(value))
        if record_path.exists():
            record = json.loads(record_path.read_text())
            if record.get("schemaVersion") != 1 or record.get("state") not in ("prepared", "provisioned") or record.get("reference") != reference or record["inputDigest"] != input_digest or digest(canonical(record["acceptedEvent"])) != input_digest or record["transactionId"] != receipt["transactionId"]:
                raise ValueError("Accepted terms differ from the existing fulfillment journal")
        else:
            record = {"schemaVersion": 1, "state": "prepared", "inputDigest": input_digest,
                      "transactionId": receipt["transactionId"], "reference": reference, "acceptedEvent": value,
                      "keys": {kind: secrets.token_urlsafe(32) for kind in ("host", "recovery", "guest")}}
            atomic_json(record_path, record)  # Durable keys precede any backend mutation.
        keys = record["keys"]
        if not all(re.fullmatch(r"[A-Za-z0-9_-]{43}", keys[k]) for k in ("host", "recovery", "guest")) or len(set(keys.values())) != 3:
            raise ValueError("Invalid private capability record")
        album = {"name": value["event"]["name"], "eventDate": value["event"]["eventDate"],
                 "expiresAt": instant(value["event"]["expiresAt"]) * 1000,
                 "hostHash": digest(keys["host"]), "recoveryHash": digest(keys["recovery"]), "inviteHash": digest(keys["guest"])}
        request_digest = digest(canonical({"inputDigest": input_digest, "album": album, "transactionId": receipt["transactionId"]}))
        result = provision({"reference": reference, "transactionId": receipt["transactionId"], "requestDigest": request_digest, "album": album})
        if not isinstance(result, dict) or not re.fullmatch(r"[a-zA-Z0-9]{16,64}", result.get("albumId", "")):
            raise ValueError("Provisioning identity is unconfirmed; preserve the journal before retrying")
        if record.get("albumId") and record["albumId"] != result["albumId"]:
            raise ValueError("Provisioning differs from the durable album identity")
        base = ORIGIN + "/event/" + result["albumId"]
        card = {"albumId": result["albumId"], "name": album["name"], "eventDate": album["eventDate"],
                "expiresAt": value["event"]["expiresAt"], "hostKey": keys["host"], "recoveryKey": keys["recovery"],
                "hostUrl": base + "#host=" + keys["host"], "recoveryUrl": base + "#recovery=" + keys["recovery"],
                "guestUrl": base + "#guest=" + keys["guest"]}
        checked_at = dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()
        review_by = dt.datetime.fromtimestamp(now + 900, dt.timezone.utc).isoformat()
        record.update(state="provisioned", albumId=result["albumId"], receipt=receipt, card=card, verificationCheckedAt=checked_at)
        atomic_json(record_path, record)
        draft = {"state": "prepared-not-sent", "to": value["quote"]["email"],
                 "subject": "Your Candids event album — " + value["quote"]["invoiceId"],
                 "body": "Your paid Candids event album is ready. Keep the host and recovery links private.\n\nHost: " + card["hostUrl"] + "\nRecovery: " + card["recoveryUrl"] + "\n\nShare only this guest invitation: " + card["guestUrl"] + "\n\nExport before " + card["expiresAt"] + ". Live photos expire then. Protected backups normally rotate out within seven days. Failed rotations are flagged for operator recovery and removal, which can take longer, as agreed in your event terms.\n",
                 "reference": reference, "albumId": result["albumId"]}
        draft.update(verificationCheckedAt=checked_at, reviewBy=review_by)
        atomic_json(journal / (reference + ".delivery.json"), draft)
        return record_path
    finally:
        os.close(lock)


def clients(operator_path, service_path):
    operator_path, service_path = private_path(operator_path), private_path(service_path)
    operator = dict(line.split("=", 1) for line in operator_path.read_text().splitlines() if "=" in line)
    if operator.get("CONVEX_SELF_HOSTED_URL") != "http://127.0.0.1:43210" or not operator.get("CONVEX_SELF_HOSTED_ADMIN_KEY") or operator.get("CONVEX_DEPLOYMENT") or operator.get("CONVEX_DEPLOY_KEY"):
        raise ValueError("Use only the dedicated SSH tunnel and private self-hosted admin record")

    def verify(reference):
        environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
        result = subprocess.run(["node", str(CHECKOUT / "scripts/verify-service-receipt.mjs"), reference, str(service_path)],
                                capture_output=True, text=True, timeout=65, check=True, cwd=CHECKOUT, env=environment)
        return json.loads(result.stdout)

    def backend(operation, payload):
        if operation not in ("provisionPaid", "eventStatus", "suspendUploads"):
            raise ValueError("Unsupported operator operation")
        kind = "query" if operation == "eventStatus" else "mutation"
        request = urllib.request.Request("http://127.0.0.1:43210/api/" + kind, method="POST",
            data=json.dumps({"path": "fulfillment:" + operation, "format": "convex_encoded_json", "args": [payload]}).encode(),
            headers={"content-type": "application/json", "authorization": "Convex " + operator["CONVEX_SELF_HOSTED_ADMIN_KEY"]})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            result = json.loads(response.read(100000))
        if result.get("status") != "success":
            raise ValueError("Backend fulfillment unconfirmed; preserve the private journal")
        return result["value"]

    return verify, backend


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accepted_event")
    parser.add_argument("journal")
    parser.add_argument("--operator-env", required=True)
    parser.add_argument("--service-env", required=True)
    args = parser.parse_args()
    event_path = private_path(args.accepted_event)
    verify, backend = clients(args.operator_env, args.service_env)
    fulfill(json.loads(event_path.read_text()), args.journal, verify, lambda payload: backend("provisionPaid", payload))
    print("Verified event provisioned; private recovery record and delivery draft prepared. No message sent.")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except Exception:
        print("Fulfillment unconfirmed. Preserve the private journal and inspect quote, payment and backend status before retrying. No message sent.", file=sys.stderr)
        sys.exit(1)
