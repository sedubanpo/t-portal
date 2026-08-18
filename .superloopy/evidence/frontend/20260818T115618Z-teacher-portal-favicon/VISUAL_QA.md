# Teacher Portal favicon visual QA

## Surface and intent

- Target: SEDU Teacher Portal browser tab on desktop and mobile browsers.
- Visual change: replace the missing/unstable externally generated favicon with a dedicated local SVG.
- Scope reason: the user requested a favicon comparable in clarity to Synchro-S without changing the portal UI.

## Design review

- The rounded blue tile matches the portal's existing primary blue and remains distinct from Synchro-S's calendar glyph.
- The white clipboard represents class records and teacher workflow; the green check represents attendance/hours confirmation.
- At 16 px the blue tile, white document, and green confirmation mark remain separately legible.
- At 32 px the three record lines and checkmark remain clear without relying on text.
- No change was made to login layout, typography, controls, or authenticated surfaces.

## Rendered evidence

- `favicon.svg.png`: 256 px Quick Look render of the source SVG.
- `favicon-32.png`: browser-toolbar scale render.
- `favicon-16.png`: browser-tab scale render.
- `local-login.png`: real local browser render confirming the login page remains visually intact at v511.
- `production-login.png`: real GitHub Pages browser render after deployment.

## Browser verification

- Page title: `SEDU Teacher Portal`
- Version badge: `v511`
- `rel=icon`: `http://127.0.0.1:4173/favicon.svg?v=511`
- `rel=shortcut icon`: `http://127.0.0.1:4173/favicon.svg?v=511`
- MIME type: `image/svg+xml`
- Theme color: `#0b5cc5`
- Local HTTP response: `200 OK`, `Content-type: image/svg+xml`
- Served/source SHA-256 both: `8eadeebcaea0b09efe0d5ef90c6953b60134c0959768b3c0f6322b8775176ae8`
- Production page: `https://sedubanpo.github.io/t-portal/?qa=v511-favicon`
- Production icon: `https://sedubanpo.github.io/t-portal/favicon.svg?v=511`
- Production response: `HTTP/2 200`, `content-type: image/svg+xml`
- Production browser metadata: title `SEDU Teacher Portal`, version `v511`, theme color `#0b5cc5`

## Result

PASS — the favicon is local, cache-versioned, visually legible at browser sizes, and no longer rewritten by runtime logo processing.
