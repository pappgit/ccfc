-- Simplify membership: pending → approve / manual add → active + mail
-- Admin cancel → cancelled + mail. Editable HTML templates in site_settings.

-- Allow pending status (map old pending_payment)
alter table public.members drop constraint if exists members_status_check;
alter table public.members
  add constraint members_status_check
  check (status in ('pending', 'pending_payment', 'active', 'cancelled', 'lapsed'));

update public.members
set status = 'pending'
where status = 'pending_payment';

update public.members
set status = 'cancelled'
where status = 'lapsed';

drop index if exists members_email_open_uidx;
create unique index if not exists members_email_open_uidx
  on public.members (lower(email))
  where status in ('pending', 'active');

-- HTML body on outbox
alter table public.member_mail_outbox
  add column if not exists body_html text;

alter table public.member_mail_outbox drop constraint if exists member_mail_outbox_kind_check;
alter table public.member_mail_outbox
  add constraint member_mail_outbox_kind_check
  check (kind in ('welcome', 'received', 'unsubscribe_link', 'reminder', 'cancelled', 'other'));

-- Default editable mail templates
insert into public.site_settings (key, value) values
  ('member_mail_templates', '{
    "welcome": {
      "subject": "Velkommen som medlem — Coventry City Scandinavia",
      "html": "<p>Hei {{full_name}},</p><p>Velkommen som medlem i <strong>Coventry City Scandinavia</strong>!</p><p>Medlemskapet ditt er nå godkjent.</p><p>Sky blue forever<br>Coventry City Scandinavia</p>"
    },
    "cancelled": {
      "subject": "Medlemskapet er avsluttet — Coventry City Scandinavia",
      "html": "<p>Hei {{full_name}},</p><p>Medlemskapet ditt i <strong>Coventry City Scandinavia</strong> er nå avsluttet.</p><p>Takk for at du var med. Du er velkommen tilbake senere.</p><p>Sky blue forever<br>Coventry City Scandinavia</p>"
    }
  }'::jsonb)
on conflict (key) do nothing;

update public.site_settings
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{notes}',
  '"Enkel flyt: innmelding → til godkjenning. Godkjenn/manuell inn → velkomstmail. Meld ut → avslutningsmail."'::jsonb
)
where key = 'membership';

create or replace function public._html_to_text(p_html text)
returns text
language sql
immutable
as $$
  select trim(both E' \n\t' from
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p_html, ''), '(?i)<br\s*/?>', E'\n', 'g'),
        '(?i)</p>', E'\n\n', 'g'
      ),
      '<[^>]+>', '', 'g'
    )
  );
$$;

create or replace function public._render_member_template(p_html text, p_member public.members)
returns text
language sql
stable
as $$
  select replace(replace(replace(replace(coalesce(p_html, ''),
    '{{full_name}}', coalesce(p_member.full_name, '')),
    '{{email}}', coalesce(p_member.email, '')),
    '{{phone}}', coalesce(p_member.phone, '')),
    '{{country}}', coalesce(p_member.country, ''));
$$;

