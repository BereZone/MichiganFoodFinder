# Macro plate: cart-style item selection with scaled macro totals

Date: 2026-08-09
Status: approved, not yet implemented

## Problem

The site shows per-item nutrition but nothing adds up. A user assembling a
meal has no way to ask "what are the macros for everything I'm about to
eat?", and no way to say "I'm having two of these and half of that".

## Scope

Users build a **plate** — a set of menu items with serving multipliers,
scoped to one date and one meal — and see summed calories, protein, carbs,
fat, and sodium. Plates persist per device and sync to the user's account
when signed in.

### Out of scope

Macro percentage split, daily goals or targets, copying a plate to another
day, and sharing plates. Each is a plausible follow-up; none is needed for
the feature to be useful.

## Constraints from existing data

`offerings` stores `calories` as an integer and `total_fat`,
`total_carbohydrate`, `protein`, `sodium` as strings like `"3g"` and
`"480mg"` (see `parse_nutrition_from_li` in `scrape_menus.py`). **No portion
or serving-size field is scraped.** Serving adjustment is therefore a
multiplier on the listed per-serving values, not gram-based scaling.

Many rows have `null` for some or all of these fields.

`/api/menus` returns only today through today+14 days.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Plate scope | One plate per `(date, meal)` | Every Browse row already carries both, so adding an item is unambiguous with no picker |
| Serving adjustment | Stepper in 0.5 increments, min 0.5, number directly editable | Handles both "half a side" and "three chicken breasts" |
| Persistence | localStorage + Supabase sync when signed in | Cross-device plates; mirrors the favorites model |
| Storage shape | One row per plate, items as JSONB | Makes the plate the atomic unit of write, so item deletion cannot resurrect |
| Missing nutrition | Sum what exists, warn explicitly | The headline number must never be quietly wrong |

### Why JSONB rather than a row per item

A row-per-item table (mirroring `user_favorites`) makes removal a special
case: remove an item on device A, then open device B whose localStorage
still lists it, and B re-uploads it. `useFavorites` has exactly this bug
today — harmless for a star, but here it silently corrupts a macro total.
Fixing it requires tombstones and their cleanup.

Writing the whole plate at once removes the case entirely: a removed item is
simply absent from the array that gets written. Conflict resolution collapses
to a single `updated_at` comparison, and a burst of stepper taps debounces
into one row write.

The cost is that two devices editing the *same* plate simultaneously resolve
last-write-wins rather than merging. For one student assembling one dinner,
that is not a real scenario.

## Data model

```ts
interface PlateEntry {
    item_key: string;
    name: string;          // denormalized display name
    hall: string;
    station: string;
    servings: number;      // 0.5 increments, min 0.5, max 99
    nutrition: {           // snapshot, parsed to numbers when added
        calories: number | null;
        fat_g: number | null;
        carbs_g: number | null;
        protein_g: number | null;
        sodium_mg: number | null;
    };
}

interface Plate {
    date: string;          // YYYY-MM-DD
    meal: string;          // Breakfast | Brunch | Lunch | Dinner
    items: PlateEntry[];
    updated_at: string;    // ISO 8601 — the last-write-wins clock
}
```

Plates are held in state and localStorage as `Record<string, Plate>` keyed
`` `${date}|${meal}` ``.

**Entry identity within a plate** is `` `${item_key}|${hall}|${station}` ``.
The same item at two halls is two entries. A newly added entry starts at
`servings: 1`; adding an entry already present increments its `servings` by
1 rather than duplicating it.

**Why nutrition is denormalized:** the menus API only covers today+14 days,
so a plate for a past date has no menu row left to join against and would
render empty. Snapshotting makes the plate screen fully independent of the
menu fetch. The tradeoff is that a re-scrape correcting a value does not
update existing plates — acceptable, and arguably correct for a record of
what was eaten.

## Schema

