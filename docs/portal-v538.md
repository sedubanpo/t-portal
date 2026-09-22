# v538 — teacher identity repair (2026-09-22)

## Cause

Active Firebase accounts and the account-management projection to the other
application database did not imply a matching teacher/portal_identity in the
teacher-hours database. Claim repair only repaired the authenticated claim.
Phone self-provisioning could link an existing teacher, not create a missing one.

## Changes

- The authenticated bootstrap checks INSTRUCTOR identities against server-side
  Firebase account/app/status metadata and Auth state.
- Missing teacher masters require an exact account-login/Auth-email phone match.
  Existing teachers require exact phone matches. Conflicting names, inactive
  records, existing owners and mismatched identities fail closed.
- New identities have only teacher scope, without all-teacher/all-student access.
- Deterministic teacher IDs and insert-ignore semantics support safe retries.
- A failed phone self-provision during a consent save can invoke the same guarded
  server repair, then retry the original idempotent write. It does not invent consent.
- STAFF/ADMIN are not provisioned as teachers. Existing permissions are preserved.
- Backend secret stays in the function; no browser service key is introduced.

## Authorized operational repair

오기현, 김현진, 이유빈: missing teacher and identity connections created.
Second execution must report provisioned=false for each account.
Before/after hashes of September attendance, class logs and signatures for these
three plus 김다인 and 김인찬 are equal. No agreements were submitted or backfilled.

## Verification

- scripts/test-identity-repair.cjs: missing master, idempotence, concurrency,
  inactive/app-denied/UID mismatch, name/phone/owner collisions and non-teacher isolation.
- scripts/test-supabase-teacher-hours-backend.mjs: existing recovery plus new
  authenticated-but-missing-master recovery and conflict rejection.
- scripts/test-bootstrap-scope.cjs, scripts/test-class-checkout.mjs.
- Real teacher signature submission intentionally not performed; teachers must
  review their own lessons and consent themselves.