create or replace function public._queue_templated_mail(
  p_member_id uuid,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member public.members%rowtype;
  v_tpl jsonb;
  v_subject text;
  v_html text;
  v_text text;
  v_id uuid;
  v_key text;
begin
  select * into v_member from public.members where id = p_member_id;
  if not found then
    raise exception 'Medlem ikke funnet';
  end if;

  v_key := case
    when p_kind = 'welcome' then 'welcome'
    when p_kind = 'cancelled' then 'cancelled'
    else p_kind
  end;

  select value -> v_key into v_tpl
  from public.site_settings
  where key = 'member_mail_templates';

  if v_tpl is null then
    raise exception 'E-postmal mangler: %', v_key;
  end if;

  v_subject := public._render_member_template(coalesce(v_tpl->>'subject', ''), v_member);
  v_html := public._render_member_template(coalesce(v_tpl->>'html', ''), v_member);
  v_text := public._html_to_text(v_html);

  insert into public.member_mail_outbox (
    member_id, to_email, subject, body_text, body_html, kind, status
  ) values (
    p_member_id, v_member.email, v_subject, v_text, v_html, p_kind, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Public signup → pending only (no auto mail)
create or replace function public.register_member_public(
  p_full_name text,
  p_email text,
  p_phone text,
  p_country text default 'NO',
  p_consent_privacy boolean default false,
  p_consent_marketing boolean default false,
  p_base_url text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := regexp_replace(trim(coalesce(p_phone, '')), '\s+', '', 'g');
  v_country text := upper(trim(coalesce(nullif(p_country, ''), 'NO')));
  v_id uuid;
begin
  if v_name = '' or char_length(v_name) < 2 then
    raise exception 'Ugyldig navn';
  end if;
  if v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Ugyldig e-post';
  end if;
  if not coalesce(p_consent_privacy, false) then
    raise exception 'Personvernsamtykke er påkrevd';
  end if;
  if v_phone <> '' and char_length(v_phone) < 8 then
    raise exception 'Ugyldig telefonnummer';
  end if;

  if exists (
    select 1 from public.members m
    where lower(m.email) = v_email
      and m.status in ('pending', 'active')
  ) then
    raise exception 'E-posten er allerede registrert';
  end if;

  insert into public.members (
    full_name, email, phone, country, status, source,
    consent_privacy_at, consent_marketing_at
  ) values (
    v_name, v_email, v_phone, v_country, 'pending', 'web',
    now(),
    case when p_consent_marketing then now() else null end
  )
  returning id into v_id;

  insert into public.member_audit_log (member_id, action, detail)
  values (v_id, 'register_public', jsonb_build_object('email', v_email, 'country', v_country));

  return jsonb_build_object('ok', true, 'member_id', v_id, 'status', 'pending');
end;
$$;

create or replace function public.approve_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member public.members%rowtype;
  v_mail_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    raise exception 'Medlem ikke funnet';
  end if;
  if v_member.status not in ('pending', 'pending_payment', 'cancelled') then
    raise exception 'Medlemmet kan ikke godkjennes fra status %', v_member.status;
  end if;

  update public.members
  set
    status = 'active',
    joined_at = coalesce(joined_at, now()),
    cancelled_at = null
  where id = p_member_id;

  v_mail_id := public._queue_templated_mail(p_member_id, 'welcome');

  insert into public.member_audit_log (member_id, action, detail, actor_id)
  values (
    p_member_id,
    'approve',
    jsonb_build_object('previous_status', v_member.status, 'mail_id', v_mail_id),
    auth.uid()
  );

  return jsonb_build_object('ok', true, 'status', 'active', 'mail_id', v_mail_id);
end;
$$;

create or replace function public.admin_create_member(
  p_full_name text,
  p_email text,
  p_phone text default '',
  p_country text default 'NO',
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := regexp_replace(trim(coalesce(p_phone, '')), '\s+', '', 'g');
  v_country text := upper(trim(coalesce(nullif(p_country, ''), 'NO')));
  v_id uuid;
  v_mail_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if v_name = '' or char_length(v_name) < 2 then
    raise exception 'Ugyldig navn';
  end if;
  if v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Ugyldig e-post';
  end if;

  if exists (
    select 1 from public.members m
    where lower(m.email) = v_email
      and m.status in ('pending', 'active')
  ) then
    raise exception 'E-posten er allerede registrert';
  end if;

  insert into public.members (
    full_name, email, phone, country, status, source, notes,
    consent_privacy_at, joined_at, created_by
  ) values (
    v_name, v_email, v_phone, v_country, 'active', 'admin', coalesce(p_notes, ''),
    now(), now(), auth.uid()
  )
  returning id into v_id;

  v_mail_id := public._queue_templated_mail(v_id, 'welcome');

  insert into public.member_audit_log (member_id, action, detail, actor_id)
  values (
    v_id,
    'register_admin',
    jsonb_build_object('mail_id', v_mail_id),
    auth.uid()
  );

  return jsonb_build_object('ok', true, 'member_id', v_id, 'status', 'active', 'mail_id', v_mail_id);
end;
$$;

create or replace function public.cancel_member_admin(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member public.members%rowtype;
  v_mail_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    raise exception 'Medlem ikke funnet';
  end if;
  if v_member.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'already', true);
  end if;

  update public.members
  set status = 'cancelled', cancelled_at = now()
  where id = p_member_id;

  -- Only notify when an active (or previously joined) member is removed
  if v_member.status in ('active', 'lapsed') then
    v_mail_id := public._queue_templated_mail(p_member_id, 'cancelled');
  end if;

  insert into public.member_audit_log (member_id, action, detail, actor_id)
  values (
    p_member_id,
    'cancel_admin',
    jsonb_build_object('previous_status', v_member.status, 'mail_id', v_mail_id),
    auth.uid()
  );

  return jsonb_build_object('ok', true, 'status', 'cancelled', 'mail_id', v_mail_id);
end;
$$;

grant execute on function public.register_member_public(text, text, text, text, boolean, boolean, text)
  to anon, authenticated;
grant execute on function public.approve_member(uuid) to authenticated;
grant execute on function public.admin_create_member(text, text, text, text, text) to authenticated;
grant execute on function public.cancel_member_admin(uuid) to authenticated;
