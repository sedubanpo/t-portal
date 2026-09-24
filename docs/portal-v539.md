# v539 staff read connection repair — 2026-09-24

The staff read claim was issued without checking the DB identity required by
portal_staff_read_access. Missing identities returned empty SELECT results.

Approved repairs: 이민현, 이성진, 권민정, 박승빈, 전소희.
Each is ACTIVE STAFF with teacherPortal enabled and an enabled Auth account.
Only missing portal_identities rows were inserted. Teacher ID is NULL, teacher
name is empty, global access flags are false. Schema role is teacher because
there is no staff enum; no teacher is assigned, so teacher writes have no scope.
Operational reads still require the expiring staff read claim. Existing identities
(including previously privileged ones) were not changed. No operational data,
signatures, account status, passwords or teacher masters were changed.

Server now validates/repairs the identity before issuing staffReadSession claims.
Inactive identities fail closed. Browser validates the active identity on existing
staff sessions and does not fall back to an empty-success statistics rendering on
failed reads. Version bump invalidates old statistics caches.

Tests: identity repair (6), Supabase backend, bootstrap scope, student stats loading,
class checkout. The production repair was rerun with provisioned=false for all five.
Actual staff browser login/rendering has not been exercised in this task.
