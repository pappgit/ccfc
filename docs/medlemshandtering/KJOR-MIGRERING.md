# Kjøre migrering (steg 1)

SQL-fil: `supabase/migrations/20260804150000_membership.sql`

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
