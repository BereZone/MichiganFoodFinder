# Macro Plate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add menu items to a per-(date, meal) plate with 0.5-step serving multipliers and see summed calories, protein, carbs, fat, and sodium.

**Architecture:** All arithmetic and plate mutation lives in pure modules under `client/src/lib/` so it is unit-testable without a DOM. `usePlates` is a thin React shell over those pure functions that owns localStorage and Supabase sync. Each plate is stored as a single row with its items as JSONB, making the plate the atomic unit of write — so removing an item cannot resurrect across devices.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind 4, Supabase (postgres + auth), Vitest (added by Task 1).

Spec: `docs/superpowers/specs/2026-08-09-macro-plate-design.md`

## Global Constraints

- Conventional Commits. Never add `Co-Authored-By: Claude` or any AI co-author trailer.
- Update `CHANGELOG.md` `[Unreleased]` for user-facing changes (done in Task 8).
- Serving multipliers: step `0.5`, min `0.5`, max `99`.
- Nutrition units: `fat_g`, `carbs_g`, `protein_g` in grams; `sodium_mg` in milligrams; `calories` unitless.
- Display rounding: calories to nearest 1, macros to nearest 0.1 g, sodium to nearest 1 mg. Sum unrounded, round only for display.
- localStorage key: `umich-dining-plates`.
- Plate map key format: `` `${date}|${meal}` ``. Entry id format: `` `${item_key}|${hall}|${station}` ``.
- The app must remain fully functional with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` absent (`supabase` is `null`) — local-only, no sync UI.
- All `updated_at` values compared in JS must be normalized with `new Date(x).toISOString()` first. Postgres returns `+00:00` offsets which do **not** compare lexicographically against `.000Z` strings.
- Work happens on branch `feat/macro-plate` (already created).

## File Structure

| File | Responsibility |
|---|---|
| `client/src/types.ts` (modify) | Add `PlateNutrition`, `PlateEntry`, `Plate`, `PlateMap` |
| `client/src/lib/nutrition.ts` (create) | Parse amount strings, scale by servings, total a plate |
| `client/src/lib/plateOps.ts` (create) | Pure plate mutations and the sign-in merge |
| `client/src/lib/mealTime.ts` (create) | Detroit-time date + meal inference |
| `client/src/hooks/usePlates.ts` (create) | React state, localStorage, Supabase sync |
| `client/src/components/PlateView.tsx` (create) | Totals screen |
| `client/src/components/MenuFinder.tsx` (modify) | Third tab, per-row add button, plate selection state |
| `supabase/plates.sql` (create) | Table + RLS policies |
| `docs/auth-setup.md` (modify) | Document the new migration |
| `.github/workflows/test.yml` (modify) | Run `npm test` in the client job |

---

### Task 1: Vitest + nutrition math

**Files:**
- Modify: `client/package.json`
- Modify: `client/src/types.ts`
- Modify: `.github/workflows/test.yml:44-56`
- Create: `client/src/lib/nutrition.ts`
- Test: `client/src/lib/nutrition.test.ts`

**Interfaces:**
- Consumes: `MenuItem` from `client/src/types.ts` (existing).
- Produces: types `PlateNutrition`, `PlateEntry`, `Plate`, `PlateMap`; functions `parseAmount(value: string | null | undefined): number | null`, `nutritionFromMenuItem(item: MenuItem): PlateNutrition`, `scaleNutrition(n: PlateNutrition, servings: number): PlateNutrition`, `isIncomplete(entry: PlateEntry): boolean`, `totalPlate(items: PlateEntry[]): PlateTotals`, `roundGrams(n: number): number`; interface `PlateTotals`.

- [ ] **Step 1: Install Vitest and add the test script**

```bash
cd client && npm install --save-dev vitest@^3
```

Then in `client/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Add the plate types**

Append to `client/src/types.ts`:

```ts
export interface PlateNutrition {
    calories: number | null;
    fat_g: number | null;
    carbs_g: number | null;
    protein_g: number | null;
    sodium_mg: number | null;
}

export interface PlateEntry {
    item_key: string;
    name: string;
    hall: string;
    station: string;
    servings: number;
    nutrition: PlateNutrition;
}

export interface Plate {
    date: string;        // YYYY-MM-DD
    meal: string;        // Breakfast | Brunch | Lunch | Dinner
    items: PlateEntry[];
    updated_at: string;  // ISO 8601, always via new Date(...).toISOString()
}

export type PlateMap = Record<string, Plate>;
```

- [ ] **Step 3: Write the failing tests**

