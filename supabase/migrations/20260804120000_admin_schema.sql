-- CCFC Scandinavia admin schema
create extension if not exists "pgcrypto";

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  published boolean not null default false,
  show_on_home boolean not null default true,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author_id uuid references auth.users (id) on delete set null
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists news_posts_updated_at on public.news_posts;
create trigger news_posts_updated_at
  before update on public.news_posts
  for each row execute function public.set_updated_at();

drop trigger if exists site_settings_updated_at on public.site_settings;
create trigger site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.admins enable row level security;
alter table public.news_posts enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists "admins_read_self" on public.admins;
create policy "admins_read_self"
  on public.admins for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admins_write_admin" on public.admins;
create policy "admins_write_admin"
  on public.admins for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "news_public_read" on public.news_posts;
create policy "news_public_read"
  on public.news_posts for select
  to anon, authenticated
  using (published = true or public.is_admin());

drop policy if exists "news_admin_write" on public.news_posts;
create policy "news_admin_write"
  on public.news_posts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "settings_public_read" on public.site_settings;
create policy "settings_public_read"
  on public.site_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "settings_admin_write" on public.site_settings;
create policy "settings_admin_write"
  on public.site_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.site_settings (key, value) values
  ('api', '{
    "provider": "football-data",
    "season": 2026,
    "team_name": "Coventry City",
    "team_id_api_football": 1346,
    "sync_day": "monday",
    "notes": "API-nøkler ligger i GitHub Secrets (FOOTBALL_DATA_API_KEY / API_FOOTBALL_KEY), ikke i databasen."
  }'::jsonb)
on conflict (key) do nothing;

insert into public.news_posts (slug, title, excerpt, body, published, show_on_home, published_at) values
(
  'velkommen',
  'Velkommen til Coventry City Scandinavia',
  'Vi samler skandinaviske Sky Blues-supportere — kamper, resultater og klubbnyheter på ett sted.',
  'Coventry City Scandinavia er supporterklubben for Sky Blues-fans i Norge, Sverige, Danmark og resten av Norden.

Denne nettsiden følger laget gjennom sesongen: kamper, resultater og nyheter. Sky blue forever.',
  true,
  true,
  '2026-08-01T12:00:00Z'
),
(
  'premier-league-klar',
  'Premier League-klart: hva betyr det for oss?',
  'Opprykket endrer sesongen vår — flere kamper på TV, flere turer, og mer å samles om.',
  'Med Coventry tilbake i Premier League blir det flere muligheter for felles visninger og turer til CBS Arena.

Vi oppdaterer kampprogrammet her på siden hver uke. Følg Nyheter for info om samlinger og reiser.',
  true,
  true,
  '2026-04-22T12:00:00Z'
),
(
  'pitch-til-klubben',
  'Nettsiden pitches til klubben',
  'Visuelt språk henter sky blue fra CCFC. Offisiell logo og merkevare avklarer vi i dialog med klubben.',
  'Dette nettstedet viser retning: farger, typografi, kamper, resultater og nyheter — hostet på GitHub Pages.

Vi bruker et eget CCS-merke. Etter pitch avklarer vi med klubben hva som er greit å bruke.',
  true,
  true,
  '2026-08-03T12:00:00Z'
)
on conflict (slug) do nothing;

create or replace function public.admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins);
$$;

grant execute on function public.admin_exists() to anon, authenticated;

-- Bootstrap self-signup removed; admins are created in Supabase dashboard.
