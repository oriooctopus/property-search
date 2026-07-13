alter table public.saved_searches add column is_default boolean not null default false;
-- Enforce "only one default per user" at the DB level via a partial unique index.
create unique index saved_searches_one_default_per_user on public.saved_searches (user_id) where is_default;
