-- Security hardening (prioritet 1, 3, 5):
-- 1) Revoke callable SECURITY DEFINER mail helpers from PUBLIC/anon/authenticated
-- 3) HTML-escape member fields in e-postmaler
-- 5) Begrens site_settings-lesing til offentlige nøkler (+ admin)

-- ---------------------------------------------------------------------------
-- HTML escape for template substitution
-- ---------------------------------------------------------------------------
create or replace function public._html_escape(p text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(coalesce(p, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;');
$$;

create or replace function public._render_member_template(p_html text, p_member public.members)
returns text
language sql
stable
as $$
  select replace(replace(replace(replace(coalesce(p_html, ''),
    '{{full_name}}', public._html_escape(coalesce(p_member.full_name, ''))),
    '{{email}}', public._html_escape(coalesce(p_member.email, ''))),
    '{{phone}}', public._html_escape(coalesce(p_member.phone, ''))),
    '{{country}}', public._html_escape(coalesce(p_member.country, '')));
$$;

-- ---------------------------------------------------------------------------
-- Revoke internal helpers (callable only from other SECURITY DEFINER functions)
-- ---------------------------------------------------------------------------
revoke all on function public._html_escape(text) from public;
revoke all on function public._html_escape(text) from anon, authenticated;

revoke all on function public._html_to_text(text) from public;
revoke all on function public._html_to_text(text) from anon, authenticated;

revoke all on function public._render_member_template(text, public.members) from public;
revoke all on function public._render_member_template(text, public.members) from anon, authenticated;

revoke all on function public._queue_templated_mail(uuid, text) from public;
revoke all on function public._queue_templated_mail(uuid, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- site_settings: public read only for allowlisted keys; admins read all
-- ---------------------------------------------------------------------------
drop policy if exists "settings_public_read" on public.site_settings;
create policy "settings_public_read"
  on public.site_settings for select
  to anon, authenticated
  using (
    key in ('site', 'rumor_keywords', 'rumor_sources')
    or public.is_admin()
  );
