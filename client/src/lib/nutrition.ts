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