New file `supabase/plates.sql`, hand-run in the SQL Editor after
`schema.sql`, following the `user_favorites.sql` pattern.

```sql
create table if not exists public.plates (
    user_id    uuid not null references auth.users (id) on delete cascade,
    date       date not null,
    meal       text not null,
    items      jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (user_id, date, meal)
);

alter table public.plates enable row level security;
```

Policies for SELECT, INSERT, UPDATE, and DELETE, each restricted to
`(select auth.uid()) = user_id`.

**The UPDATE policy is required.** `user_favorites.sql` defines only
SELECT/INSERT/DELETE, which suits its insert-and-delete usage. `plates` is
upsert-driven, and without an UPDATE policy every write after the first to a
given plate silently no-ops under RLS.

## Sync

Signed out, the hook is localStorage-only — the same behavior favorites had
before auth. With the `VITE_SUPABASE_*` env vars absent, there is no sync and
no sync UI, and the feature still works fully.

**On sign-in** (when the session user id changes): fetch all remote plates,
union the local and remote key sets, and for each key keep whichever side has
the newer `updated_at`. Upsert every plate where local won. Set state to the
merged map.

**Clearing a plate writes an empty-items row rather than deleting the row.**
Deleting would reintroduce the resurrection hole at plate granularity: device
B's stale local copy would see no remote row and re-upload it. An `items: []`
row with a fresh timestamp beats the stale copy on the normal last-write-wins
path. An empty plate is a real persisted state, not an absence. Rows
accumulate one per meal ever touched, which is negligible.

**On mutation while signed in:** update local state and localStorage
immediately (optimistic), set `updated_at` to now, and schedule a debounced
upsert of roughly 800 ms per plate key, so a burst of stepper taps costs one
write. Pending writes flush on `visibilitychange: hidden` and `beforeunload`,
since mobile browsers background tabs aggressively.

**Sync failures are visible.** Unlike `useFavorites`, which only logs to the
console, a failed write shows a non-blocking notice on the plate screen —
"Not saved to your account — changes are on this device" — cleared on the
next successful write. Writes are retried on the next mutation or the next
sign-in merge.

**Known limitation:** `updated_at` is client-generated, because the client is
what compares the two values before writing. A device with a badly wrong
clock can win a conflict it should lose. A server-side `now()` would be
authoritative but cannot be compared against local state ahead of the write.

## Components

| File | Purpose |
|---|---|
| `supabase/plates.sql` | Table and RLS policies |
| `client/src/lib/nutrition.ts` | Pure: parse amount strings, scale, sum |
| `client/src/lib/mealTime.ts` | Detroit-time date and meal inference |
| `client/src/hooks/usePlates.ts` | Plate state, localStorage, debounced sync |
| `client/src/components/PlateView.tsx` | Totals screen |

`MenuFinder.tsx` is already 665 lines. It gains only a third tab and a
per-row add button; the plate UI lives in `PlateView.tsx` alongside
`MyMenu.tsx`.

`mealTime.ts` is extracted from the Detroit-time logic currently inlined in
`handleOpenNow` (`client/src/components/MenuFinder.tsx:238-263`), because the
plate screen needs the same "what meal is it now" inference for its default
selection. One copy, two callers.

### `lib/nutrition.ts`

- `parseAmount(value: string | null): number | null` — extracts the leading
  number from strings like `"3g"`, `"0.5g"`, `"480mg"`. Returns `null` for
  `null`, empty, or unparseable input. The caller knows the unit per field
  (fat/carbs/protein in grams, sodium in milligrams), so the unit suffix is
  discarded rather than converted.
- `scaleEntry(entry: PlateEntry)` — each non-null nutrition value multiplied
  by `servings`; `null` stays `null`.
- `totalPlate(items: PlateEntry[])` — per-field sums over scaled entries,
  skipping nulls, plus `incompleteCount`: the number of entries where any of
  the five fields is `null`.