Create `client/src/lib/nutrition.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    parseAmount, nutritionFromMenuItem, scaleNutrition,
    isIncomplete, totalPlate, roundGrams,
} from './nutrition';
import type { MenuItem, PlateEntry, PlateNutrition } from '../types';

const nut = (o: Partial<PlateNutrition> = {}): PlateNutrition => ({
    calories: 100, fat_g: 2, carbs_g: 10, protein_g: 5, sodium_mg: 200, ...o,
});

const entry = (o: Partial<PlateEntry> = {}): PlateEntry => ({
    item_key: 'eggs', name: 'Eggs', hall: 'Bursley', station: 'Grill',
    servings: 1, nutrition: nut(), ...o,
});

describe('parseAmount', () => {
    it('parses gram values', () => expect(parseAmount('3g')).toBe(3));
    it('parses milligram values', () => expect(parseAmount('480mg')).toBe(480));
    it('parses decimals', () => expect(parseAmount('0.5g')).toBe(0.5));
    it('tolerates leading whitespace', () => expect(parseAmount('  12g')).toBe(12));
    it('returns null for null', () => expect(parseAmount(null)).toBeNull());
    it('returns null for undefined', () => expect(parseAmount(undefined)).toBeNull());
    it('returns null for empty string', () => expect(parseAmount('')).toBeNull());
    it('returns null for unparseable text', () => expect(parseAmount('n/a')).toBeNull());
});

describe('nutritionFromMenuItem', () => {
    it('maps and parses every field', () => {
        const item = {
            nutrition: {
                calories: 164, total_fat: '3g', total_carbohydrate: '20g',
                protein: '12g', sodium: '480mg',
            },
        } as MenuItem;
        expect(nutritionFromMenuItem(item)).toEqual({
            calories: 164, fat_g: 3, carbs_g: 20, protein_g: 12, sodium_mg: 480,
        });
    });

    it('yields nulls when the menu item has no nutrition values', () => {
        const item = {
            nutrition: {
                calories: null, total_fat: null, total_carbohydrate: null,
                protein: null, sodium: null,
            },
        } as MenuItem;
        expect(nutritionFromMenuItem(item)).toEqual({
            calories: null, fat_g: null, carbs_g: null, protein_g: null, sodium_mg: null,
        });
    });
});

describe('scaleNutrition', () => {
    it('scales by a half serving', () => {
        expect(scaleNutrition(nut(), 0.5)).toEqual({
            calories: 50, fat_g: 1, carbs_g: 5, protein_g: 2.5, sodium_mg: 100,
        });
    });

    it('scales by 2.5 servings', () => {
        expect(scaleNutrition(nut(), 2.5)).toEqual({
            calories: 250, fat_g: 5, carbs_g: 25, protein_g: 12.5, sodium_mg: 500,
        });
    });

    it('keeps nulls null instead of producing NaN', () => {
        const scaled = scaleNutrition(nut({ protein_g: null }), 2);
        expect(scaled.protein_g).toBeNull();
        expect(scaled.calories).toBe(200);
    });
});

describe('isIncomplete', () => {
    it('is false when every field is present', () => {
        expect(isIncomplete(entry())).toBe(false);
    });
    it('is true when any field is null', () => {
        expect(isIncomplete(entry({ nutrition: nut({ sodium_mg: null }) }))).toBe(true);
    });
});

describe('totalPlate', () => {
    it('returns zeros and no incomplete entries for an empty plate', () => {
        expect(totalPlate([])).toEqual({
            calories: 0, fat_g: 0, carbs_g: 0, protein_g: 0, sodium_mg: 0,
            incompleteCount: 0,
        });
    });

    it('sums scaled entries', () => {
        const totals = totalPlate([entry({ servings: 2 }), entry({ item_key: 'rice', servings: 0.5 })]);
        expect(totals.calories).toBe(250);
        expect(totals.protein_g).toBe(12.5);
        expect(totals.sodium_mg).toBe(500);
        expect(totals.incompleteCount).toBe(0);
    });

    it('skips nulls rather than treating them as zero-or-NaN, and counts them', () => {
        const totals = totalPlate([
            entry({ servings: 1 }),
            entry({ item_key: 'mystery', servings: 3, nutrition: nut({ calories: null, protein_g: null }) }),
        ]);
        expect(totals.calories).toBe(100);
        expect(totals.protein_g).toBe(5);
        expect(totals.fat_g).toBe(8);
        expect(totals.incompleteCount).toBe(1);
    });

    it('sums unrounded so display rounding cannot drift', () => {
        const third = nut({ protein_g: 0.1, calories: null, fat_g: null, carbs_g: null, sodium_mg: null });
        const totals = totalPlate([
            entry({ item_key: 'a', nutrition: third }),
            entry({ item_key: 'b', nutrition: third }),
            entry({ item_key: 'c', nutrition: third }),
        ]);
        expect(roundGrams(totals.protein_g)).toBe(0.3);
    });
});

describe('roundGrams', () => {
    it('rounds to one decimal place', () => expect(roundGrams(12.34)).toBe(12.3));
    it('rounds halves up', () => expect(roundGrams(0.25)).toBe(0.3));
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Failed to resolve import "./nutrition"`.

- [ ] **Step 5: Implement the module**

Create `client/src/lib/nutrition.ts`:

```ts
import type { MenuItem, PlateEntry, PlateNutrition } from '../types';

export interface PlateTotals {
    calories: number;
    fat_g: number;
    carbs_g: number;
    protein_g: number;
    sodium_mg: number;
    /** Entries missing at least one nutrition value — totals are a lower bound. */
    incompleteCount: number;
}

/**
 * Leading number from a scraped amount string such as "3g", "0.5g", "480mg".
 * The caller knows the unit per field, so the suffix is discarded rather than
 * converted. Anything unparseable becomes null — never NaN.
 */
export function parseAmount(value: string | null | undefined): number | null {
    if (value == null) return null;
    const match = /^\s*(\d+(?:\.\d+)?)/.exec(value);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
}

export function nutritionFromMenuItem(item: MenuItem): PlateNutrition {
    const n = item.nutrition;
    return {
        calories: n?.calories ?? null,
        fat_g: parseAmount(n?.total_fat),
        carbs_g: parseAmount(n?.total_carbohydrate),
        protein_g: parseAmount(n?.protein),
        sodium_mg: parseAmount(n?.sodium),
    };
}

const scale = (v: number | null, by: number) => (v == null ? null : v * by);

export function scaleNutrition(n: PlateNutrition, servings: number): PlateNutrition {
    return {
        calories: scale(n.calories, servings),
        fat_g: scale(n.fat_g, servings),
        carbs_g: scale(n.carbs_g, servings),
        protein_g: scale(n.protein_g, servings),
        sodium_mg: scale(n.sodium_mg, servings),
    };
}

export function isIncomplete(entry: PlateEntry): boolean {
    const n = entry.nutrition;
    return n.calories == null || n.fat_g == null || n.carbs_g == null
        || n.protein_g == null || n.sodium_mg == null;
}

export function totalPlate(items: PlateEntry[]): PlateTotals {
    const totals: PlateTotals = {
        calories: 0, fat_g: 0, carbs_g: 0, protein_g: 0, sodium_mg: 0,
        incompleteCount: 0,
    };

    for (const entry of items) {
        const s = scaleNutrition(entry.nutrition, entry.servings);
        if (s.calories != null) totals.calories += s.calories;
        if (s.fat_g != null) totals.fat_g += s.fat_g;
        if (s.carbs_g != null) totals.carbs_g += s.carbs_g;
        if (s.protein_g != null) totals.protein_g += s.protein_g;
        if (s.sodium_mg != null) totals.sodium_mg += s.sodium_mg;
        if (isIncomplete(entry)) totals.incompleteCount += 1;
    }

    return totals;
}

/** Display rounding for gram macros. Totals stay unrounded until here. */
export function roundGrams(n: number): number {
    return Math.round(n * 10) / 10;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS, 21 tests.

- [ ] **Step 7: Verify the production build still type-checks**

Run: `cd client && npm run build`
Expected: succeeds. If `tsc` cannot find Vitest types, add `"types": ["vitest/globals"]` is **not** the fix — the tests import `describe`/`it`/`expect` explicitly, so no globals config is needed. Any failure here is a real type error to fix.

- [ ] **Step 8: Wire tests into CI**

In `.github/workflows/test.yml`, in the `client` job, replace the final step with:

```yaml
      - name: Install and build (includes tsc)
        working-directory: client
        run: |
          npm ci
          npm run build

      - name: Unit tests
        working-directory: client
        run: npm test
```

- [ ] **Step 9: Commit**

```bash
git add client/package.json client/package-lock.json client/src/types.ts \
        client/src/lib/nutrition.ts client/src/lib/nutrition.test.ts \
        .github/workflows/test.yml
