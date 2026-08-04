-- Admins must exist in BOTH auth.users and public.admins.
-- Rows are managed in the Supabase dashboard / Table Editor.
-- Example (run in SQL editor with service role if a user exists but cannot log in):
--
-- insert into public.admins (user_id, email)
-- select id, email from auth.users where email = 'someone@example.com'
-- on conflict (user_id) do update set email = excluded.email;
--
-- Ensure is_admin() stays security definer so RLS can check membership safely.

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

grant execute on function public.is_admin() to anon, authenticated;
