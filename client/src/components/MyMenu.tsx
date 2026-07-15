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

    // Upcoming appearances of favorited items, grouped by date
    const byDate = useMemo(() => {
        const upcoming = items.filter((i) => favSet.has(i.item_key) && i.date >= today);
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

    // Favorites that never appear in the loaded window
    const notServed = useMemo(() => {
        const seen = new Set(items.filter((i) => favSet.has(i.item_key) && i.date >= today).map((i) => i.item_key));
        const nameByKey = new Map(items.map((i) => [i.item_key, i.item_display]));
        return favorites.filter((k) => !seen.has(k)).map((k) => ({ key: k, name: nameByKey.get(k) ?? k }));
    }, [items, favorites, favSet, today]);

    if (favorites.length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-12 text-center text-gray-500 dark:text-gray-400">
                <p className="text-4xl mb-4">☆</p>
                <p className="font-medium mb-1">No favorites yet</p>
                <p className="text-sm">Star items in the Browse tab and they'll show up here whenever they're on an upcoming menu.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {authEnabled && !signedIn && (
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 text-center">
                    Your favorites are saved on this device only — sign in to keep them across devices.
                </div>
            )}

            {byDate.size === 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-12 text-center text-gray-500 dark:text-gray-400">
                    None of your favorites are on the menu in the next two weeks.
                </div>
            )}

            {[...byDate.entries()].map(([date, dayItems]) => (
                <div key={date} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
                    <div className="px-6 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                        <h2 className="font-bold text-gray-800 dark:text-gray-100">
                            {prettyDate(date)}
                            {date === today && <span className="ml-2 text-xs font-semibold text-green-700 dark:text-green-400 uppercase">Today</span>}
                        </h2>
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {dayItems.map((item, idx) => (
                            <li key={`${item.item_key}-${item.meal}-${item.hall}-${item.station}-${idx}`} className="px-6 py-3 flex items-center gap-3">
                                <button
                                    onClick={() => toggleFavorite(item.item_key)}
                                    className="text-xl text-yellow-500 hover:scale-110 transition-transform"
                                    title="Remove from favorites"
                                >
                                    ★
                                </button>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 dark:text-white truncate">{item.item_display}</p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                        {item.hall} · {item.meal}{item.station ? ` · ${item.station}` : ''}
                                    </p>
                                </div>
                                {item.nutrition?.calories !== null && item.nutrition?.calories !== undefined && (
                                    <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{item.nutrition.calories} kcal</span>
                                )}
                                <button
                                    onClick={() => addToCalendar(item)}
                                    className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
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
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                        Not on any upcoming menu
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                        {notServed.map(({ key, name }) => (
                            <li key={key} className="flex items-center gap-1 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300">
                                {name}
                                <button
                                    onClick={() => toggleFavorite(key)}
                                    className="ml-1 text-gray-400 hover:text-red-500"
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
