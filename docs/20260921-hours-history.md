# v533: STAFF session isolation and published hours history

- Approved scope: active portal-enabled STAFF may read all teachers; teachers may read their own assignments/history. No portal hours writes added.
- Hub authentication now uses a separate SESSION Firebase app; remembered direct-login restoration is skipped for hub_nonce entries. Stale profile/token UID mismatches are rejected before STAFF claim renewal.
- History RPC compares published intranet snapshots by legacy_key, omits unchanged resends, includes deleted snapshots, and masks the other teacher's side of reassignment.
- The authenticated Firebase endpoint enriches only actors appearing in an already-authorized history response. It never returns an account directory or actor identifiers.
- History is paged by 100 entries and filtered by the selected teacher/class month. Desktop/mobile use the same before/after comparison and read-only controls.
- Important limitation: imported_at/imported_by identify portal transmission, not necessarily the original intranet edit. Earlier unsaved edits cannot be reconstructed; the UI labels portal reflection time and actor explicitly.

## Verification

- 34/34 offline suites; bootstrap scope/STAFF eligibility tests.
- History escaping, field differences, KST formatting, and authentication mismatch/renewal tests.
- Supabase rollback assertions: STAFF reads, writes denied; missing/expired claims denied; teacher own history allowed, other teacher denied; no private note fields exposed.
- Deployed API: STAFF 김이천 September hours HTTP 200; history HTTP 200, 41 records with actor names resolved and actor identifiers removed.
- Synthetic desktop/mobile visual review and deletion filter checked using Impeccable's existing design contract. Synthetic fixtures are not production records.
- Existing-page design detector warnings were not treated as authorization for a whole-portal redesign.
