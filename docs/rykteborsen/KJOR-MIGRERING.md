# Ryktebørsen — kjør migrasjon

For at admin skal kunne lagre rykter i Supabase:

1. Åpne Supabase → SQL Editor
2. Kjør innholdet i `supabase/migrations/20260806120000_rumor_posts.sql`
3. Verifiser at tabellen `rumor_posts` finnes og RLS er på

Uten migrasjon viser `rykteborsen.html` fallback fra `assets/data/rumors.json` (tom liste).
