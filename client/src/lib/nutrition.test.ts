import { describe, it, expect } from 'vitest';
import {
    parseAmount, nutritionFromMenuItem, scaleNutrition,
    isIncomplete, totalPlate, roundGrams, parseServingGrams, describeServing,
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

describe('parseServingGrams', () => {
    it('pulls grams out of the parenthesised suffix', () => {
        expect(parseServingGrams('1/2 Cup (113g)')).toBe(113);
        expect(parseServingGrams('8 oz Cup (227g)')).toBe(227);
        expect(parseServingGrams('Ounce (28g)')).toBe(28);
    });
    it('tolerates a space before the unit', () => {
        expect(parseServingGrams('Slice (105 g)')).toBe(105);
    });
    it('returns null when the serving has no gram figure', () => {
        expect(parseServingGrams('Each')).toBeNull();
        expect(parseServingGrams('')).toBeNull();
        expect(parseServingGrams(null)).toBeNull();
    });
    it('survives the typos the site publishes', () => {
        expect(parseServingGrams('1 oz Seving (28g)')).toBe(28);
    });
});

describe('describeServing', () => {
    it('is null when the item has no published serving size', () => {
        expect(describeServing(null, 2)).toBeNull();
        expect(describeServing('', 2)).toBeNull();
    });

    it('shows only the label at exactly one serving', () => {
        expect(describeServing('1/2 Cup (113g)', 1))
            .toEqual({ label: '1/2 Cup (113g)', scaled: null });
    });

    it('scales the grams for other serving counts', () => {
        expect(describeServing('1/2 Cup (113g)', 2))
            .toEqual({ label: '1/2 Cup (113g)', scaled: '226 g' });
        expect(describeServing('1/2 Cup (113g)', 0.5))
            .toEqual({ label: '1/2 Cup (113g)', scaled: '57 g' });
    });

    it('rounds scaled grams to whole numbers', () => {
        expect(describeServing('1/2 Cup (113g)', 2.5))
            .toEqual({ label: '1/2 Cup (113g)', scaled: '283 g' });
    });

    it('falls back to a plain multiplier when grams are unavailable', () => {
        expect(describeServing('Each', 2)).toEqual({ label: 'Each', scaled: '2×' });
    });
});
