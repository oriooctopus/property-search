-- Create ingest_runs table to track orchestrator runs for the Phase C ingest
-- pipeline (scripts/ingest.ts → lib/ingest/orchestrator.ts).
create table if not exists ingest_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetch_strategy text not null,
  sources text[] not null,
  phase_results jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  warnings text[] not null default array[]::text[],
  exit_code int,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingest_runs_started_at on ingest_runs(started_at desc);
