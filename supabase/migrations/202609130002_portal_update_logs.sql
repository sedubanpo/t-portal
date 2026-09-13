begin;
create table if not exists public.portal_update_logs (
  id text primary key,
  title text not null,
  version text not null default '',
  category text not null default '',
  published_at date not null,
  author_name text not null default '',
  author_type text not null default 'ai-developer',
  summary text not null default '',
  body text not null,
  published boolean not null default true
);
alter table public.portal_update_logs enable row level security;
revoke all on public.portal_update_logs from anon,authenticated;
grant select on public.portal_update_logs to authenticated;
create policy portal_update_logs_active_reader on public.portal_update_logs for select to authenticated using (
  published and (select auth.jwt()->>'iss')='https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt()->>'aud')='fir-lms-prod'
  and private.portal_has_active_identity()
);
commit;
