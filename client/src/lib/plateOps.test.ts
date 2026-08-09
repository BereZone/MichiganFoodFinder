import { describe, it, expect } from 'vitest';
import {
    MIN_SERVINGS, MAX_SERVINGS, plateKey, entryId, emptyPlate, clampServings,
    addEntry, setEntryServings, removeEntry, clearPlateItems, mergePlateMaps,
    decrementOrRemove,
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
    it('rounds away binary floating-point drift', () => {
        // 2.3 - 0.5 is 1.7999999999999998 in IEEE 754.
        expect(clampServings(2.3 - 0.5)).toBe(1.8);
    });
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

describe('decrementOrRemove', () => {
    it('steps down by half a serving', () => {
        const next = decrementOrRemove(plate([entry({ servings: 2 })]), entryId(entry()), T2);
        expect(next.items[0].servings).toBe(1.5);
        expect(next.updated_at).toBe(T2);
    });

    it('steps from 1 down to the minimum rather than removing', () => {
        const next = decrementOrRemove(plate([entry({ servings: 1 })]), entryId(entry()), T2);
        expect(next.items).toHaveLength(1);
        expect(next.items[0].servings).toBe(MIN_SERVINGS);
    });

    it('removes the entry when it is already at the minimum', () => {
        const next = decrementOrRemove(plate([entry({ servings: MIN_SERVINGS })]), entryId(entry()), T2);
        expect(next.items).toEqual([]);
        expect(next.updated_at).toBe(T2);
    });

    it('leaves other entries alone when removing', () => {
        const p = plate([entry({ servings: MIN_SERVINGS }), entry({ item_key: 'rice', servings: 2 })]);
        const next = decrementOrRemove(p, entryId(entry()), T2);
        expect(next.items.map(e => e.item_key)).toEqual(['rice']);
    });

    it('is a no-op for an unknown id but still restamps', () => {
        const next = decrementOrRemove(plate([entry()]), 'nope|X|Y', T2);
        expect(next.items).toHaveLength(1);
        expect(next.updated_at).toBe(T2);
    });

    it('does not mutate the input plate', () => {
        const original = plate([entry({ servings: MIN_SERVINGS })]);
        decrementOrRemove(original, entryId(entry()), T2);
        expect(original.items).toHaveLength(1);
        expect(original.updated_at).toBe(T1);
    });

    it('keeps servings clean across repeated steps from a typed value', () => {
        let p = plate([entry({ servings: 2.3 })]);
        p = decrementOrRemove(p, entryId(entry()), T2);
        expect(p.items[0].servings).toBe(1.8);
        p = decrementOrRemove(p, entryId(entry()), T2);
        expect(p.items[0].servings).toBe(1.3);
    });
});
