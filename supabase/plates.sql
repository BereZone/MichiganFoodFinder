-- Macro plates: one row per (user, date, meal). Items are stored as JSONB so
-- the whole plate is written atomically — a removed item is simply absent from
-- the array, so it cannot resurrect from another device's stale copy.
-- Run once in the Supabase SQL Editor, after schema.sql. Idempotent.

create table if not exists public.plates (
    user_id    uuid not null references auth.users (id) on delete cascade,
    date       date not null,
    meal       text not null,   -- Breakfast | Brunch | Lunch | Dinner
    items      jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (user_id, date, meal)
);

alter table public.plates enable row level security;

-- Each user can see and manage only their own plates.
drop policy if exists "Read own plates" on public.plates;
create policy "Read own plates" on public.plates
    for select using ((select auth.uid()) = user_id);

drop policy if exists "Add own plates" on public.plates;
create policy "Add own plates" on public.plates
    for insert with check ((select auth.uid()) = user_id);

-- Required: plates are written with upsert, so every save after the first to a
-- given plate is an UPDATE. Without this policy those writes silently no-op.
drop policy if exists "Update own plates" on public.plates;
create policy "Update own plates" on public.plates
    for update using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Remove own plates" on public.plates;
create policy "Remove own plates" on public.plates
    for delete using ((select auth.uid()) = user_id);
