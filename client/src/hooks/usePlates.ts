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