git commit -m "feat: add plate nutrition math and Vitest setup"
```

---

### Task 2: Pure plate operations

**Files:**
- Create: `client/src/lib/plateOps.ts`
- Test: `client/src/lib/plateOps.test.ts`

**Interfaces:**
- Consumes: `Plate`, `PlateEntry`, `PlateMap` from `client/src/types.ts` (Task 1).
- Produces: constants `MIN_SERVINGS = 0.5`, `MAX_SERVINGS = 99`, `SERVING_STEP = 0.5`; functions `plateKey(date, meal): string`, `entryId(entry): string`, `emptyPlate(date, meal): Plate`, `clampServings(n: number): number`, `addEntry(plate, entry, now): Plate`, `setEntryServings(plate, id, servings, now): Plate`, `removeEntry(plate, id, now): Plate`, `clearPlateItems(plate, now): Plate`, `mergePlateMaps(local, remote): { merged: PlateMap; toUpload: Plate[] }`.

Every mutation takes `now: string` as its last argument instead of calling `Date.now()` internally. That is what makes them pure and testable; `usePlates` supplies `new Date().toISOString()`.

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/plateOps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    MIN_SERVINGS, MAX_SERVINGS, plateKey, entryId, emptyPlate, clampServings,
    addEntry, setEntryServings, removeEntry, clearPlateItems, mergePlateMaps,
} from './plateOps';
import type { Plate, PlateEntry, PlateMap } from '../types';

const T1 = '2026-08-09T12:00:00.000Z';
const T2 = '2026-08-09T13:00:00.000Z';

const entry = (o: Partial<PlateEntry> = {}): PlateEntry => ({
    item_key: 'eggs', name: 'Eggs', hall: 'Bursley', station: 'Grill', servings: 1,
    nutrition: { calories: 100, fat_g: 2, carbs_g: 10, protein_g: 5, sodium_mg: 200 },
    ...o,
});

const plate = (items: PlateEntry[], updated_at = T1): Plate =>
    ({ date: '2026-08-09', meal: 'Dinner', items, updated_at });

describe('plateKey and entryId', () => {
    it('keys plates by date and meal', () => {
        expect(plateKey('2026-08-09', 'Dinner')).toBe('2026-08-09|Dinner');
    });
    it('distinguishes the same item at different halls', () => {
        expect(entryId(entry())).not.toBe(entryId(entry({ hall: 'Markley' })));
    });
    it('distinguishes the same item at different stations', () => {
        expect(entryId(entry())).not.toBe(entryId(entry({ station: 'Salad' })));
    });
});

describe('emptyPlate', () => {
    it('has no items and an epoch timestamp so it always loses a merge', () => {
        const p = emptyPlate('2026-08-09', 'Lunch');
        expect(p.items).toEqual([]);
        expect(p.updated_at).toBe('1970-01-01T00:00:00.000Z');
    });
});

describe('clampServings', () => {
    it('clamps below the minimum', () => expect(clampServings(0)).toBe(MIN_SERVINGS));
    it('clamps above the maximum', () => expect(clampServings(500)).toBe(MAX_SERVINGS));
    it('passes valid values through', () => expect(clampServings(2.5)).toBe(2.5));
    it('falls back to the minimum for NaN', () => expect(clampServings(NaN)).toBe(MIN_SERVINGS));
    it('falls back to the minimum for Infinity', () => expect(clampServings(Infinity)).toBe(MAX_SERVINGS));
});

describe('addEntry', () => {
    it('appends a new entry and stamps the time', () => {
        const next = addEntry(plate([]), entry(), T2);
        expect(next.items).toHaveLength(1);
        expect(next.items[0].servings).toBe(1);
        expect(next.updated_at).toBe(T2);
    });

    it('increments servings instead of duplicating an existing entry', () => {
        const next = addEntry(plate([entry({ servings: 2 })]), entry(), T2);
        expect(next.items).toHaveLength(1);
        expect(next.items[0].servings).toBe(3);
    });

    it('keeps the same item at a different hall as a separate entry', () => {
        const next = addEntry(plate([entry()]), entry({ hall: 'Markley' }), T2);
        expect(next.items).toHaveLength(2);
    });

    it('does not mutate the input plate', () => {
        const original = plate([]);
        addEntry(original, entry(), T2);
        expect(original.items).toHaveLength(0);
        expect(original.updated_at).toBe(T1);
    });
});

describe('setEntryServings', () => {
    it('sets and clamps servings', () => {
        const p = plate([entry()]);
        expect(setEntryServings(p, entryId(entry()), 0, T2).items[0].servings).toBe(MIN_SERVINGS);
        expect(setEntryServings(p, entryId(entry()), 2.5, T2).items[0].servings).toBe(2.5);
    });

    it('leaves other entries untouched', () => {
        const p = plate([entry(), entry({ item_key: 'rice', servings: 1 })]);
        const next = setEntryServings(p, entryId(entry()), 3, T2);
        expect(next.items[1].servings).toBe(1);
    });

    it('is a no-op for an unknown id but still restamps', () => {
        const next = setEntryServings(plate([entry()]), 'nope|X|Y', 3, T2);
        expect(next.items[0].servings).toBe(1);
        expect(next.updated_at).toBe(T2);
    });
});

describe('removeEntry', () => {
    it('removes the matching entry only', () => {
        const p = plate([entry(), entry({ item_key: 'rice' })]);
        const next = removeEntry(p, entryId(entry()), T2);
        expect(next.items.map(e => e.item_key)).toEqual(['rice']);
        expect(next.updated_at).toBe(T2);
    });
});

describe('clearPlateItems', () => {
    it('empties the plate but keeps it as a real, restamped plate', () => {
        const next = clearPlateItems(plate([entry()]), T2);
        expect(next.items).toEqual([]);
        expect(next.updated_at).toBe(T2);
        expect(next.date).toBe('2026-08-09');
        expect(next.meal).toBe('Dinner');
    });
});

describe('mergePlateMaps', () => {
    const local: PlateMap = { '2026-08-09|Dinner': plate([entry()], T2) };
    const remote: PlateMap = { '2026-08-09|Dinner': plate([], T1) };

    it('keeps the newer side when both have the plate', () => {
        const { merged } = mergePlateMaps(local, remote);
        expect(merged['2026-08-09|Dinner'].updated_at).toBe(T2);
    });

    it('uploads the local plate when local is newer', () => {
        const { toUpload } = mergePlateMaps(local, remote);
        expect(toUpload).toHaveLength(1);
        expect(toUpload[0].updated_at).toBe(T2);
    });

    it('keeps the remote plate and uploads nothing when remote is newer', () => {
        const { merged, toUpload } = mergePlateMaps(remote, local);
        expect(merged['2026-08-09|Dinner'].updated_at).toBe(T2);
        expect(toUpload).toEqual([]);
    });

    it('does not resurrect a cleared plate: an empty newer remote wins', () => {
        const stale: PlateMap = { '2026-08-09|Dinner': plate([entry()], T1) };
        const cleared: PlateMap = { '2026-08-09|Dinner': plate([], T2) };
        const { merged } = mergePlateMaps(stale, cleared);
        expect(merged['2026-08-09|Dinner'].items).toEqual([]);
    });

    it('carries over plates present on only one side', () => {
        const { merged, toUpload } = mergePlateMaps(
            { 'a|Lunch': plate([entry()], T1) },
            { 'b|Dinner': plate([entry()], T1) },
        );
        expect(Object.keys(merged).sort()).toEqual(['a|Lunch', 'b|Dinner']);
        expect(toUpload).toHaveLength(1);
    });

    it('handles both sides being empty', () => {
        expect(mergePlateMaps({}, {})).toEqual({ merged: {}, toUpload: [] });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Failed to resolve import "./plateOps"`.

