-- Ryktebørsen: manuell kuratering av overgangsrykter (fase 0)
create table if not exists public.rumor_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  summary text not null default '',
  source_name text not null default '',
  source_url text not null default '',
  tag text not null default 'rykte'
    check (tag in ('rykte', 'bekreftet', 'avvist')),
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author_id uuid references auth.users (id) on delete set null
);

comment on table public.rumor_posts is
  'Kuraterte overgangsrykter for Ryktebørsen. Kun korte utdrag + kilde/lenke.';

drop trigger if exists rumor_posts_updated_at on public.rumor_posts;
create trigger rumor_posts_updated_at
  before update on public.rumor_posts
  for each row execute function public.set_updated_at();

alter table public.rumor_posts enable row level security;

drop policy if exists "rumors_public_read" on public.rumor_posts;
create policy "rumors_public_read"
  on public.rumor_posts for select
  to anon, authenticated
  using (published = true or public.is_admin());

drop policy if exists "rumors_admin_write" on public.rumor_posts;
create policy "rumors_admin_write"
  on public.rumor_posts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
