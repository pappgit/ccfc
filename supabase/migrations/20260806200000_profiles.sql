-- Thin user profiles for member login (minimal PII).
-- Auth holds email; profiles holds optional display_name.
-- Optional link: members.user_id → auth.users.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_len check (
    display_name is null or char_length(display_name) between 1 and 80
  )
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.members
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create unique index if not exists members_user_id_uidx
  on public.members (user_id)
  where user_id is not null;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- Auto-create profile when an Auth user is created (invite / dashboard).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing auth users (admins etc.).
insert into public.profiles (user_id, email, display_name)
select
  u.id,
  u.email,
  nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', '')), '')
from auth.users u
on conflict (user_id) do nothing;

-- Ensure own profile exists (e.g. if trigger missed).
create or replace function public.ensure_own_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Ikke innlogget';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.profiles (user_id, email)
  values (v_uid, v_email)
  on conflict (user_id) do update
    set email = coalesce(excluded.email, public.profiles.email)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ensure_own_profile() from public;
grant execute on function public.ensure_own_profile() to authenticated;

-- Member may update only display_name on own profile (email is Auth-owned).
create or replace function public.update_own_display_name(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'Ikke innlogget';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'Visningsnavn kan være maks 80 tegn';
  end if;

  perform public.ensure_own_profile();

  update public.profiles
  set display_name = v_name
  where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.update_own_display_name(text) from public;
grant execute on function public.update_own_display_name(text) to authenticated;

-- Logged-in users may read only their own membership row (status on Min side).
drop policy if exists "members_select_own" on public.members;
create policy "members_select_own"
  on public.members for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Admin helper: link member row to an auth user by email (after invite).
create or replace function public.admin_link_member_user(
  p_member_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Kun admin';
  end if;

  update public.members
  set user_id = p_user_id
  where id = p_member_id;

  if not found then
    raise exception 'Medlem ikke funnet';
  end if;

  return jsonb_build_object('ok', true, 'member_id', p_member_id, 'user_id', p_user_id);
end;
$$;

revoke all on function public.admin_link_member_user(uuid, uuid) from public;
grant execute on function public.admin_link_member_user(uuid, uuid) to authenticated;
