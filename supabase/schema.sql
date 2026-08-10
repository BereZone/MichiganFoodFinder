-- UMich Dining Hall Food — database schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: all statements are idempotent.

-- Canonical food items, deduplicated by casefolded name.
-- Future favorites feature: user_favorites will reference items(id).
create table if not exists public.items (
    id         bigint generated always as identity primary key,
    item_key   text not null unique,   -- casefolded, whitespace-normalized name
    name       text not null,          -- display name as shown on the menu
    created_at timestamptz not null default now()
);

-- One row per item appearance: a specific item served at a specific
-- date / hall / meal / station. Historical rows are never deleted.
create table if not exists public.offerings (
    id                 bigint generated always as identity primary key,
    item_id            bigint not null references public.items (id) on delete cascade,
    date               date not null,
    hall               text not null,
    meal               text not null,   -- Breakfast | Brunch | Lunch | Dinner
    station            text not null default '',
    nutrient_density   text not null default '',   -- '', Low, Low/Medium, Medium, Medium/High, High
    carbon_footprint   text not null default '',   -- '', Low, Medium, High
    tags               text[] not null default '{}',  -- Vegan, Halal, Gluten Free, ...
    calories           integer,
    serving_size       text,          -- as published, e.g. '1/2 Cup (113g)'
    total_fat          text,
    total_carbohydrate text,
    protein            text,
    sodium             text,
    scraped_at         timestamptz not null default now(),
    unique (date, hall, meal, station, item_id)
);

-- Added 2026-08-09 for the plate serving-size display. Separate from the
-- create table above so existing databases pick it up on a re-run.
alter table public.offerings add column if not exists serving_size text;

create index if not exists offerings_date_idx    on public.offerings (date);
create index if not exists offerings_item_id_idx on public.offerings (item_id);
create index if not exists offerings_date_hall_idx on public.offerings (date, hall);

-- Row Level Security: the website reads with the anon key, so allow
-- public SELECT only. Writes happen via the service role / direct
-- database connection from the scraper, which bypasses RLS.
alter table public.items     enable row level security;
alter table public.offerings enable row level security;

drop policy if exists "Public read access" on public.items;
create policy "Public read access" on public.items
    for select using (true);

drop policy if exists "Public read access" on public.offerings;
create policy "Public read access" on public.offerings
    for select using (true);
