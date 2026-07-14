-- Transactional class-log and hours-agreement write path.
-- The browser invokes only this restricted RPC with a Firebase JWT. The
-- function validates identity and teacher scope, applies idempotency, writes
-- class-log rows and signatures atomically, and records an audit event.

create table if not exists public.portal_write_requests (
  id uuid primary key default gen_random_uuid(),
  actor_uid text not null,
  action text not null,
  request_key text not null,
  status text not null default 'pending',
  response_json jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_uid, action, request_key),
  constraint portal_write_requests_status_check check (status in ('pending', 'completed', 'failed'))
);

alter table public.portal_write_requests enable row level security;
revoke all on public.portal_write_requests from anon, authenticated;

create or replace function private.portal_normalize_teacher_name(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(lower(trim(coalesce(input, ''))), '[[:space:]]*t$', '', 'i'),
    '[[:space:]]+', '', 'g'
  )
$$;

revoke all on function private.portal_normalize_teacher_name(text) from public;

create or replace function private.portal_compact_time_label(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  time_text text := regexp_replace(trim(coalesce(input, '')), '[[:space:]]+', '', 'g');
  parts text[];
  prefix_text text;
  hour_value integer;
  minute_text text;
  label_text text := '';
begin
  if time_text = '' then return ''; end if;
  parts := regexp_match(time_text, '^(오전|오후|AM|PM)?([0-9]{1,2}):([0-9]{2})(:[0-9]{2})?(AM|PM)?$', 'i');
  if parts is null then
    return regexp_replace(time_text, '(:[0-9]{2})(:[0-9]{2})$', '\1');
  end if;
  prefix_text := upper(coalesce(parts[1], parts[5], ''));
  hour_value := parts[2]::integer;
  minute_text := parts[3];
  if prefix_text in ('PM', '오후') then label_text := '오후';
  elsif prefix_text in ('AM', '오전') then label_text := '오전';
  end if;
  if label_text = '' then
    if hour_value = 0 then label_text := '오전'; hour_value := 12;
    elsif hour_value < 12 then label_text := '오전';
    elsif hour_value = 12 then label_text := '오후';
    else label_text := '오후'; hour_value := hour_value - 12;
    end if;
  else
    if label_text = '오전' and hour_value = 0 then hour_value := 12; end if;
    if label_text = '오전' and hour_value > 12 then hour_value := hour_value - 12; end if;
    if label_text = '오후' and hour_value > 12 then hour_value := hour_value - 12; end if;
  end if;
  return label_text || ' ' || hour_value::text || ':' || minute_text;
end;
$$;

revoke all on function private.portal_compact_time_label(text) from public;

create or replace function public.portal_save_class_log_rows(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_uid text := nullif((select auth.jwt() ->> 'sub'), '');
  identity_row public.portal_identities%rowtype;
  actor_teacher_name text := '';
  v_request_key text;
  previous_response jsonb;
  item jsonb;
  teacher_name text;
  student_name text;
  class_date_text text;
  class_date_value date;
  log_status text;
  reason_text text;
  start_text text;
  end_text text;
  class_name_text text;
  legacy_key_value text;
  row_count_value integer := 0;
  signature_keys jsonb := '{}'::jsonb;
  signature_key text;
  signature_count integer := 0;
  affected_month_keys text[] := array[]::text[];
  first_date text := '';
  first_teacher text := '';
  response_value jsonb;
begin
  if v_actor_uid is null
     or (select auth.jwt() ->> 'iss') <> 'https://securetoken.google.com/fir-lms-prod'
     or (select auth.jwt() ->> 'aud') <> 'fir-lms-prod'
     or (select auth.jwt() ->> 'role') <> 'authenticated' then
    raise exception 'Firebase 로그인 권한을 확인할 수 없습니다.' using errcode = '42501';
  end if;

  select * into identity_row
  from public.portal_identities
  where firebase_uid = v_actor_uid and active = true;
  if not found then
    raise exception '활성 강사 계정을 확인할 수 없습니다.' using errcode = '42501';
  end if;

  if identity_row.teacher_id is not null then
    select display_name into actor_teacher_name
    from public.teachers where id = identity_row.teacher_id;
  end if;

  if jsonb_typeof(coalesce(payload -> 'rows', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(payload -> 'rows') < 1
     or jsonb_array_length(payload -> 'rows') > 500 then
    raise exception '저장할 수업일지 행은 1~500개여야 합니다.' using errcode = '22023';
  end if;

  v_request_key := encode(extensions.digest(convert_to((payload -> 'rows')::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext(v_actor_uid || '|saveClassLogRows|' || v_request_key));
  select response_json into previous_response
  from public.portal_write_requests
  where portal_write_requests.actor_uid = v_actor_uid
    and action = 'saveClassLogRows'
    and portal_write_requests.request_key = v_request_key
    and status = 'completed';
  if previous_response is not null then
    return previous_response || jsonb_build_object('idempotentReplay', true);
  end if;

  insert into public.portal_write_requests(actor_uid, action, request_key, status)
  values (v_actor_uid, 'saveClassLogRows', v_request_key, 'pending')
  on conflict (actor_uid, action, request_key)
  do update set status = 'pending', response_json = null, completed_at = null;

  for item in select value from jsonb_array_elements(payload -> 'rows') loop
    teacher_name := trim(coalesce(item ->> 'teacher', ''));
    student_name := trim(coalesce(item ->> 'student', ''));
    class_date_text := trim(coalesce(item ->> 'date', ''));
    log_status := trim(coalesce(item ->> 'logStatus', item ->> 'status', ''));
    reason_text := trim(coalesce(item ->> 'reason', ''));
    start_text := private.portal_compact_time_label(item ->> 'start');
    end_text := private.portal_compact_time_label(item ->> 'end');
    class_name_text := trim(coalesce(item ->> 'className', item ->> 'category', ''));

    if teacher_name = '' or student_name = '' or log_status = '' or class_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '수업일지 필수값(강사·학생·날짜·상태)이 누락되었습니다.' using errcode = '22023';
    end if;
    class_date_value := class_date_text::date;
    if not (to_char(class_date_value, 'YYYY-MM') = any(affected_month_keys)) then
      affected_month_keys := array_append(affected_month_keys, to_char(class_date_value, 'YYYY-MM'));
    end if;
    if identity_row.role <> 'admin'
       and private.portal_normalize_teacher_name(teacher_name) <> private.portal_normalize_teacher_name(actor_teacher_name) then
      raise exception '다른 강사의 수업일지는 저장할 수 없습니다.' using errcode = '42501';
    end if;

    legacy_key_value := 'classlog_v2_' || encode(
      extensions.digest(convert_to(teacher_name || '|' || student_name || '|' || class_date_text || '|' || start_text || '|' || end_text || '|' || class_name_text, 'UTF8'), 'sha256'),
      'hex'
    );
    insert into public.class_log_rows(
      legacy_key, class_date, teacher_name, student_name, status, reason,
      start_time_text, end_time_text, class_name, raw_row
    ) values (
      legacy_key_value, class_date_value, teacher_name, student_name, log_status, reason_text,
      start_text, end_text, class_name_text, jsonb_build_object(
        'teacher', teacher_name, 'student', student_name, 'date', class_date_text,
        'status', log_status, 'reason', reason_text, 'start', start_text,
        'end', end_text, 'className', class_name_text, 'source', 'teacher-portal-rpc'
      )
    )
    on conflict (legacy_key) do update set
      status = excluded.status,
      reason = excluded.reason,
      start_time_text = excluded.start_time_text,
      end_time_text = excluded.end_time_text,
      class_name = excluded.class_name,
      raw_row = excluded.raw_row;

    row_count_value := row_count_value + 1;
    signature_key := class_date_text || '|' || teacher_name;
    if not signature_keys ? signature_key then
      signature_keys := signature_keys || jsonb_build_object(signature_key, true);
      signature_count := signature_count + 1;
      if first_date = '' then first_date := class_date_text; first_teacher := teacher_name; end if;
      insert into public.signatures(class_date, teacher_name, signed, signed_at, signed_by, payload)
      values (
        class_date_value, teacher_name, true, now(), teacher_name,
        jsonb_build_object('source', 'teacher-portal-class-log-rpc', 'actorUid', v_actor_uid)
      )
      on conflict on constraint signatures_class_date_teacher_name_key do update set
        signed = true,
        signed_at = excluded.signed_at,
        signed_by = excluded.signed_by,
        payload = excluded.payload;
    end if;
  end loop;

  -- Direct readers must never reuse summaries created before this write.
  delete from public.teacher_hours_monthly_summaries
  where month_key = any(affected_month_keys);
  delete from public.student_stats_monthly_snapshots
  where month_key = any(affected_month_keys);

  insert into public.audit_events(actor, event_type, entity_table, after_data)
  values (v_actor_uid, 'class_log_rows_upsert', 'class_log_rows', jsonb_build_object(
    'requestKey', v_request_key, 'rowCount', row_count_value,
    'signatureCount', signature_count, 'affectedMonths', to_jsonb(affected_month_keys),
    'source', 'teacher-portal-rpc'
  ));

  response_value := jsonb_build_object(
    'success', true,
    'source', 'supabase-rpc',
    'count', row_count_value,
    'supabaseSynced', true,
    'sheetBackupEnabled', false,
    'sheetSaved', false,
    'sheetBackupSkipped', true,
    'hoursAgreement', jsonb_build_object(
      'signed', signature_count > 0,
      'count', signature_count,
      'date', first_date,
      'teacher', first_teacher
    )
  );
  update public.portal_write_requests
  set status = 'completed', response_json = response_value, completed_at = now()
  where portal_write_requests.actor_uid = v_actor_uid
    and action = 'saveClassLogRows'
    and portal_write_requests.request_key = v_request_key;
  return response_value;
exception when others then
  raise;
end;
$$;

revoke all on function public.portal_save_class_log_rows(jsonb) from public, anon;
grant execute on function public.portal_save_class_log_rows(jsonb) to authenticated;
