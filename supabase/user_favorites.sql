-- User favorites (phase 2: login + synced favorites).
-- Run once in the Supabase SQL Editor, after schema.sql. Idempotent.

create table if not exists public.user_favorites (
    user_id    uuid not null references auth.users (id) on delete cascade,
    item_key   text not null,   -- matches items.item_key / MenuItem.item_key
    created_at timestamptz not null default now(),
    primary key (user_id, item_key)
);

alter table public.user_favorites enable row level security;

-- Each user can see and manage only their own favorites.
drop policy if exists "Read own favorites" on public.user_favorites;
create policy "Read own favorites" on public.user_favorites
    for select using ((select auth.uid()) = user_id);

drop policy if exists "Add own favorites" on public.user_favorites;
create policy "Add own favorites" on public.user_favorites
    for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Remove own favorites" on public.user_favorites;
create policy "Remove own favorites" on public.user_favorites
    for delete using ((select auth.uid()) = user_id);
