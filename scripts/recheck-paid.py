#!/usr/bin/env python3
"""Recheck a provisioned payment or explicitly suspend uploads after case review."""
import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location("fulfillment", Path(__file__).with_name("fulfill-paid.py"))
fulfillment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fulfillment)


def recheck(record_path, verify, backend, suspend_reason=None):
    record_path = fulfillment.private_path(record_path)
    journal = fulfillment.private_path(record_path.parent, directory=True)
    lock = os.open(journal / ".fulfillment.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record = json.loads(record_path.read_text())
        reference, transaction = record["reference"], record["transactionId"]
        value = record["acceptedEvent"]
        if record.get("state") != "provisioned" or record.get("schemaVersion") != 1 or not re.fullmatch(r"tino-service-[a-f0-9]{32}", reference) or not re.fullmatch(r"[1-9][0-9]{0,19}", transaction) or record_path.name != reference + ".json" or fulfillment.digest(fulfillment.canonical(value)) != record["inputDigest"]:
            raise ValueError("Private fulfillment identity differs")
        expected = "tino-service-" + fulfillment.digest("live:" + value["quote"]["invoiceId"] + ":" + value["quote"]["email"])[:32]
        if expected != reference:
            raise ValueError("Accepted event identity differs")
        identity = {"reference": reference, "transactionId": transaction}
        result = {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "reference": reference,
                  "automaticPaymentEnforcement": False, "action": "none"}
        # Outage, refund/dispute and a mismatched receipt all require review.
        # Preserve access, retention and data; never treat failure as deletion.
        try:
            receipt = verify(reference)
            fulfillment.match_receipt(value, reference, receipt)
            if receipt["transactionId"] != transaction:
                raise ValueError("Payment identity changed")
            result["payment"] = "verified-clear"
        except Exception:
            result["payment"] = "review-required-or-provider-unavailable"
        state = backend("eventStatus", identity)
        if state.get("albumId") != record["albumId"]:
            raise ValueError("Backend event identity differs")
        result["event"] = state
        if suspend_reason is not None:
            if suspend_reason not in ("refund-request", "refund", "dispute", "operator-review"):
                raise ValueError("Explicit reviewed case reason is required")
            # Journal intent before the mutation; retry is idempotent if its
            # response is lost. This action does not issue a provider refund.
            result.update(action="suspend-requested", reason=suspend_reason)
            fulfillment.atomic_json(journal / (reference + ".payment-review.json"), result)
            suspended = backend("suspendUploads", identity)
            if suspended.get("albumId") != record["albumId"] or suspended.get("uploadsSuspended") is not True:
                raise ValueError("Suspension unconfirmed; inspect the existing case")
            result.update(action="uploads-suspended", event=suspended)
        fulfillment.atomic_json(journal / (reference + ".payment-review.json"), result)
        return result
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record")
    parser.add_argument("--operator-env", required=True)
    parser.add_argument("--service-env", required=True)
    parser.add_argument("--suspend-uploads", choices=("refund-request", "refund", "dispute", "operator-review"))
    args = parser.parse_args()
    verify, backend = fulfillment.clients(args.operator_env, args.service_env)
    result = recheck(args.record, verify, backend, args.suspend_uploads)
    print("Payment " + result["payment"] + "; action " + result["action"] + ". Private case status saved; no message or refund sent.")
    return 0 if result["payment"] == "verified-clear" else 2


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(main())
    except Exception:
        print("Payment review unconfirmed. Preserve the private journal and inspect the existing case before retrying.", file=sys.stderr)
        sys.exit(1)
