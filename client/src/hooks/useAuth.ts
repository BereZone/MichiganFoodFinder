import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function useAuth() {
    const [session, setSession] = useState<Session | null>(null);

    useEffect(() => {
        if (!supabase) return;
        supabase.auth.getSession().then(({ data }) => setSession(data.session));
        const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
        return () => sub.subscription.unsubscribe();
    }, []);

    const signIn = () => {
        supabase?.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin },
        });
    };

    const signOut = () => {
        supabase?.auth.signOut();
    };

    // enabled=false when Supabase env vars are absent: auth UI is hidden and
    // the app behaves exactly as it did pre-auth.
    return { session, signIn, signOut, enabled: supabase !== null };
}