- [ ] **Step 3: Implement the module**

Create `client/src/lib/plateOps.ts`:

```ts
import type { Plate, PlateEntry, PlateMap } from '../types';

export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 99;
export const SERVING_STEP = 0.5;

const EPOCH = new Date(0).toISOString();

export function plateKey(date: string, meal: string): string {
    return `${date}|${meal}`;
}

/** Identity within a plate: the same item at two halls is two entries. */
export function entryId(entry: Pick<PlateEntry, 'item_key' | 'hall' | 'station'>): string {
    return `${entry.item_key}|${entry.hall}|${entry.station}`;
}

/**
 * A plate that has never been stored. The epoch timestamp guarantees it loses
 * every merge, so an untouched plate can never overwrite a real remote one.
 */
export function emptyPlate(date: string, meal: string): Plate {
    return { date, meal, items: [], updated_at: EPOCH };
}

export function clampServings(n: number): number {
    if (Number.isNaN(n)) return MIN_SERVINGS;
    return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
}

export function addEntry(plate: Plate, entry: PlateEntry, now: string): Plate {
    const id = entryId(entry);
    const exists = plate.items.some((e) => entryId(e) === id);
    const items = exists
        ? plate.items.map((e) =>
            entryId(e) === id ? { ...e, servings: clampServings(e.servings + 1) } : e)
        : [...plate.items, { ...entry, servings: clampServings(entry.servings) }];
    return { ...plate, items, updated_at: now };
}

export function setEntryServings(
    plate: Plate, id: string, servings: number, now: string,
): Plate {
    const items = plate.items.map((e) =>
        entryId(e) === id ? { ...e, servings: clampServings(servings) } : e);
    return { ...plate, items, updated_at: now };
}

export function removeEntry(plate: Plate, id: string, now: string): Plate {
    return { ...plate, items: plate.items.filter((e) => entryId(e) !== id), updated_at: now };
}

/**
 * Clearing keeps the plate as an empty, restamped row rather than deleting it.
 * A deleted row would let another device's stale copy re-upload the plate.
 */
export function clearPlateItems(plate: Plate, now: string): Plate {
    return { ...plate, items: [], updated_at: now };
}

/**
 * Last-write-wins per plate. `updated_at` must already be normalized ISO
 * (`new Date(x).toISOString()`) on both sides so string comparison is
 * chronological.
 */
export function mergePlateMaps(
    local: PlateMap, remote: PlateMap,
): { merged: PlateMap; toUpload: Plate[] } {
    const merged: PlateMap = {};
    const toUpload: Plate[] = [];

    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        const l = local[key];
        const r = remote[key];

        if (l && r) {
            if (l.updated_at > r.updated_at) {
                merged[key] = l;
                toUpload.push(l);
            } else {
                merged[key] = r;
            }
        } else if (l) {
            merged[key] = l;
            toUpload.push(l);
        } else {
            merged[key] = r;
        }
    }

    return { merged, toUpload };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS. Note `clampServings(Infinity)` returns `MAX_SERVINGS` via `Math.min`, matching the test.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/plateOps.ts client/src/lib/plateOps.test.ts
git commit -m "feat: add pure plate operations and last-write-wins merge"
```

---

### Task 3: Extract Detroit-time meal inference

**Files:**
- Create: `client/src/lib/mealTime.ts`
- Test: `client/src/lib/mealTime.test.ts`
- Modify: `client/src/components/MenuFinder.tsx` (`handleOpenNow`, currently lines 238-263)

**Interfaces:**
- Produces: `inferDetroitNow(now?: Date): { date: string; meal: string }`.

`handleOpenNow` currently inlines this logic. The plate screen needs the same inference for its default selection, so it moves to a shared module. Behavior must not change.

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/mealTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inferDetroitNow } from './mealTime';

