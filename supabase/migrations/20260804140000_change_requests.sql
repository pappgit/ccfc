-- Optional: dedicated tables for change requests / changelog.
-- The admin UI currently stores these in site_settings keys:
--   changelog        -> { entries: [...] }
--   change_requests  -> { items: [...] }
-- This migration is available if you prefer relational tables later.

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  author text not null default '',
  body text not null,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists change_requests_updated_at on public.change_requests;
create trigger change_requests_updated_at
  before update on public.change_requests
  for each row execute function public.set_updated_at();

alter table public.change_requests enable row level security;

drop policy if exists "change_requests_admin_all" on public.change_requests;
create policy "change_requests_admin_all"
  on public.change_requests for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
