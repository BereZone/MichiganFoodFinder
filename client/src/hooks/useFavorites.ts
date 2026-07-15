import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const LS_KEY = 'umich-dining-favorites';

function readLocal(): string[] {
    try {
        const saved = localStorage.getItem(LS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

/**
 * Favorites as item_key strings. Logged out: localStorage only (pre-auth
 * behavior). Logged in: the account is the source of truth; local favorites
 * are merged into it on first login so nothing is lost.
 */
export function useFavorites(session: Session | null) {
    const [favorites, setFavorites] = useState<string[]>(readLocal);
    const syncedUserId = useRef<string | null>(null);

    // localStorage always mirrors current state, so logging out (or an
    // offline session) keeps whatever the user last saw.
    useEffect(() => {
        localStorage.setItem(LS_KEY, JSON.stringify(favorites));
    }, [favorites]);

    useEffect(() => {
        if (!supabase || !session) {
            syncedUserId.current = null;
            return;
        }
        if (syncedUserId.current === session.user.id) return;
        syncedUserId.current = session.user.id;

        (async () => {
            const { data, error } = await supabase.from('user_favorites').select('item_key');
            if (error) {
                console.error('Failed to load favorites:', error.message);
                return;
            }
            const remote = new Set((data ?? []).map((r) => r.item_key as string));
            const localOnly = readLocal().filter((k) => !remote.has(k));
            if (localOnly.length > 0) {
                const { error: upErr } = await supabase.from('user_favorites').upsert(
                    localOnly.map((item_key) => ({ user_id: session.user.id, item_key })),
                );
                if (upErr) console.error('Failed to merge local favorites:', upErr.message);
            }
            setFavorites([...new Set([...remote, ...localOnly])]);
        })();
    }, [session]);

    const toggleFavorite = useCallback((itemKey: string) => {
        const has = favorites.includes(itemKey);
        setFavorites(has ? favorites.filter((k) => k !== itemKey) : [...favorites, itemKey]);
        if (supabase && session) {
            const op = has
                ? supabase.from('user_favorites').delete()
                    .eq('user_id', session.user.id).eq('item_key', itemKey)
                : supabase.from('user_favorites')
                    .upsert({ user_id: session.user.id, item_key: itemKey });
            op.then(({ error }) => {
                if (error) console.error('Failed to sync favorite:', error.message);
            });
        }
    }, [favorites, session]);

    return { favorites, toggleFavorite };
}