// Fixtures verified against America/Detroit.
describe('inferDetroitNow', () => {
    it('returns Breakfast before 10:30 on a weekday', () => {
        // 2026-08-10T14:00Z is Mon 10:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-10T14:00:00Z')))
            .toEqual({ date: '2026-08-10', meal: 'Breakfast' });
    });

    it('returns Lunch midday on a weekday', () => {
        // 2026-01-15T16:00Z is Thu 11:00 EST — also proves EST/EDT handling.
        expect(inferDetroitNow(new Date('2026-01-15T16:00:00Z')))
            .toEqual({ date: '2026-01-15', meal: 'Lunch' });
    });

    it('returns Dinner from 16:30 on a weekday', () => {
        // 2026-08-10T22:00Z is Mon 18:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-10T22:00:00Z')))
            .toEqual({ date: '2026-08-10', meal: 'Dinner' });
    });

    it('returns Lunch before 14:00 on a weekend', () => {
        // 2026-08-09T17:00Z is Sun 13:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-09T17:00:00Z')))
            .toEqual({ date: '2026-08-09', meal: 'Lunch' });
    });

    it('returns Dinner after 14:00 on a weekend', () => {
        // 2026-08-09T19:00Z is Sun 15:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-09T19:00:00Z')))
            .toEqual({ date: '2026-08-09', meal: 'Dinner' });
    });

    it('uses the Detroit date, not the UTC date', () => {
        // 2026-08-10T03:00Z is Sun 2026-08-09 23:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-10T03:00:00Z')).date).toBe('2026-08-09');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Failed to resolve import "./mealTime"`.

- [ ] **Step 3: Implement the module**

Create `client/src/lib/mealTime.ts`:

```ts
/**
 * Current dining date and meal in America/Detroit, regardless of the viewer's
 * own timezone. Extracted from MenuFinder's "What's Open Now" so the plate
 * screen and that button agree.
 */
export function inferDetroitNow(now: Date = new Date()): { date: string; meal: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Detroit',
        year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const isWeekend = get('weekday') === 'Sun' || get('weekday') === 'Sat';
    const time = parseInt(get('hour'), 10) + parseInt(get('minute'), 10) / 60;

    let meal: string;
    if (time < 10.5) {
        meal = 'Breakfast';
    } else if (time >= 16.5) {
        meal = 'Dinner';
    } else if (isWeekend) {
        meal = time < 14.0 ? 'Lunch' : 'Dinner';
    } else {
        meal = 'Lunch';
    }

    return { date, meal };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS, 6 new tests.

- [ ] **Step 5: Rewrite handleOpenNow to use it**

In `client/src/components/MenuFinder.tsx`, add to the imports:

```ts
import { inferDetroitNow } from '../lib/mealTime';
```

Then replace the whole `handleOpenNow` function body (the block computing `parts`, `get`, `dateStr`, `isWeekend`, `time`, and `meal`) with:

```ts
    const handleOpenNow = () => {
        const { date: dateStr, meal } = inferDetroitNow();

        setSelectedDate(uniqueDates.includes(dateStr) ? dateStr : (uniqueDates[0] || ''));
        setSelectedMeal(meal);
        setSearchTerm(''); setSelectedHalls([]); setSelectedTags([]);
        setShowFavorites(false); setView('browse');
    };
```

- [ ] **Step 6: Verify the build and lint pass**

Run: `cd client && npm run build && npm run lint`
Expected: both succeed with no unused-variable warnings from the removed code.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/mealTime.ts client/src/lib/mealTime.test.ts \
        client/src/components/MenuFinder.tsx
git commit -m "refactor: extract Detroit-time meal inference into lib/mealTime"
```

---

### Task 4: Plates table and RLS

**Files:**
- Create: `supabase/plates.sql`
- Modify: `docs/auth-setup.md`

**Interfaces:**
- Produces: table `public.plates` with columns `user_id uuid`, `date date`, `meal text`, `items jsonb`, `updated_at timestamptz`, primary key `(user_id, date, meal)`.

There is no automated test for SQL in this repo; verification is running it in the Supabase SQL Editor. Follow the `supabase/user_favorites.sql` pattern exactly — idempotent, `drop policy if exists` before each `create policy`.

- [ ] **Step 1: Write the migration**

Create `supabase/plates.sql`:

```sql
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
```

`updated_at` is always sent explicitly by the client, because the client compares timestamps to resolve conflicts before writing. The column default only applies to inserts that omit it.

- [ ] **Step 2: Document the migration**

In `docs/auth-setup.md`, under `## 1. Database table`, replace that section's body with:

```markdown
Run these in the Supabase SQL Editor (once each, in order):

1. `supabase/user_favorites.sql` — synced favorites.
2. `supabase/plates.sql` — synced macro plates.
```

Then append to the `## How it behaves` list:

```markdown
- **Plate** view: plates are stored per device in localStorage and, when
  signed in, synced to the `plates` table — one row per (date, meal), with
  the items as JSONB. Conflicts resolve last-write-wins per plate.
```

- [ ] **Step 3: Apply and verify against the real database**

Paste `supabase/plates.sql` into the Supabase SQL Editor and run it. Then run it a **second** time to confirm it is idempotent (no errors).

Verify RLS with the SQL Editor's user impersonation, or by confirming in the Dashboard that `plates` shows four policies: Read/Add/Update/Remove own plates.

Expected: table exists, RLS enabled, four policies present.

- [ ] **Step 4: Commit**

```bash
git add supabase/plates.sql docs/auth-setup.md
git commit -m "feat: add plates table with RLS policies"
```

---

### Task 5: usePlates hook — local only

**Files:**
- Create: `client/src/hooks/usePlates.ts`

**Interfaces:**
- Consumes: `plateKey`, `emptyPlate`, `addEntry`, `setEntryServings`, `removeEntry`, `clearPlateItems` from `../lib/plateOps` (Task 2); types from `../types` (Task 1).
- Produces:

```ts
usePlates(session: Session | null): {
    plates: PlateMap;
    getPlate(date: string, meal: string): Plate;
    addItem(date: string, meal: string, entry: PlateEntry): void;
    setServings(date: string, meal: string, id: string, servings: number): void;
    removeItem(date: string, meal: string, id: string): void;
    clearPlate(date: string, meal: string): void;
    syncError: boolean;
}
```

This task ships the local-only half. `session` is accepted now and unused (typed `Session | null`) so Task 6 adds sync without changing any call site. `syncError` is always `false` until Task 6.

Hook behavior is verified manually, not by unit tests — the logic worth testing is already covered in Tasks 1-2, and component tests would require jsdom (explicitly out of scope per the spec).

- [ ] **Step 1: Implement the hook**

Create `client/src/hooks/usePlates.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Plate, PlateEntry, PlateMap } from '../types';
import {
    addEntry, clearPlateItems, emptyPlate, plateKey, removeEntry, setEntryServings,
} from '../lib/plateOps';

const LS_KEY = 'umich-dining-plates';

function readLocal(): PlateMap {
    try {
        const saved = localStorage.getItem(LS_KEY);
        return saved ? (JSON.parse(saved) as PlateMap) : {};
    } catch {
        return {};
    }
}

/**
 * Plates keyed `${date}|${meal}`. Logged out: localStorage only. Logged in
 * (Task 6): synced to the `plates` table, last-write-wins per plate.
 */
export function usePlates(session: Session | null) {
    const [plates, setPlates] = useState<PlateMap>(readLocal);
    const [syncError] = useState(false);

    void session; // consumed in the sync layer

    useEffect(() => {
        localStorage.setItem(LS_KEY, JSON.stringify(plates));
    }, [plates]);

    const getPlate = useCallback(
        (date: string, meal: string): Plate =>
            plates[plateKey(date, meal)] ?? emptyPlate(date, meal),
        [plates],
    );

    // Untouched plates are never stored: emptyPlate() is returned on demand,
    // and only a real mutation writes a key into the map.
    const mutate = useCallback(
        (date: string, meal: string, fn: (plate: Plate, now: string) => Plate) => {
            const key = plateKey(date, meal);
            const now = new Date().toISOString();
            setPlates((prev) => ({
                ...prev,
                [key]: fn(prev[key] ?? emptyPlate(date, meal), now),
            }));
        },
        [],
    );

    const addItem = useCallback(
        (date: string, meal: string, entry: PlateEntry) =>
            mutate(date, meal, (p, now) => addEntry(p, entry, now)),
        [mutate],
    );

    const setServings = useCallback(
        (date: string, meal: string, id: string, servings: number) =>
            mutate(date, meal, (p, now) => setEntryServings(p, id, servings, now)),
        [mutate],
    );

    const removeItem = useCallback(
        (date: string, meal: string, id: string) =>
            mutate(date, meal, (p, now) => removeEntry(p, id, now)),
        [mutate],
    );

    const clearPlate = useCallback(
        (date: string, meal: string) =>
            mutate(date, meal, (p, now) => clearPlateItems(p, now)),
        [mutate],
    );

    return { plates, getPlate, addItem, setServings, removeItem, clearPlate, syncError };
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `cd client && npm run build && npm run lint`
Expected: both succeed. The hook is not yet referenced by any component, which is fine.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/usePlates.ts
git commit -m "feat: add usePlates hook with localStorage persistence"
```

---

### Task 6: usePlates sync layer

**Files:**
- Modify: `client/src/hooks/usePlates.ts`

**Interfaces:**
- Consumes: `mergePlateMaps` from `../lib/plateOps` (Task 2), `supabase` from `../lib/supabase` (existing).
- Produces: no signature change. `syncError` now becomes `true` on a failed read or write and `false` on the next success.

Read `client/src/hooks/useFavorites.ts` first — the `syncedUserId` ref pattern for "merge once per user" is reused here deliberately.

- [ ] **Step 1: Add the sync refs and state**

Replace the imports and the state declarations at the top of `usePlates` with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Plate, PlateEntry, PlateMap } from '../types';
import { supabase } from '../lib/supabase';
import {
    addEntry, clearPlateItems, emptyPlate, mergePlateMaps, plateKey,
    removeEntry, setEntryServings,
} from '../lib/plateOps';

const LS_KEY = 'umich-dining-plates';
const DEBOUNCE_MS = 800;
```

and inside the hook:

```ts
    const [plates, setPlates] = useState<PlateMap>(readLocal);
    const [syncError, setSyncError] = useState(false);

    const platesRef = useRef(plates);
    const dirtyKeys = useRef<Set<string>>(new Set());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const syncedUserId = useRef<string | null>(null);

    useEffect(() => {
        platesRef.current = plates;
        localStorage.setItem(LS_KEY, JSON.stringify(plates));
    }, [plates]);
```

Delete the `void session;` line and the old `const [syncError] = useState(false);`.

- [ ] **Step 2: Add the upload and flush helpers**

Insert after the `platesRef` effect, before `getPlate`:

```ts
    const upload = useCallback(async (userId: string, toUpload: Plate[]) => {
        if (!supabase || toUpload.length === 0) return true;
        const { error } = await supabase.from('plates').upsert(
            toUpload.map((p) => ({
                user_id: userId,
                date: p.date,
                meal: p.meal,
                items: p.items,
                updated_at: p.updated_at,
            })),
        );
        if (error) {
            console.error('Failed to sync plates:', error.message);
            return false;
        }
        return true;
    }, []);

    /** Write every dirty plate now. Dirty keys are restored on failure so the
     *  next mutation retries them. */
    const flush = useCallback(async () => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        const keys = [...dirtyKeys.current];
        dirtyKeys.current.clear();
        if (!supabase || !session || keys.length === 0) return;

        const toUpload = keys
            .map((k) => platesRef.current[k])
            .filter((p): p is Plate => p != null);

        const ok = await upload(session.user.id, toUpload);
        setSyncError(!ok);
        if (!ok) keys.forEach((k) => dirtyKeys.current.add(k));
    }, [session, upload]);
```

- [ ] **Step 3: Mark mutations dirty and debounce the write**

Replace the `mutate` callback with:

```ts
    const mutate = useCallback(
        (date: string, meal: string, fn: (plate: Plate, now: string) => Plate) => {
            const key = plateKey(date, meal);
            const now = new Date().toISOString();
            setPlates((prev) => ({
                ...prev,
                [key]: fn(prev[key] ?? emptyPlate(date, meal), now),
            }));

            if (!supabase || !session) return;
            dirtyKeys.current.add(key);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
        },
        [session, flush],
    );
```

- [ ] **Step 4: Flush when the tab is backgrounded or closed**

Add after `mutate`:

```ts
    // Mobile browsers background tabs aggressively; a pending debounce would
    // otherwise be lost.
    useEffect(() => {
        const onHide = () => {
            if (document.visibilityState === 'hidden') void flush();
        };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('beforeunload', () => { void flush(); });
        return () => {
            document.removeEventListener('visibilitychange', onHide);
        };
    }, [flush]);
```

- [ ] **Step 5: Merge on sign-in**

Add after the flush effect:

```ts
    useEffect(() => {
        if (!supabase || !session) {
            syncedUserId.current = null;
            return;
        }
        if (syncedUserId.current === session.user.id) return;
        syncedUserId.current = session.user.id;

        (async () => {
            const { data, error } = await supabase
                .from('plates')
                .select('date, meal, items, updated_at');

            if (error) {
                console.error('Failed to load plates:', error.message);
                setSyncError(true);
                return;
            }

            const remote: PlateMap = {};
            for (const row of data ?? []) {
                // Postgres returns "+00:00" offsets and a date that may be a
                // Date object; both must be normalized before comparison.
                const date = String(row.date).slice(0, 10);
                const meal = row.meal as string;
                remote[plateKey(date, meal)] = {
                    date,
                    meal,
                    items: (row.items ?? []) as PlateEntry[],
                    updated_at: new Date(row.updated_at as string).toISOString(),
                };
            }

            const { merged, toUpload } = mergePlateMaps(readLocal(), remote);
            setPlates(merged);
            const ok = await upload(session.user.id, toUpload);
            setSyncError(!ok);
        })();
    }, [session, upload]);
```

- [ ] **Step 6: Verify it type-checks, lints, and the unit tests still pass**

Run: `cd client && npm run build && npm run lint && npm test`
Expected: all three succeed.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/usePlates.ts
git commit -m "feat: sync plates to Supabase with last-write-wins merge"
```

---

### Task 7: PlateView component

**Files:**
- Create: `client/src/components/PlateView.tsx`

**Interfaces:**
- Consumes: `totalPlate`, `roundGrams`, `isIncomplete` from `../lib/nutrition` (Task 1); `entryId`, `SERVING_STEP`, `MIN_SERVINGS`, `clampServings` from `../lib/plateOps` (Task 2); types from `../types` (Task 1).
- Produces: default-exported `PlateView` with props:

```ts
interface Props {
    plate: Plate;
    date: string;
    meal: string;
    availableDates: string[];
    meals: string[];
    onSelect: (date: string, meal: string) => void;
    setServings: (id: string, servings: number) => void;
    removeItem: (id: string) => void;
    clearPlate: () => void;
    syncError: boolean;
    signedIn: boolean;
    authEnabled: boolean;
}
```

Note the callbacks are already bound to the selected date and meal by `MenuFinder` (Task 8), so this component never passes them.

Match the styling of `MyMenu.tsx`: `bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50`.

- [ ] **Step 1: Implement the component**

Create `client/src/components/PlateView.tsx`:

```tsx
import React, { useMemo } from 'react';
import type { Plate } from '../types';
import { isIncomplete, roundGrams, totalPlate } from '../lib/nutrition';
import { clampServings, entryId, MIN_SERVINGS, SERVING_STEP } from '../lib/plateOps';

interface Props {
    plate: Plate;
    date: string;
    meal: string;
    availableDates: string[];
    meals: string[];
    onSelect: (date: string, meal: string) => void;
    setServings: (id: string, servings: number) => void;
    removeItem: (id: string) => void;
    clearPlate: () => void;
    syncError: boolean;
    signedIn: boolean;
    authEnabled: boolean;
}

function formatShortDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const CARD = 'bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50';

const PlateView: React.FC<Props> = ({
    plate, date, meal, availableDates, meals, onSelect,
    setServings, removeItem, clearPlate, syncError, signedIn, authEnabled,
}) => {
    const totals = useMemo(() => totalPlate(plate.items), [plate.items]);

    const stats: Array<[string, string]> = [
        ['Calories', String(Math.round(totals.calories))],
        ['Protein', `${roundGrams(totals.protein_g)} g`],
        ['Carbs', `${roundGrams(totals.carbs_g)} g`],
        ['Fat', `${roundGrams(totals.fat_g)} g`],
        ['Sodium', `${Math.round(totals.sodium_mg)} mg`],
    ];

    return (
        <div className="space-y-4">
            {/* ── Plate selector ── */}
            <div className={`${CARD} p-4 flex flex-col sm:flex-row gap-3`}>
                <select
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 outline-none bg-gray-50 dark:bg-slate-700 dark:text-white"
                    value={date}
                    onChange={e => onSelect(e.target.value, meal)}
                >
                    {availableDates.map(d => (
                        <option key={d} value={d}>{formatShortDate(d)}</option>
                    ))}
                </select>
                <select
                    className="sm:w-40 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 outline-none bg-gray-50 dark:bg-slate-700 dark:text-white"
                    value={meal}
                    onChange={e => onSelect(date, e.target.value)}
                >
                    {meals.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>

            {authEnabled && !signedIn && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 text-center">
                    Plates are saved on this device only — sign in to sync across devices.
                </div>
            )}

            {syncError && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300 text-center">
                    Not saved to your account — changes are on this device.
                </div>
            )}

            {plate.items.length === 0 ? (
                <div className={`${CARD} p-16 text-center`}>
                    <p className="text-4xl mb-4">🍽️</p>
                    <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing on this plate</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                        Tap + on items in Browse to add them and see your totals here.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Totals ── */}
                    <div className={`${CARD} sticky top-14 z-30 px-4 py-3`}>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {stats.map(([label, value]) => (
                                <div key={label} className="text-center">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                        {label}
                                    </p>
                                    <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                                        {value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {totals.incompleteCount > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300 text-center">
                            {totals.incompleteCount} item{totals.incompleteCount !== 1 ? 's are' : ' is'} missing
                            some nutrition data — totals are a lower bound.
                        </div>
                    )}

                    {/* ── Items ── */}
                    <div className={`${CARD} overflow-hidden`}>
                        <ul className="divide-y divide-gray-100 dark:divide-slate-700/50">
                            {plate.items.map(item => {
                                const id = entryId(item);
                                const cals = item.nutrition.calories;
                                return (
                                    <li key={id} className="px-4 py-3 flex items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                                {item.name}
                                            </p>
                                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                                                {item.hall}{item.station ? ` · ${item.station}` : ''}
                                                {isIncomplete(item) && (
                                                    <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                                        partial data
                                                    </span>
                                                )}
                                            </p>
                                        </div>

                                        {/* Servings stepper */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => setServings(id, item.servings - SERVING_STEP)}
                                                disabled={item.servings <= MIN_SERVINGS}
                                                className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors leading-none"
                                                title="Fewer servings"
                                            >
                                                −
                                            </button>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                step={SERVING_STEP}
                                                min={MIN_SERVINGS}
                                                value={item.servings}
                                                onChange={e => {
                                                    const n = Number(e.target.value);
                                                    if (e.target.value === '' || Number.isNaN(n)) return;
                                                    setServings(id, clampServings(n));
                                                }}
                                                className="w-14 px-1 py-1 text-sm text-center tabular-nums border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-[#FFCB05]/60"
                                                aria-label={`Servings of ${item.name}`}
                                            />
                                            <button
                                                onClick={() => setServings(id, item.servings + SERVING_STEP)}
                                                className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors leading-none"
                                                title="More servings"
                                            >
                                                +
                                            </button>
                                        </div>

                                        <span className="w-20 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
                                            {cals != null ? `${Math.round(cals * item.servings)} kcal` : '—'}
                                        </span>

                                        <button
                                            onClick={() => removeItem(id)}
                                            className="text-gray-300 dark:text-slate-700 hover:text-red-500 dark:hover:text-red-400 transition-colors text-lg shrink-0 leading-none"
                                            title="Remove from plate"
                                        >
                                            ×
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="text-center">
                        <button
                            onClick={clearPlate}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 underline transition-colors"
                        >
                            Clear plate
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default PlateView;
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `cd client && npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/PlateView.tsx
git commit -m "feat: add PlateView totals screen with servings steppers"
```

---

### Task 8: Wire the plate into MenuFinder

**Files:**
- Modify: `client/src/components/MenuFinder.tsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `usePlates` (Tasks 5-6), `PlateView` (Task 7), `nutritionFromMenuItem` (Task 1), `plateKey`, `entryId` (Task 2), `inferDetroitNow` (Task 3).

This is the only task that touches the existing UI. After it, the feature is usable end to end.

- [ ] **Step 1: Add the imports**

In `client/src/components/MenuFinder.tsx`, alongside the existing imports:

```ts
import { usePlates } from '../hooks/usePlates';
import PlateView from './PlateView';
import { nutritionFromMenuItem } from '../lib/nutrition';
import { entryId, plateKey } from '../lib/plateOps';
```

- [ ] **Step 2: Widen the view union and add plate selection state**

Change:

```ts
    const [view, setView] = useState<'browse' | 'mymenu'>('browse');
```

to:

```ts
    const [view, setView] = useState<'browse' | 'mymenu' | 'plate'>('browse');
    const [plateDate, setPlateDate] = useState<string>('');
    const [plateMeal, setPlateMeal] = useState<string>('');
```

The selection lives here rather than in `PlateView` because the tab badge needs the same selection the plate screen is showing.

- [ ] **Step 3: Instantiate the hook**

Directly below the existing `useFavorites` line:

```ts
    const { plates, getPlate, addItem, setServings, removeItem, clearPlate, syncError } = usePlates(session);
```

- [ ] **Step 4: Default the selection to the newest non-empty plate**

Add after the hook line:

```ts
    // Default the plate selection once: the most recently modified non-empty
    // plate, else today + the current Detroit meal.
    useEffect(() => {
        if (plateDate && plateMeal) return;
        const newest = Object.values(plates)
            .filter(p => p.items.length > 0)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (newest) {
            setPlateDate(newest.date);
            setPlateMeal(newest.meal);
        } else {
            const now = inferDetroitNow();
            setPlateDate(now.date);
            setPlateMeal(now.meal);
        }
    }, [plates, plateDate, plateMeal]);
```

`inferDetroitNow` is already imported by Task 3.

- [ ] **Step 5: Derive the selected plate and the date options**

Add after `activeFilterCount`:

```ts
    const selectedPlate = useMemo(
        () => getPlate(plateDate, plateMeal),
        [getPlate, plateDate, plateMeal],
    );

    // Dates the user can build a plate for: whatever the menus cover, plus the
    // dates of any plate they already have (so old plates stay reachable).
    const plateDates = useMemo(() => {
        const set = new Set<string>(uniqueDates);
        Object.values(plates).forEach(p => set.add(p.date));
        if (plateDate) set.add(plateDate);
        return [...set].sort();
    }, [uniqueDates, plates, plateDate]);
```

- [ ] **Step 6: Add the add-to-plate handler**

Add next to `addToCalendar`:

```ts
    const addToPlate = (item: MenuItem) => {
        addItem(item.date, item.meal, {
            item_key: item.item_key,
            name: item.item_display,
            hall: item.hall,
            station: item.station ?? '',
            servings: 1,
            nutrition: nutritionFromMenuItem(item),
        });
        setPlateDate(item.date);
        setPlateMeal(item.meal);
    };
```

Selecting the plate the user just added to means switching to the Plate tab always lands on what they built.

- [ ] **Step 7: Add the third tab**

Replace the tab block's array and label expression:

```tsx
                        {(['browse', 'mymenu', 'plate'] as const).map(v => (
```

and the label:

```tsx
                                {v === 'browse'
                                    ? '🍽️ Browse'
                                    : v === 'mymenu'
                                        ? `★ My Menu${favorites.length > 0 ? ` (${favorites.length})` : ''}`
                                        : `🧮 Plate${selectedPlate.items.length > 0 ? ` (${selectedPlate.items.length})` : ''}`}
```

- [ ] **Step 8: Render PlateView**

Change the view switch from `view === 'mymenu' ? (...) : (...)` to a three-way. Replace:

```tsx
                {view === 'mymenu' ? (
                    <MyMenu
                        items={items}
                        favorites={favorites}
                        toggleFavorite={toggleFavorite}
                        addToCalendar={addToCalendar}
                        signedIn={session !== null}
                        authEnabled={authEnabled}
                    />
                ) : (
```

with:

```tsx
                {view === 'plate' ? (
                    <PlateView
                        plate={selectedPlate}
                        date={plateDate}
                        meal={plateMeal}
                        availableDates={plateDates}
                        meals={MEALS}
                        onSelect={(d, m) => { setPlateDate(d); setPlateMeal(m); }}
                        setServings={(id, n) => setServings(plateDate, plateMeal, id, n)}
                        removeItem={(id) => removeItem(plateDate, plateMeal, id)}
                        clearPlate={() => clearPlate(plateDate, plateMeal)}
                        syncError={syncError}
                        signedIn={session !== null}
                        authEnabled={authEnabled}
                    />
                ) : view === 'mymenu' ? (
                    <MyMenu
                        items={items}
                        favorites={favorites}
                        toggleFavorite={toggleFavorite}
                        addToCalendar={addToCalendar}
                        signedIn={session !== null}
                        authEnabled={authEnabled}
                    />
                ) : (
```

The `MyMenu` props are unchanged — only the surrounding conditional moves.

- [ ] **Step 9: Add the per-row add button**

In the item row, immediately after the calendar button, insert:

```tsx
                                                                        {(() => {
                                                                            const rowId = entryId({
                                                                                item_key: item.item_key,
                                                                                hall: item.hall,
                                                                                station: item.station ?? '',
                                                                            });
                                                                            const onPlate = getPlate(item.date, item.meal)
                                                                                .items.find(e => entryId(e) === rowId);
                                                                            return (
                                                                                <button
                                                                                    onClick={() => addToPlate(item)}
                                                                                    className={`w-6 h-6 rounded-lg text-xs font-bold shrink-0 transition-colors tabular-nums ${
                                                                                        onPlate
                                                                                            ? 'bg-[#00274C] text-white dark:bg-[#003870]'
                                                                                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400 dark:hover:bg-slate-600'
                                                                                    }`}
                                                                                    title={onPlate ? `${onPlate.servings} on your plate — tap to add another` : 'Add to plate'}
                                                                                >
                                                                                    {onPlate ? onPlate.servings : '+'}
                                                                                </button>
                                                                            );
                                                                        })()}
```

- [ ] **Step 10: Verify build, lint, and tests**

Run: `cd client && npm run build && npm run lint && npm test`
Expected: all succeed.

- [ ] **Step 11: Verify in the running app**

Run the dev server per `docs/development.md` (`npm run dev` at the repo root for the API, `cd client && npm run dev` for the client).

Check each of these:
1. Tapping `+` on a Browse row turns the button into `1`; tapping again shows `2`.
2. The Plate tab badge matches, and the Plate screen lists the items with correct totals.
3. The stepper's `−` is disabled at 0.5; typing `3` in the number field updates totals.
4. An item with no nutrition data shows "partial data" and the lower-bound banner appears.
5. Reloading the page preserves the plate.
6. Switching the date/meal selects to an untouched combination shows the empty state.

- [ ] **Step 12: Update the changelog**

Under `## [Unreleased]` in `CHANGELOG.md`, add:

```markdown
### Added

- **Plate** view: add menu items to a per-meal plate, adjust servings in 0.5 steps, and see summed calories, protein, carbs, fat, and sodium. Items missing nutrition data are flagged and the totals are labelled a lower bound. Plates are saved on the device and sync to your account when signed in (run `supabase/plates.sql` — see `docs/auth-setup.md`).
```

- [ ] **Step 13: Commit**

```bash
git add client/src/components/MenuFinder.tsx CHANGELOG.md
git commit -m "feat: add plate view with cart-style item selection and macro totals"
```

---

### Task 9: Verify sync across devices

**Files:** none — this is manual verification of Task 6's behavior, which unit tests cannot cover.

Requires `supabase/plates.sql` applied (Task 4) and a build with `VITE_SUPABASE_*` set.

- [ ] **Step 1: Verify a plate syncs to a second profile**

Open the app in two browser profiles signed into the same Google account. In profile A, add two items to a plate. Wait ~2 seconds, then reload profile B.

Expected: profile B shows the same plate with the same servings.

- [ ] **Step 2: Verify removal does not resurrect**

In profile B, remove one item. Wait ~2 seconds, then reload profile A.

Expected: profile A shows one item. Reload A a second time — still one item. This is the bug the JSONB shape exists to prevent; if the item comes back, the merge or the write is wrong.

- [ ] **Step 3: Verify clearing does not resurrect**

In profile A, click "Clear plate". Wait ~2 seconds, then reload profile B.

Expected: B shows the empty state. Confirm in the Supabase dashboard that the row still exists with `items: []` rather than having been deleted.

- [ ] **Step 4: Verify the debounce flush on backgrounding**

In profile A, tap `+` several times quickly, then immediately switch browser tabs (within the 800 ms debounce window). Reload profile B.

Expected: the final serving count is present — the `visibilitychange` flush caught it.

- [ ] **Step 5: Verify the signed-out and auth-disabled paths**

Sign out. Add items to a plate, reload.
Expected: the plate persists locally, and the "saved on this device only" notice shows.

Then run the client with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` unset.
Expected: no sign-in button, no sync notices, and the plate feature works fully against localStorage.

- [ ] **Step 6: Verify the sync-error notice**

With DevTools open in profile A, block requests to the Supabase host (Network → request blocking), then change a serving count.

Expected: within ~1 second the amber "Not saved to your account" notice appears; unblocking and changing a serving again clears it.

---

## Notes for the implementer

- `useFavorites.ts` has a known delete-resurrection bug (its merge is union-only). Do **not** copy that merge into plates — `mergePlateMaps` is deliberately different. Fixing favorites is out of scope for this plan.
- Timestamps are client-generated on purpose: the client compares them before writing, which a server-side `now()` cannot support. A device with a badly wrong clock can win a conflict it should lose. This is accepted, documented in the spec, and not a bug to "fix" mid-implementation.
- Menu nutrition is snapshotted into the plate at add time. Do not re-read nutrition from `items` when rendering the plate — a plate for a past date has no menu row to read from.
