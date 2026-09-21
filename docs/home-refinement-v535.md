# v535 — approved mockup details

- The mockup's blue connection mark is a local vector shared by the sidebar/mobile brand and portal favicon. The hub's own favicon is outside this change.
- Administrator picker now lives in the sidebar above a single row of four colored, labelled/tooltip icon buttons. Original handlers and permission checks remain. On phones these controls are available in More.
- Bold sidebar labels and lesson names. Lesson times use Korean AM/PM and two lines. Date-wide agreement state has both text and green/amber color; cancellation/absence status is not mislabelled as a normal lesson.
- KPI deltas compare the selected month's registered totals with the previous full month using the existing authenticated scoped reader. Increase red, decrease blue, zero neutral. This is not a fabricated trend series or same-day comparison. Requests cannot overwrite a different teacher/month.
- Latest release notes ship as versioned source, merged with the historical Supabase archive. A regression gate requires the current APP_VERSION to have a diary. Recent entries reconstructed from real commits identify grouped retrospectives.
