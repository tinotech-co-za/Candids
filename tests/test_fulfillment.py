import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fulfillment", Path(__file__).parents[1] / "scripts/fulfill-paid.py")
fulfillment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fulfillment)

spec = importlib.util.spec_from_file_location("postcare", Path(__file__).parents[1] / "scripts/recheck-paid.py")
postcare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(postcare)


class FulfillmentTests(unittest.TestCase):
    """Pure local fixtures: no provider transaction, purchase or email is created."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = Path(self.temp.name)
        self.now = dt.datetime(2026, 9, 12, 12, tzinfo=dt.timezone.utc).timestamp()
        self.value = {"service": "candids-managed-event-v1",
            "quote": {"invoiceId": "UNIT-ONLY-001", "email": "fixture@example.invalid",
                "description": "Candids Synthetic unit event 2026-09-12", "amountMinor": 75000, "totalMinor": 75000,
                "acceptedAt": "2026-09-12T11:00:00Z", "expiresAt": "2026-09-13T12:00:00Z"},
            "event": {"name": "Synthetic unit event", "eventDate": "2026-09-12", "expiresAt": "2026-09-14T12:00:00Z", "origin": fulfillment.ORIGIN},
            "terms": {"version": "candids-managed-v1", "acceptedAt": "2026-09-12T11:00:00Z", "backupRetentionDays": 7, "backupRetentionPolicy": "daily-rotation-with-failure-review"}}
        normalized, reference = fulfillment.accepted_event(self.value, self.now)
        self.receipt = {"schemaVersion": 1, "reference": reference, "transactionId": "123456789",
            "invoiceId": "UNIT-ONLY-001", "emailHash": fulfillment.digest("fixture@example.invalid"),
            "amountMinor": 75000, "totalMinor": 75000, "currency": "ZAR", "mode": "live",
            "description": self.value["quote"]["description"], "quoteExpired": False, "reversalsClear": True,
            "issuedAt": "2026-09-12T11:01:00Z", "expiresAt": self.value["quote"]["expiresAt"], "paidAt": "2026-09-12T11:02:00Z"}
        self.requests = []

    def provision(self, payload):
        self.requests.append(payload)
        return {"albumId": "a" * 32, "reused": len(self.requests) > 1}

    def run_fulfill(self, provision=None):
        return fulfillment.fulfill(self.value, self.journal, lambda _: self.receipt, provision or self.provision, self.now)

    def test_verified_event_prepares_private_record_and_exact_recipient_without_sending(self):
        path = self.run_fulfill()
        record = json.loads(path.read_text())
        draft = json.loads(path.with_name(path.stem + ".delivery.json").read_text())
        self.assertEqual(record["state"], "provisioned")
        self.assertEqual(draft["state"], "prepared-not-sent")
        self.assertEqual(draft["to"], "fixture@example.invalid")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(set(record["keys"].values())), 3)
        self.assertGreater(fulfillment.instant(draft["reviewBy"]), self.now)

    def test_ambiguous_commit_reuses_previously_fsynced_keys_and_request(self):
        def ambiguous(payload):
            self.requests.append(payload)
            self.assertEqual(len(list(self.journal.glob("tino-service-*.json"))), 1)
            raise TimeoutError("fixture response lost after commit")
        with self.assertRaises(TimeoutError):
            self.run_fulfill(ambiguous)
        path = next(self.journal.glob("tino-service-*.json"))
        keys = json.loads(path.read_text())["keys"]
        self.run_fulfill()
        self.assertEqual(self.requests[0], self.requests[1])
        self.assertEqual(json.loads(path.read_text())["keys"], keys)

    def test_wrong_receipts_and_reversals_never_reach_provisioning(self):
        for field, bad in [("invoiceId", "OTHER"), ("emailHash", "0" * 64), ("mode", "test"),
                           ("amountMinor", 1), ("currency", "USD"), ("reversalsClear", False),
                           ("quoteExpired", True), ("transactionId", "1e9"), ("description", "Other scope")]:
            with self.subTest(field=field):
                original = self.receipt[field]
                self.receipt[field] = bad
                with self.assertRaises(ValueError): self.run_fulfill()
                self.receipt[field] = original
        self.assertEqual(self.requests, [])

    def test_changed_event_terms_cannot_reuse_an_existing_payment_record(self):
        self.run_fulfill()
        self.value["event"]["expiresAt"] = "2026-09-15T12:00:00Z"
        with self.assertRaises(ValueError): self.run_fulfill()
        self.assertEqual(len(self.requests), 1)

    def test_deposits_other_services_or_unsigned_event_names_are_rejected(self):
        for change in (lambda x: x["quote"].update(totalMinor=150000),
                       lambda x: x.update(service="other-service"),
                       lambda x: x["event"].update(name="Different event"),
                       lambda x: x["terms"].update(backupRetentionDays=30)):
            original = copy.deepcopy(self.value)
            change(self.value)
            with self.assertRaises(ValueError): self.run_fulfill()
            self.value = original
        self.assertEqual(self.requests, [])

    def test_failed_fresh_verification_preserves_an_existing_record(self):
        path = self.run_fulfill()
        before = path.read_bytes()
        self.receipt["reversalsClear"] = False
        with self.assertRaises(ValueError): self.run_fulfill()
        self.assertEqual(path.read_bytes(), before)

    def test_later_reversal_flags_review_without_mutation_or_changed_retention(self):
        path = self.run_fulfill()
        before = path.read_bytes()
        calls = []
        def backend(operation, payload):
            calls.append(operation)
            return {"albumId": "a" * 32, "expired": False, "uploadsOpen": True, "uploadsSuspended": False}
        self.receipt["reversalsClear"] = False
        result = postcare.recheck(path, lambda _: self.receipt, backend)
        self.assertEqual(result["payment"], "review-required-or-provider-unavailable")
        self.assertEqual(calls, ["eventStatus"])
        self.assertEqual(path.read_bytes(), before)

    def test_operator_case_suspends_explicitly_and_journals_intent_before_request(self):
        path = self.run_fulfill()
        calls = []
        def backend(operation, payload):
            calls.append(operation)
            if operation == "suspendUploads":
                review = json.loads(path.with_name(path.stem + ".payment-review.json").read_text())
                self.assertEqual(review["action"], "suspend-requested")
            return {"albumId": "a" * 32, "expired": False, "uploadsSuspended": operation == "suspendUploads"}
        result = postcare.recheck(path, lambda _: self.receipt, backend, "refund-request")
        self.assertEqual(calls, ["eventStatus", "suspendUploads"])
        self.assertEqual(result["action"], "uploads-suspended")

    def test_verifier_connection_flags_preserve_private_process_and_deadline(self):
        operator, service = self.journal / "operator.env", self.journal / "service.env"
        operator.write_text("CONVEX_SELF_HOSTED_URL=http://127.0.0.1:43210\nCONVEX_SELF_HOSTED_ADMIN_KEY=unit-only\n")
        service.write_text("TINOTECH_PAYMENTS_TOKEN=unit-only\n")
        operator.chmod(0o600)
        service.chmod(0o600)
        reference = self.receipt["reference"]
        with patch.dict(fulfillment.os.environ, {"NODE_OPTIONS": "--insecure-http-parser", "PRIVATE_UNRELATED": "unit-only"}), \
                patch.object(fulfillment.subprocess, "run") as run:
            run.return_value.stdout = json.dumps(self.receipt)
            verify, _ = fulfillment.clients(operator, service)
            self.assertEqual(verify(reference), self.receipt)
        run.assert_called_once()
        args, kwargs = run.call_args
        self.assertEqual(args[0], ["node", "--dns-result-order=ipv4first", "--no-network-family-autoselection",
                                 str(fulfillment.CHECKOUT / "scripts/verify-service-receipt.mjs"), reference, str(service)])
        self.assertEqual(kwargs["timeout"], 65)
        self.assertTrue(kwargs["capture_output"])
        self.assertTrue(kwargs["check"])
        self.assertEqual(kwargs["cwd"], fulfillment.CHECKOUT)
        self.assertLessEqual(set(kwargs["env"]), {"PATH", "HOME", "LANG"})


if __name__ == "__main__":
    unittest.main()
