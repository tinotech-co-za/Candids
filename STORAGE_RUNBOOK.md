# Managed album storage maintenance

Use these internal functions only on the **new, isolated Candids deployment**
whose identity has been recorded for the pilot. They are disabled by default.
Never enable them in the old photo-trading deployment: inventory deliberately
checks managed `albumPhotos` references only and cannot establish ownership of
legacy or unrelated storage. No public API or scheduled job calls these tools.

## Upload recovery

If the HTTP action loses the response from a committed `finishUpload`, its
compensation now checks `albumPhotos.by_storage` inside the deletion mutation.
An attached file is kept; an unattached file is removed and its pending quota is
released once. If reconciliation itself fails, the action leaves the uncertain
file in storage and logs `Candids upload reconciliation deferred` without IDs or
credentials. Inspect the reservation or retry the original request before
starting another upload. The ordinary reservation/album expiry cron still runs.

A process termination immediately after storing a file can leave no reservation
link to that file. The inventory below covers this gap. It never downloads bytes
or generates public storage URLs. Files younger than one hour are excluded,
well beyond the five-minute reservation lifetime. Finalization also rejects files
created before the current reservation, so a new reservation cannot adopt an
old cleanup candidate.

## Inspect and reconcile

1. Verify the selected provider project is the recorded new isolated deployment.
   Confirm its exact `https://DEPLOYMENT.convex.cloud` URL in the provider
   dashboard. Keep the web pilot disabled during first synthetic acceptance.
2. Set `CANDIDS_STORAGE_MAINTENANCE_ENABLED=true` in **that Convex backend** for
   the maintenance window. The tools also require their `deployment` argument to
   equal the backend's built-in `CONVEX_CLOUD_URL`; a copied report aimed at
   another backend fails closed. This is an additional identity check, not
   permission to enable maintenance in a legacy/shared project.
3. In the selected deployment's function runner, run internal query
   `storageMaintenance:inventory` with
   `{ "deployment": "https://DEPLOYMENT.convex.cloud", "cursor": null }`.
   Save the report in protected operator storage, outside Git. It returns at
   most 100 old file metadata records per page, plus `candidates`, `scanned`,
   `isDone` and `continueCursor`. Continue with the returned cursor until
   `isDone`; an empty candidates page does not mean the scan is complete.
4. Review each candidate against the upload incident and agreed retention
   scope. Run internal mutation `storageMaintenance:deleteReviewed` only with
   that same `deployment` and a `files` array containing the exact reviewed
   `storageId`, `sha256` and `createdAt` fields, excluding the report's `size`
   field. A batch contains 1–20 distinct files. There is no delete-all argument.
5. The mutation rechecks age, fingerprint and current managed-photo references
   transactionally. Any changed/referenced file rejects the batch. An already
   absent file is reported separately, so repeating an uncertain operation is
   safe. Keep the review and `{ deleted, alreadyAbsent }` result in the protected
   maintenance record, then run inventory again.
6. Disable `CANDIDS_STORAGE_MAINTENANCE_ENABLED` when finished. Monitor normal
   expiry cron success and storage usage before accepting another paid event.

No maintenance function has been invoked on a hosted backend in this release.
Before enabling private events, use synthetic files to verify the real provider:
retain a referenced file and a recent unfinished upload, inventory and delete
only an old abandoned file, repeat deletion, and prove a file attached after
review is retained. Tests using `convex-test` cover policy and transaction paths;
they do not replace hosted storage acceptance or provider backup retention review.

Provider references: [system file metadata](https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter),
[mutation transactions](https://docs.convex.dev/functions/mutation-functions),
[storage deletion](https://docs.convex.dev/api/interfaces/server.StorageWriter),
and [provider backup retention](https://docs.convex.dev/database/backup-restore).
