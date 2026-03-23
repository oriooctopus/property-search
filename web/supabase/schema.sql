-- ============================================================
-- profiles
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Anyone can read profiles"
  on public.profiles for select
  using (true);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- listings
-- ============================================================
create table public.listings (
  id serial primary key,
  address text not null,
  area text not null,
  price int not null,
  beds int not null,
  baths numeric not null,
  sqft int,
  lat numeric not null,
  lon numeric not null,
  transit_summary text,
  photos int not null,
  url text not null,
  search_tag text not null,
  list_date timestamptz,
  last_update_date timestamptz,
  availability_date timestamptz,
  source text not null default 'realtor',
  photo_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.listings enable row level security;

create policy "Anyone can read listings"
  on public.listings for select
  using (true);

-- No insert/update/delete policies — only service role can write.

-- ============================================================
-- would_live_there
-- ============================================================
create table public.would_live_there (
  id serial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id int not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.would_live_there enable row level security;

create policy "Anyone can read would_live_there"
  on public.would_live_there for select
  using (true);

create policy "Users can insert own would_live_there"
  on public.would_live_there for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own would_live_there"
  on public.would_live_there for delete
  using (auth.uid() = user_id);

-- ============================================================
-- favorites
-- ============================================================
create table public.favorites (
  id serial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id int not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.favorites enable row level security;

create policy "Users can read own favorites"
  on public.favorites for select
  using (auth.uid() = user_id);

create policy "Users can insert own favorites"
  on public.favorites for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own favorites"
  on public.favorites for delete
  using (auth.uid() = user_id);

-- ============================================================
-- saved_searches
-- ============================================================
create table public.saved_searches (
  id serial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  notify_sms boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.saved_searches enable row level security;

create policy "Users can read own saved_searches"
  on public.saved_searches for select
  using (auth.uid() = user_id);

create policy "Users can insert own saved_searches"
  on public.saved_searches for insert
  with check (auth.uid() = user_id);

create policy "Users can update own saved_searches"
  on public.saved_searches for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own saved_searches"
  on public.saved_searches for delete
  using (auth.uid() = user_id);

-- ============================================================
-- conversations
-- ============================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  name text,
  filters jsonb not null default '{}'::jsonb,
  is_saved boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.conversations enable row level security;

create policy "Users can CRUD own conversations"
  on public.conversations for all
  using (auth.uid() = user_id);

-- ============================================================
-- conversation_messages
-- ============================================================
create table public.conversation_messages (
  id bigint primary key generated always as identity,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  parsed_filters jsonb,
  created_at timestamptz default now()
);

alter table public.conversation_messages enable row level security;

create policy "Users can access own conversation messages"
  on public.conversation_messages for all
  using (
    conversation_id in (select id from public.conversations where user_id = auth.uid())
  );
