import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Plate, PlateEntry, PlateMap } from '../types';
import { supabase } from '../lib/supabase';
import {
    addEntry, clearPlateItems, decrementOrRemove, emptyPlate, mergePlateMaps,
    plateKey, removeEntry, setEntryServings,
} from '../lib/plateOps';

const LS_KEY = 'umich-dining-plates';
const DEBOUNCE_MS = 800;

function readLocal(): PlateMap {
    try {
        const saved = localStorage.getItem(LS_KEY);
        return saved ? (JSON.parse(saved) as PlateMap) : {};
    } catch {
        return {};
    }
}

/**
 * Plates keyed `${date}|${meal}`. Logged out: localStorage only. Logged in:
 * synced to the `plates` table, last-write-wins per plate.
 */
export function usePlates(session: Session | null) {
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

            if (!supabase || !session) return;
            dirtyKeys.current.add(key);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
        },
        [session, flush],
    );

    // Mobile browsers background tabs aggressively; a pending debounce would
    // otherwise be lost.
    useEffect(() => {
        const onHide = () => {
            if (document.visibilityState === 'hidden') void flush();
        };
        const onUnload = () => { void flush(); };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('beforeunload', onUnload);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('beforeunload', onUnload);
        };
    }, [flush]);

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

    /** Step down one serving, removing the entry when it is already at the
     *  minimum. Used by the Browse rows, which have no separate remove button. */
    const decrementItem = useCallback(
        (date: string, meal: string, id: string) =>
            mutate(date, meal, (p, now) => decrementOrRemove(p, id, now)),
        [mutate],
    );

    const clearPlate = useCallback(
        (date: string, meal: string) =>
            mutate(date, meal, (p, now) => clearPlateItems(p, now)),
        [mutate],
    );

    return {
        plates, getPlate, addItem, setServings, removeItem, decrementItem,
        clearPlate, syncError,
    };
}
