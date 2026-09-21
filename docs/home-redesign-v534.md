# v534 home redesign

Approved visual authority: user-provided September 21 PC/mobile mockups. Operate mode.
Preserve the original pixel-art time-of-day card and its assets. Replace the home shell with a white/blue sidebar on PC, compact stacked sections and bottom navigation on phones. Existing operational dialogs remain intact.

Order: clock → privileged controls (admin/STAFF only) → selected teacher/month/KPIs → priority settlement review → latest registered lessons / LMS events / LMS notices. Admin-wide agreement board remains available below. STAFF retains read-only behavior; no new data-write grant.

- Latest lessons are independent of selected KPI month, using the latest recorded class date under caller RLS. CTA opens that exact day for review, never automatically signs.
- KPI class count and recognized hours open existing hours view. No mock comparison or upcoming-hours values are fabricated.
- Notices read active `dashboardSnapshots/GLOBAL_NOTICE` items from S-LMS through verified Firebase identity and portal-access checks, projecting only content and timestamp.
- Calendar remains the actual S-LMS major-event calendar (labelled 주요 일정); weekly timetable is a separate action. Do not imply attendance imports are future schedules.
- Loading, no-data, failure/retry, signed and read-only settlement states are explicit. Teacher-switch response guards prevent stale cross-teacher cards.
- UI synthetic fixtures contain no production authentication or data. No production agreement was submitted during QA.
