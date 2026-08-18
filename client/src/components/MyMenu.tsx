import React, { useMemo } from 'react';
import type { MenuItem } from '../types';
import { MEAL_CHIP } from '../lib/boardVoice';
import { StarIcon, CalendarIcon, CloseIcon, TrayIcon, AlertIcon } from './Icon';

const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'];

interface Props {
    items: MenuItem[];
    favorites: string[];
    toggleFavorite: (itemKey: string) => void;
    addToCalendar: (item: MenuItem) => void;
    signedIn: boolean;
    authEnabled: boolean;
}

const PANEL = 'bg-surface border border-line rounded-xl shadow-panel';

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
            <div className={`${PANEL} px-6 py-16 text-center`}>
                <StarIcon size={40} className="mx-auto text-fg-3" />
                <p className="mt-4 text-lg font-extrabold">Nothing starred yet</p>
                <p className="mt-1.5 text-sm text-fg-3 max-w-[38ch] mx-auto leading-relaxed">
                    Star anything while browsing and this becomes a standing watch list. It shows
                    every upcoming day your picks turn up, soonest first.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {authEnabled && !signedIn && (
                <div className="flex items-start gap-2.5 border border-line bg-navy-wash text-fg-2 rounded-xl px-4 py-3 text-sm">
                    <AlertIcon size={16} className="shrink-0 mt-px text-navy-ink" />
                    <span>Stars live in this browser only. Sign in and they follow you to your phone.</span>
                </div>
            )}

            {byDate.size === 0 && (
                <div className={`${PANEL} px-6 py-14 text-center`}>
                    <TrayIcon size={36} className="mx-auto text-fg-3" />
                    <p className="mt-4 text-base font-extrabold">Not in the next two weeks</p>
                    <p className="mt-1.5 text-sm text-fg-3 max-w-[36ch] mx-auto leading-relaxed">
                        None of your stars are on an upcoming menu. They are still saved.
                    </p>
                </div>
            )}

            {[...byDate.entries()].map(([date, dayItems]) => (
                <section key={date}>
                    <div className="flex items-center gap-2.5 mb-3">
                        <h2 className="text-base sm:text-lg font-extrabold tracking-tight">{prettyDate(date)}</h2>
                        {date === today && (
                            <span className="label px-2 py-1 rounded-md bg-maize text-[#0f172a]">Today</span>
                        )}
                    </div>

                    <div className={`${PANEL} overflow-hidden`}>
                        <ul className="divide-y divide-line">
                            {dayItems.map((item, idx) => (
                                <li
                                    key={`${item.item_key}-${item.meal}-${item.hall}-${item.station}-${idx}`}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
                                >
                                    <button
                                        onClick={() => toggleFavorite(item.item_key)}
                                        className="text-maize-ink hover:text-danger transition-colors shrink-0"
                                        aria-label={`Unstar ${item.item_display}`}
                                        title="Unstar"
                                    >
                                        <StarIcon size={17} filled />
                                    </button>

                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{item.item_display}</p>
                                        <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-3 min-w-0">
                                            <span className={`label shrink-0 px-1.5 py-0.5 rounded ${MEAL_CHIP[item.meal] ?? 'bg-surface-2 text-fg-2'}`}>
                                                {item.meal}
                                            </span>
                                            <span className="truncate">
                                                {item.hall}{item.station ? ` · ${item.station}` : ''}
                                            </span>
                                        </p>
                                    </div>

                                    {item.nutrition?.calories != null && (
                                        <span className="text-[0.8125rem] font-semibold text-fg-2 tnum whitespace-nowrap shrink-0">
                                            {item.nutrition.calories}
                                            <span className="text-fg-3 font-medium text-[0.6875rem] ml-0.5">kcal</span>
                                        </span>
                                    )}

                                    <button
                                        onClick={() => addToCalendar(item)}
                                        className="text-fg-3 hover:text-navy-ink transition-colors shrink-0 p-1 rounded-md hover:bg-surface-3"
                                        aria-label={`Add ${item.item_display} to Google Calendar`}
                                        title="Add to Google Calendar"
                                    >
                                        <CalendarIcon size={16} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            ))}

            {notServed.length > 0 && (
                <section className={`${PANEL} p-4`}>
                    <h3 className="label text-fg-2 mb-3">Starred, but not on any upcoming menu</h3>
                    <ul className="flex flex-wrap gap-1.5">
                        {notServed.map(({ key, name }) => (
                            <li
                                key={key}
                                className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg border border-line bg-surface-2 text-xs font-medium text-fg-2"
                            >
                                {name}
                                <button
                                    onClick={() => toggleFavorite(key)}
                                    className="text-fg-3 hover:text-danger transition-colors"
                                    aria-label={`Unstar ${name}`}
                                    title="Unstar"
                                >
                                    <CloseIcon size={13} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
};

export default MyMenu;
