-- Medlemshåndtering: register, utmeldingstokens, e-postkø, audit
-- Steg 1–2 (uten Vipps-betaling ennå)

create extension if not exists "pgcrypto";

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null default '',
  country text not null default 'NO',
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'cancelled', 'lapsed')),
  joined_at timestamptz,
  cancelled_at timestamptz,
  paid_until timestamptz,
  vipps_agreement_id text,
  notes text not null default '',
  consent_privacy_at timestamptz,
  consent_marketing_at timestamptz,
  source text not null default 'web'
    check (source in ('web', 'admin', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create unique index if not exists members_email_open_uidx
  on public.members (lower(email))
  where status in ('pending_payment', 'active', 'lapsed');

create index if not exists members_status_idx on public.members (status);
create index if not exists members_created_at_idx on public.members (created_at desc);

create table if not exists public.membership_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  amount_ore integer not null check (amount_ore >= 0),
  currency text not null default 'NOK',
  vipps_reference text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded', 'manual')),
  paid_at timestamptz,
  note text not null default '',
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_payments_member_idx
  on public.membership_payments (member_id, created_at desc);

create table if not exists public.unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  member_id uuid not null references public.members (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists unsubscribe_tokens_member_idx
  on public.unsubscribe_tokens (member_id);

create table if not exists public.member_mail_outbox (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members (id) on delete set null,
  to_email text not null,
  subject text not null,
  body_text text not null,
  unsubscribe_url text,
  kind text not null default 'welcome'
    check (kind in ('welcome', 'received', 'unsubscribe_link', 'reminder', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists member_mail_outbox_status_idx
  on public.member_mail_outbox (status, created_at desc);

create table if not exists public.member_audit_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists member_audit_log_member_idx
  on public.member_audit_log (member_id, created_at desc);

drop trigger if exists members_updated_at on public.members;
create trigger members_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

drop trigger if exists membership_payments_updated_at on public.membership_payments;
create trigger membership_payments_updated_at
  before update on public.membership_payments
  for each row execute function public.set_updated_at();

alter table public.members enable row level security;
alter table public.membership_payments enable row level security;
alter table public.unsubscribe_tokens enable row level security;
alter table public.member_mail_outbox enable row level security;
alter table public.member_audit_log enable row level security;

drop policy if exists "members_admin_all" on public.members;
create policy "members_admin_all"
  on public.members for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "membership_payments_admin_all" on public.membership_payments;
create policy "membership_payments_admin_all"
  on public.membership_payments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "unsubscribe_tokens_admin_all" on public.unsubscribe_tokens;
create policy "unsubscribe_tokens_admin_all"
  on public.unsubscribe_tokens for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "member_mail_outbox_admin_all" on public.member_mail_outbox;
create policy "member_mail_outbox_admin_all"
  on public.member_mail_outbox for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "member_audit_log_admin_all" on public.member_audit_log;
create policy "member_audit_log_admin_all"
  on public.member_audit_log for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public._member_token_hash(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

create or replace function public._issue_unsubscribe_token(
  p_member_id uuid,
  p_ttl_days integer default 30
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_hash text;
  v_days integer := greatest(coalesce(p_ttl_days, 30), 1);
begin
  update public.unsubscribe_tokens
  set used_at = coalesce(used_at, now())
  where member_id = p_member_id
    and used_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := public._member_token_hash(v_token);

  insert into public.unsubscribe_tokens (token_hash, member_id, expires_at)
  values (v_hash, p_member_id, now() + make_interval(days => v_days));

  return v_token;
end;
$$;

create or replace function public._queue_member_mail(
  p_member_id uuid,
  p_kind text,
  p_subject text,
  p_body text,
  p_unsubscribe_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_id uuid;
begin
  select email into v_email from public.members where id = p_member_id;
  if v_email is null then
    raise exception 'member not found';
  end if;

  insert into public.member_mail_outbox (
    member_id, to_email, subject, body_text, unsubscribe_url, kind, status
  ) values (
    p_member_id, v_email, p_subject, p_body, p_unsubscribe_url, p_kind, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

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
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := regexp_replace(trim(coalesce(p_phone, '')), '\s+', '', 'g');
  v_country text := upper(trim(coalesce(nullif(p_country, ''), 'NO')));
  v_base text := rtrim(coalesce(p_base_url, ''), '/');
  v_id uuid;
  v_token text;
  v_url text;
  v_body text;
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
      and m.status in ('pending_payment', 'active', 'lapsed')
  ) then
    raise exception 'E-posten er allerede registrert';
  end if;

  insert into public.members (
    full_name, email, phone, country, status, source,
    consent_privacy_at, consent_marketing_at
  ) values (
    v_name,
    v_email,
    v_phone,
    v_country,
    'pending_payment',
    'web',
    now(),
    case when p_consent_marketing then now() else null end
  )
  returning id into v_id;

  insert into public.member_audit_log (member_id, action, detail)
  values (
    v_id,
    'register_public',
    jsonb_build_object('email', v_email, 'country', v_country)
  );

  v_token := public._issue_unsubscribe_token(v_id, 30);
  if v_base <> '' then
    v_url := v_base || '/utmelding.html?token=' || v_token;
  else
    v_url := null;
  end if;

  v_body := format(
    E'Hei %s,\n\nTakk for at du melder deg inn i Coventry City Scandinavia.\n\nVi har mottatt søknaden din. Når kontingent er betalt (eller godkjent av admin), blir medlemskapet aktivt.\n\nVil du avbryte eller melde deg ut senere, bruk denne lenken:\n%s\n\nSky blue forever\nCoventry City Scandinavia\n',
    v_name,
    coalesce(v_url, '(utmeldingslenke kommer i e-post fra oss)')
  );

  perform public._queue_member_mail(
    v_id,
    'received',
    'Innmelding mottatt — Coventry City Scandinavia',
    v_body,
    v_url
  );

  return jsonb_build_object(
    'ok', true,
    'member_id', v_id,
    'status', 'pending_payment'
  );
end;
$$;

create or replace function public.unsubscribe_with_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := trim(coalesce(p_token, ''));
  v_hash text;
  v_row public.unsubscribe_tokens%rowtype;
  v_member public.members%rowtype;
begin
  if char_length(v_token) < 16 then
    raise exception 'Ugyldig lenke';
  end if;

  v_hash := public._member_token_hash(v_token);

  select * into v_row
  from public.unsubscribe_tokens
  where token_hash = v_hash;

  if not found then
    raise exception 'Ugyldig eller utløpt lenke';
  end if;
  if v_row.used_at is not null then
    raise exception 'Lenken er allerede brukt';
  end if;
  if v_row.expires_at < now() then
    raise exception 'Lenken er utløpt';
  end if;

  select * into v_member from public.members where id = v_row.member_id;
  if not found then
    raise exception 'Medlem ikke funnet';
  end if;

  if v_member.status = 'cancelled' then
    update public.unsubscribe_tokens set used_at = now() where id = v_row.id;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'already', true);
  end if;

  update public.members
  set
    status = 'cancelled',
    cancelled_at = now()
  where id = v_member.id;

  update public.unsubscribe_tokens
  set used_at = now()
  where id = v_row.id;

  insert into public.member_audit_log (member_id, action, detail)
  values (
    v_member.id,
    'unsubscribe_token',
    jsonb_build_object('previous_status', v_member.status)
  );

  return jsonb_build_object('ok', true, 'status', 'cancelled', 'already', false);
end;
$$;

create or replace function public.issue_member_unsubscribe_link(
  p_member_id uuid,
  p_base_url text,
  p_ttl_days integer default 30,
  p_queue_mail boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_token text;
  v_base text := rtrim(coalesce(p_base_url, ''), '/');
  v_url text;
  v_body text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    raise exception 'Medlem ikke funnet';
  end if;
  if v_base = '' then
    raise exception 'base_url mangler';
  end if;

  v_token := public._issue_unsubscribe_token(p_member_id, p_ttl_days);
  v_url := v_base || '/utmelding.html?token=' || v_token;

  if coalesce(p_queue_mail, true) then
    v_body := format(
      E'Hei %s,\n\nHer er lenken for å melde deg ut av Coventry City Scandinavia:\n%s\n\nLenken er engangs og utløper. Hvis du ikke ba om denne e-posten, kan du ignorere den.\n\nSky blue forever\nCoventry City Scandinavia\n',
      v_member.full_name,
      v_url
    );
    perform public._queue_member_mail(
      p_member_id,
      'unsubscribe_link',
      'Utmeldingslenke — Coventry City Scandinavia',
      v_body,
      v_url
    );
  end if;

  insert into public.member_audit_log (member_id, action, detail, actor_id)
  values (
    p_member_id,
    'issue_unsubscribe_link',
    jsonb_build_object('ttl_days', coalesce(p_ttl_days, 30)),
    auth.uid()
  );

  return jsonb_build_object('ok', true, 'url', v_url, 'email', v_member.email);
end;
$$;

create or replace function public.activate_member(
  p_member_id uuid,
  p_base_url text default '',
  p_paid_until timestamptz default null,
  p_amount_ore integer default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_until timestamptz;
  v_token text;
  v_base text := rtrim(coalesce(p_base_url, ''), '/');
  v_url text;
  v_body text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    raise exception 'Medlem ikke funnet';
  end if;

  v_until := coalesce(p_paid_until, now() + interval '1 year');

  update public.members
  set
    status = 'active',
    joined_at = coalesce(joined_at, now()),
    cancelled_at = null,
    paid_until = v_until
  where id = p_member_id;

  if p_amount_ore is not null then
    insert into public.membership_payments (
      member_id, amount_ore, currency, status, paid_at, note
    ) values (
      p_member_id,
      p_amount_ore,
      'NOK',
      'manual',
      now(),
      coalesce(p_note, 'Manuell aktivering')
    );
  end if;

  if v_base <> '' then
    v_token := public._issue_unsubscribe_token(p_member_id, 365);
    v_url := v_base || '/utmelding.html?token=' || v_token;
    v_body := format(
      E'Hei %s,\n\nVelkommen som medlem i Coventry City Scandinavia!\n\nMedlemskapet ditt er aktivt%s.\n\nFor å melde deg ut, bruk denne lenken:\n%s\n\nSky blue forever\nCoventry City Scandinavia\n',
      v_member.full_name,
      case when v_until is not null then format(' til %s', to_char(v_until at time zone 'Europe/Oslo', 'DD.MM.YYYY')) else '' end,
      v_url
    );
    perform public._queue_member_mail(
      p_member_id,
      'welcome',
      'Velkommen som medlem — Coventry City Scandinavia',
      v_body,
      v_url
    );
  end if;

  insert into public.member_audit_log (member_id, action, detail, actor_id)
  values (
    p_member_id,
    'activate',
    jsonb_build_object(
      'paid_until', v_until,
      'amount_ore', p_amount_ore,
      'previous_status', v_member.status
    ),
    auth.uid()
  );

  return jsonb_build_object('ok', true, 'status', 'active', 'paid_until', v_until, 'unsubscribe_url', v_url);
end;
$$;

revoke all on function public._member_token_hash(text) from public;
revoke all on function public._issue_unsubscribe_token(uuid, integer) from public;
revoke all on function public._queue_member_mail(uuid, text, text, text, text) from public;

grant execute on function public.register_member_public(text, text, text, text, boolean, boolean, text)
  to anon, authenticated;
grant execute on function public.unsubscribe_with_token(text)
  to anon, authenticated;
grant execute on function public.issue_member_unsubscribe_link(uuid, text, integer, boolean)
  to authenticated;
grant execute on function public.activate_member(uuid, text, timestamptz, integer, text)
  to authenticated;

insert into public.site_settings (key, value) values
  ('membership', '{
    "fee_ore": 20000,
    "currency": "NOK",
    "period_months": 12,
    "public_signup": true,
    "notes": "Vipps kobles på i steg 3. Innmelding går til pending_payment til admin aktiverer."
  }'::jsonb)
on conflict (key) do nothing;
