-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run

create table if not exists films (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  title text not null,
  tmdb_id integer,
  release_year integer,
  director text,
  genres text[] default '{}',
  poster_path text,
  runtime integer,
  status text not null default 'not_watched' check (status in ('watched', 'not_watched')),
  rating text check (rating in ('loved', 'disliked') or rating is null),
  tags text[] default '{}',
  notes text default '',
  added_at timestamptz not null default now(),
  watched_at timestamptz
);

alter table films enable row level security;

-- Each signed-in user can only ever see or touch their own rows.
create policy "films_select_own" on films for select using (auth.uid() = user_id);
create policy "films_insert_own" on films for insert with check (auth.uid() = user_id);
create policy "films_update_own" on films for update using (auth.uid() = user_id);
create policy "films_delete_own" on films for delete using (auth.uid() = user_id);
