# Kjøre migrering (steg 1)

# Kjøre migrering

Kjør i rekkefølge i [SQL Editor](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg/sql) hvis ikke allerede gjort:

1. `supabase/migrations/20260804150000_membership.sql`
2. `supabase/migrations/20260804160000_membership_pgcrypto_path.sql`
3. `supabase/migrations/20260804170000_membership_simple_flow.sql` ← **ny enkel flyt + HTML-maler**

## Alternativ — CLI

```bash
supabase link --project-ref zzqhgqcwuztbqgkvpxjg
supabase db push
```
