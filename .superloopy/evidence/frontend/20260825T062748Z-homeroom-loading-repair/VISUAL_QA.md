# Homeroom loading repair — visual QA

Date: 2026-08-25 (Asia/Seoul)
Surface: browser-hosted portal used on desktop and mobile/in-app browsers

## Design impact

- No layout, typography, color, or responsive structure was changed.
- The existing homeroom modal remains the destination and the existing full-screen loading treatment remains the transition state.
- The refresh icon keeps its existing appearance and gains an explanatory title; its action now actually re-fetches data.

## Visible-state behavior

- Before: the loading overlay could remain visible at its 85% animation cap forever.
- After: successful requests open the existing modal; partial/slow requests release the overlay by 20 seconds, open the modal with available information, and show a recoverable warning.
- A late response updates the open modal without forcing the user to close and reopen it.

## Reference and limitations

- Failure reference: user-provided mobile screenshot `codex-clipboard-20cae009-6969-40cd-adda-f81ba3a79322.png`.
- Authenticated mobile production impersonation was not used. The affected account's live authenticated bootstrap payload was verified server-side, and the transition controller was verified with deterministic runtime tests covering success, empty assignment, concurrency, and timeout.
- Because the repair does not alter the rendered modal design, no new visual styling approval is required.
