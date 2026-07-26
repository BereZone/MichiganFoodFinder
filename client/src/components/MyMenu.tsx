import React, { useMemo } from 'react';
import type { MenuItem } from '../types';

const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'];

interface Props {
    items: MenuItem[];
    favorites: string[];
    toggleFavorite: (itemKey: string) => void;
    addToCalendar: (item: MenuItem) => void;
    signedIn: boolean;
    authEnabled: boolean;
}

function localToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const MyMenu: React.FC<Props> = ({ items, favorites, toggleFavorite, addToCalendar, signedIn, authEnabled }) => {
    const today = localToday();
    const favSet = useMemo(() => new Set(favorites), [favorites]);

    const byDate = useMemo(() => {
        const upcoming = items.filter(i => favSet.has(i.item_key) && i.date >= today);
        upcoming.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            const m = MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal);
            if (m !== 0) return m;
            if (a.hall !== b.hall) return a.hall.localeCompare(b.hall);
            return a.item_display.localeCompare(b.item_display);
        });
        const groups = new Map<string, MenuItem[]>();
        for (const it of upcoming) {
            if (!groups.has(it.date)) groups.set(it.date, []);
            groups.get(it.date)!.push(it);
        }
        return groups;
    }, [items, favSet, today]);

    const notServed = useMemo(() => {
        const seen = new Set(items.filter(i => favSet.has(i.item_key) && i.date >= today).map(i => i.item_key));
        const nameByKey = new Map(items.map(i => [i.item_key, i.item_display]));
        return favorites.filter(k => !seen.has(k)).map(k => ({ key: k, name: nameByKey.get(k) ?? k }));
    }, [items, favorites, favSet, today]);

    if (favorites.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 p-16 text-center">
                <p className="text-4xl mb-4">☆</p>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">No favorites yet</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                    Star items in Browse and they'll appear here whenever they're on an upcoming menu.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {authEnabled && !signedIn && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 text-center">
                    Favorites are saved on this device only — sign in to sync across devices.
                </div>
            )}

            {byDate.size === 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 p-12 text-center text-gray-400 dark:text-gray-500">
                    None of your favorites are on the menu in the next two weeks.
                </div>
            )}

            {[...byDate.entries()].map(([date, dayItems]) => (
                <div key={date} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700/50 flex items-center gap-2.5">
                        <h2 className="font-bold text-gray-900 dark:text-white text-sm">{prettyDate(date)}</h2>
                        {date === today && (
                            <span className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                                Today
                            </span>
                        )}
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-slate-700/50">
                        {dayItems.map((item, idx) => (
                            <li
                                key={`${item.item_key}-${item.meal}-${item.hall}-${item.station}-${idx}`}
                                className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                            >
                                <button
                                    onClick={() => toggleFavorite(item.item_key)}
                                    className="text-yellow-400 hover:scale-110 transition-transform text-xl shrink-0"
                                    title="Remove from favorites"
                                >
                                    ★
                                </button>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{item.item_display}</p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                                        {item.hall} · {item.meal}{item.station ? ` · ${item.station}` : ''}
                                    </p>
                                </div>
                                {item.nutrition?.calories != null && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">
                                        {item.nutrition.calories} kcal
                                    </span>
                                )}
                                <button
                                    onClick={() => addToCalendar(item)}
                                    className="text-gray-300 dark:text-slate-700 hover:text-blue-500 dark:hover:text-blue-400 transition-colors text-base shrink-0"
                                    title="Add to Google Calendar"
                                >
                                    📅
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {notServed.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 p-5">
                    <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                        Not on any upcoming menu
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                        {notServed.map(({ key, name }) => (
                            <li key={key} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-slate-700 text-sm text-gray-600 dark:text-gray-300">
                                {name}
                                <button
                                    onClick={() => toggleFavorite(key)}
                                    className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors leading-none"
                                    title="Remove from favorites"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default MyMenu;
