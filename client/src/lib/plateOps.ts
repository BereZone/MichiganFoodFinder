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
    const clamped = Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
    // Stepping by 0.5 from a typed value like 2.3 yields 1.7999999999999998 in
    // IEEE 754. Every mutation routes through here, so rounding once keeps
    // stored and displayed servings clean.
    return Math.round(clamped * 100) / 100;
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
 * One step down. At the minimum there is nowhere lower to go, so the entry is
 * removed instead — this is the whole plate control in a Browse row, which has
 * no separate remove button, so it must never dead-end.
 */
export function decrementOrRemove(plate: Plate, id: string, now: string): Plate {
    const entry = plate.items.find((e) => entryId(e) === id);
    if (!entry) return { ...plate, updated_at: now };
    if (entry.servings <= MIN_SERVINGS) return removeEntry(plate, id, now);
    return setEntryServings(plate, id, entry.servings - SERVING_STEP, now);
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
