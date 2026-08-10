import React, { useMemo } from 'react';
import type { Plate } from '../types';
import { describeServing, isIncomplete, roundGrams, totalPlate } from '../lib/nutrition';
import { clampServings, entryId, MIN_SERVINGS, SERVING_STEP } from '../lib/plateOps';

interface Props {
    plate: Plate;
    date: string;
    meal: string;
    availableDates: string[];
    meals: string[];
    onSelect: (date: string, meal: string) => void;
    setServings: (id: string, servings: number) => void;
    removeItem: (id: string) => void;
    clearPlate: () => void;
    syncError: boolean;
    signedIn: boolean;
    authEnabled: boolean;
}

function formatShortDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const CARD = 'bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50';

const PlateView: React.FC<Props> = ({
    plate, date, meal, availableDates, meals, onSelect,
    setServings, removeItem, clearPlate, syncError, signedIn, authEnabled,
}) => {
    const totals = useMemo(() => totalPlate(plate.items), [plate.items]);

    const stats: Array<[string, string]> = [
        ['Calories', String(Math.round(totals.calories))],
        ['Protein', `${roundGrams(totals.protein_g)} g`],
        ['Carbs', `${roundGrams(totals.carbs_g)} g`],
        ['Fat', `${roundGrams(totals.fat_g)} g`],
        ['Sodium', `${Math.round(totals.sodium_mg)} mg`],
    ];

    return (
        <div className="space-y-4">
            {/* ── Plate selector ── */}
            <div className={`${CARD} p-4 flex flex-col sm:flex-row gap-3`}>
                <select
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 outline-none bg-gray-50 dark:bg-slate-700 dark:text-white"
                    value={date}
                    onChange={e => onSelect(e.target.value, meal)}
                >
                    {availableDates.map(d => (
                        <option key={d} value={d}>{formatShortDate(d)}</option>
                    ))}
                </select>
                <select
                    className="sm:w-40 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 outline-none bg-gray-50 dark:bg-slate-700 dark:text-white"
                    value={meal}
                    onChange={e => onSelect(date, e.target.value)}
                >
                    {meals.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>

            {authEnabled && !signedIn && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 text-center">
                    Plates are saved on this device only — sign in to sync across devices.
                </div>
            )}

            {syncError && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300 text-center">
                    Not saved to your account — changes are on this device.
                </div>
            )}

            {plate.items.length === 0 ? (
                <div className={`${CARD} p-16 text-center`}>
                    <p className="text-4xl mb-4">🍽️</p>
                    <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing on this plate</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                        Tap + on items in Browse to add them and see your totals here.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Totals ── */}
                    <div className={`${CARD} sticky top-14 z-30 px-4 py-3`}>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {stats.map(([label, value]) => (
                                <div key={label} className="text-center">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                        {label}
                                    </p>
                                    <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                                        {value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {totals.incompleteCount > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300 text-center">
                            {totals.incompleteCount} item{totals.incompleteCount !== 1 ? 's are' : ' is'} missing
                            some nutrition data — totals are a lower bound.
                        </div>
                    )}

                    {/* ── Items ── */}
                    <div className={`${CARD} overflow-hidden`}>
                        <ul className="divide-y divide-gray-100 dark:divide-slate-700/50">
                            {plate.items.map(item => {
                                const id = entryId(item);
                                const cals = item.nutrition.calories;
                                const serving = describeServing(item.serving_size, item.servings);
                                return (
                                    <li key={id} className="px-4 py-3 flex items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                                {item.name}
                                            </p>
                                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
                                                {item.hall}{item.station ? ` · ${item.station}` : ''}
                                                {isIncomplete(item) && (
                                                    <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                                        partial data
                                                    </span>
                                                )}
                                            </p>
                                            {serving && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                                    <span className="text-gray-400 dark:text-gray-500">Serving:</span>{' '}
                                                    {serving.label}
                                                    {serving.scaled && (
                                                        <>
                                                            {' '}<span className="text-gray-300 dark:text-slate-600">→</span>{' '}
                                                            <span className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                                                                {serving.scaled}
                                                            </span>
                                                        </>
                                                    )}
                                                </p>
                                            )}
                                        </div>

                                        {/* Servings stepper */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => setServings(id, item.servings - SERVING_STEP)}
                                                disabled={item.servings <= MIN_SERVINGS}
                                                className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors leading-none"
                                                title="Fewer servings"
                                            >
                                                −
                                            </button>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                step={SERVING_STEP}
                                                min={MIN_SERVINGS}
                                                value={item.servings}
                                                onChange={e => {
                                                    const n = Number(e.target.value);
                                                    if (e.target.value === '' || Number.isNaN(n)) return;
                                                    setServings(id, clampServings(n));
                                                }}
                                                className="w-14 px-1 py-1 text-sm text-center tabular-nums border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-[#FFCB05]/60"
                                                aria-label={`Servings of ${item.name}`}
                                            />
                                            <button
                                                onClick={() => setServings(id, item.servings + SERVING_STEP)}
                                                className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors leading-none"
                                                title="More servings"
                                            >
                                                +
                                            </button>
                                        </div>

                                        <span className="w-20 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
                                            {cals != null ? `${Math.round(cals * item.servings)} kcal` : '—'}
                                        </span>

                                        <button
                                            onClick={() => removeItem(id)}
                                            className="text-gray-300 dark:text-slate-700 hover:text-red-500 dark:hover:text-red-400 transition-colors text-lg shrink-0 leading-none"
                                            title="Remove from plate"
                                        >
                                            ×
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="text-center">
                        <button
                            onClick={clearPlate}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 underline transition-colors"
                        >
                            Clear plate
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default PlateView;
