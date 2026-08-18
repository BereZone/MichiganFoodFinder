import React, { useMemo } from 'react';
import type { Plate } from '../types';
import { describeServing, isIncomplete, roundGrams, totalPlate } from '../lib/nutrition';
import { clampServings, entryId, MIN_SERVINGS, SERVING_STEP } from '../lib/plateOps';
import { MinusIcon, PlusIcon, CloseIcon, TrayIcon, AlertIcon, ChevronDownIcon } from './Icon';

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

const PANEL = 'bg-surface border border-line rounded-xl shadow-panel';

const FIELD =
    'w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-fg appearance-none pr-9 ' +
    'cursor-pointer focus:border-navy-ink focus:ring-2 focus:ring-navy-ink/20 focus:outline-none transition-colors';

const NOTE = 'flex items-start gap-2.5 px-4 py-3 text-sm rounded-xl border';

const PlateView: React.FC<Props> = ({
    plate, date, meal, availableDates, meals, onSelect,
    setServings, removeItem, clearPlate, syncError, signedIn, authEnabled,
}) => {
    const totals = useMemo(() => totalPlate(plate.items), [plate.items]);
    const showSignInNote = authEnabled && !signedIn;

    const stats: Array<[string, string, string]> = [
        ['Calories', String(Math.round(totals.calories)), ''],
        ['Protein', String(roundGrams(totals.protein_g)), 'g'],
        ['Carbs', String(roundGrams(totals.carbs_g)), 'g'],
        ['Fat', String(roundGrams(totals.fat_g)), 'g'],
        ['Sodium', String(Math.round(totals.sodium_mg)), 'mg'],
    ];

    return (
        <div className="space-y-4">
            {/* ── Which plate ── */}
            <div className={`${PANEL} p-4 flex flex-col sm:flex-row gap-3`}>
                <div className="flex-1">
                    <label htmlFor="plate-date" className="label text-fg-2 block mb-1.5">Day</label>
                    <div className="relative">
                        <select
                            id="plate-date"
                            className={FIELD}
                            value={date}
                            onChange={e => onSelect(e.target.value, meal)}
                        >
                            {availableDates.map(d => (
                                <option key={d} value={d}>{formatShortDate(d)}</option>
                            ))}
                        </select>
                        <ChevronDownIcon
                            size={15}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
                        />
                    </div>
                </div>
                <div className="sm:w-44">
                    <label htmlFor="plate-meal" className="label text-fg-2 block mb-1.5">Meal</label>
                    <div className="relative">
                        <select
                            id="plate-meal"
                            className={FIELD}
                            value={meal}
                            onChange={e => onSelect(date, e.target.value)}
                        >
                            {meals.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <ChevronDownIcon
                            size={15}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
                        />
                    </div>
                </div>
            </div>

            {showSignInNote && (
                <div className={`${NOTE} border-line bg-navy-wash text-fg-2`}>
                    <AlertIcon size={16} className="shrink-0 mt-px text-navy-ink" />
                    <span>Plates live in this browser only. Sign in and they follow you to your phone.</span>
                </div>
            )}

            {syncError && (
                <div className={`${NOTE} border-warn/40 bg-warn-wash text-warn`}>
                    <AlertIcon size={16} className="shrink-0 mt-px" />
                    <span>Could not reach your account. These changes are saved on this device only.</span>
                </div>
            )}

            {plate.items.length === 0 ? (
                <div className={`${PANEL} px-6 py-16 text-center`}>
                    <TrayIcon size={40} className="mx-auto text-fg-3" />
                    <p className="mt-4 text-lg font-extrabold">Nothing on this plate</p>
                    <p className="mt-1.5 text-sm text-fg-3 max-w-[38ch] mx-auto leading-relaxed">
                        Hit
                        <span className="inline-grid place-items-center w-4 h-4 mx-1 align-[-3px] border border-line-2 rounded">
                            <PlusIcon size={10} />
                        </span>
                        beside anything while browsing. Calories and macros add themselves up here.
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Running total ── */}
                    <div className={`${PANEL} sticky top-[3.75rem] z-30 p-4`}>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-y-4 gap-x-3">
                            {stats.map(([label, value, unit]) => (
                                <div key={label}>
                                    <p className="label text-fg-3">{label}</p>
                                    <p className="mt-1.5 text-2xl font-extrabold tracking-tight tnum leading-none">
                                        {value}
                                        {unit && <span className="text-sm font-bold text-fg-3 ml-0.5">{unit}</span>}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {totals.incompleteCount > 0 && (
                        <div className={`${NOTE} border-warn/40 bg-warn-wash text-warn`}>
                            <AlertIcon size={16} className="shrink-0 mt-px" />
                            <span>
                                {totals.incompleteCount} item{totals.incompleteCount !== 1 ? 's are' : ' is'} missing
                                some nutrition data, so these totals are a floor, not the whole story.
                            </span>
                        </div>
                    )}

                    {/* ── What is on it ── */}
                    <div className={`${PANEL} overflow-hidden`}>
                        <ul className="divide-y divide-line">
                            {plate.items.map(item => {
                                const id = entryId(item);
                                const cals = item.nutrition.calories;
                                const serving = describeServing(item.serving_size, item.servings);
                                const step =
                                    'w-8 h-8 grid place-items-center rounded-lg border border-line-2 text-fg-2 ' +
                                    'hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed ' +
                                    'disabled:hover:bg-surface transition-colors shrink-0';

                                return (
                                    <li key={id} className="flex items-center gap-3 px-4 py-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{item.name}</p>
                                            <p className="text-xs text-fg-3 truncate mt-0.5">
                                                {item.hall}{item.station ? ` · ${item.station}` : ''}
                                                {isIncomplete(item) && (
                                                    <span className="ml-2 font-semibold text-warn">partial data</span>
                                                )}
                                            </p>
                                            {serving && (
                                                <p className="text-xs text-fg-3 truncate mt-0.5">
                                                    {serving.label}
                                                    {serving.scaled && (
                                                        <>
                                                            {' → '}
                                                            <span className="font-semibold text-fg-2 tnum">
                                                                {serving.scaled}
                                                            </span>
                                                        </>
                                                    )}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => setServings(id, item.servings - SERVING_STEP)}
                                                disabled={item.servings <= MIN_SERVINGS}
                                                className={step}
                                                aria-label={`One fewer serving of ${item.name}`}
                                                title="Fewer servings"
                                            >
                                                <MinusIcon size={15} />
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
                                                className="w-14 px-1 py-1.5 text-sm font-semibold text-center tnum bg-surface border border-line rounded-lg text-fg focus:border-navy-ink focus:ring-2 focus:ring-navy-ink/20 focus:outline-none transition-colors"
                                                aria-label={`Servings of ${item.name}`}
                                            />
                                            <button
                                                onClick={() => setServings(id, item.servings + SERVING_STEP)}
                                                className={step}
                                                aria-label={`One more serving of ${item.name}`}
                                                title="More servings"
                                            >
                                                <PlusIcon size={15} />
                                            </button>
                                        </div>

                                        <span className="w-[4.5rem] text-right text-[0.8125rem] font-semibold text-fg-2 tnum shrink-0">
                                            {cals != null ? (
                                                <>
                                                    {Math.round(cals * item.servings)}
                                                    <span className="text-fg-3 font-medium text-[0.6875rem] ml-0.5">kcal</span>
                                                </>
                                            ) : '—'}
                                        </span>

                                        <button
                                            onClick={() => removeItem(id)}
                                            className="text-fg-3 hover:text-danger transition-colors shrink-0 p-1 rounded-md hover:bg-surface-3"
                                            aria-label={`Remove ${item.name} from the plate`}
                                            title="Remove from plate"
                                        >
                                            <CloseIcon size={16} />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div>
                        <button
                            onClick={clearPlate}
                            className="text-xs font-semibold text-fg-2 hover:text-danger transition-colors"
                        >
                            Clear this plate
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default PlateView;