Sums are computed unrounded and rounded only for display — calories to the
nearest 1, macros to the nearest 0.1 g, sodium to the nearest 1 mg — so the
totals header never drifts from the rows above it.

### `hooks/usePlates.ts`

```ts
usePlates(session: Session | null): {
    plates: Record<string, Plate>;
    getPlate(date: string, meal: string): Plate;
    addItem(date: string, meal: string, entry: PlateEntry): void;
    setServings(date: string, meal: string, entryId: string, servings: number): void;
    removeItem(date: string, meal: string, entryId: string): void;
    clearPlate(date: string, meal: string): void;
    syncError: boolean;
}
```

localStorage key `umich-dining-plates`.

`getPlate` returns an empty plate (`items: []`) for a key with no stored
plate, so callers never handle `undefined`. Nothing is persisted until the
first item is added.

The selected `(date, meal)` pair is **not** owned by `usePlates` — it lives
in `MenuFinder` and is passed to `PlateView`, because the tab badge needs the
same selection the plate screen is showing.

## UI

**Browse** gains a `+` button beside each row's star. The row already knows
its date and meal, so the item goes straight to the correct plate. When the
item is already on that plate the button shows its serving count instead of
`+`, and tapping increments by one.

**Tabs** become Browse | My Menu | Plate, the plate tab badged with the
current plate's item count.

**Plate screen**, top to bottom:

1. Date and meal selects. Default to the plate with the newest `updated_at`
   among non-empty plates, falling back to today plus the current meal from
   `mealTime.ts` when there are none — so switching tabs after adding items
   lands on what was just built.
2. Sticky totals bar: calories, protein, carbs, fat, sodium.
3. Warning banner when any entry is incomplete: "N items are missing some
   nutrition data — totals are a lower bound."
4. Item rows: name, `hall · station`, the `− 0.5 +` stepper with an editable
   number, scaled calories, and a remove `×`. Incomplete entries carry a
   quiet "partial data" badge so the banner's count traces to specific rows.
5. Clear plate action.
6. Empty state mirroring `MyMenu`'s.

## Error handling

- Unparseable nutrition strings become `null`, never `NaN`. The entry counts
  as incomplete.
- `servings` is clamped to [0.5, 99]. Non-numeric typed input reverts to the
  previous value.
- Corrupt localStorage JSON resets to `{}`, matching `readLocal` in
  `useFavorites`.
- Supabase absent: local-only, no sync indicator, feature fully functional.
- Sync failure: local state is retained and the notice is shown.

## Testing

The client has no JavaScript test runner today; CI runs Python unittest for
the scraper and a `tsc` build for the client.

Add **Vitest** covering the pure `lib/` modules, wired into the existing
`client` CI job. For `nutrition.ts`:

- `parseAmount` against `"3g"`, `"480mg"`, `"0.5g"`, `null`, `""`, and
  unparseable text.
- `scaleEntry` at 0.5x, 1x, and 2.5x, including null passthrough.
- `totalPlate` summing across entries with nulls present, and its
  `incompleteCount`.

`plateOps.ts` and `mealTime.ts` are covered the same way — mutation purity and
serving clamps for the former, and fixed-instant date/meal inference across
both EST and EDT for the latter. The merge function gets explicit
resurrection cases, since that is the behavior the storage shape exists to
guarantee.

Component and DOM tests are deliberately excluded: they require jsdom and
testing-library, a large dependency footprint for UI that `tsc` already
type-checks.

Sync behavior is verified manually, since tests would cover it poorly:

- Two browser profiles, same account: add on A, clear on B, confirm nothing
  resurrects on A after reload.
- Signed-out local-only path survives reload.
- A build without `VITE_SUPABASE_*` shows no sync UI and works.

## Changelog

`CHANGELOG.md` `[Unreleased] / Added` gains an entry when this is
implemented, per the project's Keep a Changelog convention.
