# Kjøre migrering (steg 1)

SQL-fil: `supabase/migrations/20260804150000_membership.sql`

Hvis du allerede har kjørt den: kjør også  
`supabase/migrations/20260804160000_membership_pgcrypto_path.sql`  
(fikser `gen_random_bytes` / `digest` under Supabase `extensions`-schema).

## Alternativ A — Supabase Dashboard

1. Åpne [SQL Editor](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg/sql)
2. Lim inn hele filen og kjør
3. Verifiser at tabellene `members`, `member_mail_outbox`, m.fl. finnes under Table Editor

## Alternativ B — CLI

```bash
supabase link --project-ref zzqhgqcwuztbqgkvpxjg
supabase db push
```

Uten denne migreringen vil innmelding og admin-fanen **Medlemmer** feile mot databasen.
