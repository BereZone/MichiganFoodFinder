import React, { useState, useEffect, useMemo } from 'react';
import type { MenuItem } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useFavorites } from '../hooks/useFavorites';
import MyMenu from './MyMenu';
import { inferDetroitNow } from '../lib/mealTime';
import { usePlates } from '../hooks/usePlates';
import PlateView from './PlateView';
import { nutritionFromMenuItem } from '../lib/nutrition';
import { entryId, MIN_SERVINGS } from '../lib/plateOps';
import { mealHeadline, freshness, MEAL_CHIP } from '../lib/boardVoice';
import {
    SearchIcon, CalendarIcon, StarIcon, PlusIcon, MinusIcon, CloseIcon,
    SunIcon, MoonIcon, ClockIcon, ChevronDownIcon, ArrowLeftIcon,
    ArrowRightIcon, TrayIcon, GoogleIcon, AlertIcon,
} from './Icon';

const DINING_HALLS = [
    'Bursley', 'East Quad', 'Markley', 'Mosher-Jordan',
    'North Quad', 'Twigs at Oxford', 'South Quad',
];

const MEALS = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'];
const DATES_PER_PAGE = 3;

/** Tags worth spotting at a glance get the one semantic green; everything else
 *  stays neutral so the row does not turn back into a rainbow. */
const DIET_TAGS = new Set(['Vegan', 'Vegetarian']);

/** Every attribute the menu publishes: dietary tags first (those are what
 *  people filter their whole diet on), then the rest, then nutrient density
 *  and carbon footprint. Nothing is truncated away. */
function marksFor(item: MenuItem): Array<{ text: string; diet: boolean }> {
    const diet = item.other_tags.filter(t => DIET_TAGS.has(t)).map(t => ({ text: t, diet: true }));
    const rest = item.other_tags.filter(t => !DIET_TAGS.has(t)).map(t => ({ text: t, diet: false }));
    if (item.nutrient_density) rest.push({ text: `ND ${item.nutrient_density}`, diet: false });
    if (item.carbon_footprint) rest.push({ text: `CF ${item.carbon_footprint}`, diet: false });
    return [...diet, ...rest];
}

function formatLongDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatShortDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function localToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── Surface vocabulary ────────────────────────────────────── */

const PANEL = 'bg-surface border border-line rounded-xl shadow-panel';

const FIELD =
    'w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-fg ' +
    'placeholder:text-fg-3 focus:border-navy-ink focus:ring-2 focus:ring-navy-ink/20 ' +
    'focus:outline-none transition-colors';

const CHIP = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors';
const CHIP_OFF = 'bg-surface border-line text-fg-2 hover:border-line-2 hover:text-fg';
const CHIP_ON = 'bg-navy border-navy text-on-navy';

const SkeletonCard = () => (
    <div className={`${PANEL} overflow-hidden mb-4 animate-pulse`}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
            <div className="h-5 w-20 bg-surface-3 rounded-md" />
            <div className="h-4 w-28 bg-surface-2 rounded" />
        </div>
        <div className="h-8 bg-surface-2 border-b border-line" />
        {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-0">
                <div className="h-4 w-4 bg-surface-3 rounded shrink-0" />
                <div className="h-3.5 bg-surface-2 rounded" style={{ width: `${34 + i * 12}%` }} />
                <div className="flex-1" />
                <div className="h-3 w-12 bg-surface-2 rounded shrink-0" />
            </div>
        ))}
    </div>
);

const MenuFinder: React.FC = () => {
    const [items, setItems] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedHalls, setSelectedHalls] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [selectedMeal, setSelectedMeal] = useState<string>('');
    const [showFavorites, setShowFavorites] = useState(false);
    const [showTagFilter, setShowTagFilter] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [view, setView] = useState<'browse' | 'mymenu' | 'plate'>('browse');

    // Bumped only when results are deliberately reset (first load and
    // "on right now"), so the settle animation stays a moment.
    const [settleKey, setSettleKey] = useState(0);
    const [poppedStar, setPoppedStar] = useState<string | null>(null);

    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('umich-dining-theme');
            if (saved) return saved === 'dark';
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return false;
    });

    const { session, signIn, signOut, enabled: authEnabled } = useAuth();
    const { favorites, toggleFavorite } = useFavorites(session);
    const {
        plates, getPlate, addItem, setServings, removeItem, decrementItem,
        clearPlate, syncError,
    } = usePlates(session);
    const today = useMemo(localToday, []);
    const headline = useMemo(() => mealHeadline(), []);

    // Which plate the Plate tab is showing. Seeded once from whatever is
    // already in localStorage: the most recently modified non-empty plate,
    // else today + the current Detroit meal.
    const [plateSel, setPlateSel] = useState<{ date: string; meal: string }>(() => {
        const newest = Object.values(plates)
            .filter(p => p.items.length > 0)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        return newest
            ? { date: newest.date, meal: newest.meal }
            : inferDetroitNow();
    });
    const { date: plateDate, meal: plateMeal } = plateSel;

    useEffect(() => {
        const root = document.documentElement;
        if (darkMode) {
            root.classList.add('dark');
            localStorage.setItem('umich-dining-theme', 'dark');
        } else {
            root.classList.remove('dark');
            localStorage.setItem('umich-dining-theme', 'light');
        }
    }, [darkMode]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch('/api/menus');
                if (!response.ok) throw new Error('Failed to load menu data');
                const data = await response.json();
                const sortedMenus = data.menus.sort((a: MenuItem, b: MenuItem) => {
                    if (a.date !== b.date) return a.date.localeCompare(b.date);
                    if (a.meal !== b.meal) return MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal);
                    if (a.hall !== b.hall) return a.hall.localeCompare(b.hall);
                    if (a.station && b.station && a.station !== b.station) return a.station.localeCompare(b.station);
                    return a.item_display.localeCompare(b.item_display);
                });
                setItems(sortedMenus);
                setLastUpdated(data.last_updated);
                setDateRange(data.date_range);
                setSettleKey(k => k + 1);
            } catch (err) {
                console.error('Error loading menus:', err);
                setError('Failed to load menu data. Please try refreshing.');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    // Sync URL → state on mount
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        if (p.get('q')) setSearchTerm(p.get('q')!);
        if (p.get('halls')) setSelectedHalls(p.get('halls')!.split(','));
        if (p.get('tags')) setSelectedTags(p.get('tags')!.split(','));
        if (p.get('date')) setSelectedDate(p.get('date')!);
        if (p.get('meal')) setSelectedMeal(p.get('meal')!);
        if (p.get('favs') === 'true') setShowFavorites(true);
    }, []);

    // Sync state → URL
    useEffect(() => {
        const p = new URLSearchParams();
        if (searchTerm) p.set('q', searchTerm);
        if (selectedHalls.length) p.set('halls', selectedHalls.join(','));
        if (selectedTags.length) p.set('tags', selectedTags.join(','));
        if (selectedDate) p.set('date', selectedDate);
        if (selectedMeal) p.set('meal', selectedMeal);
        if (showFavorites) p.set('favs', 'true');
        window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
    }, [searchTerm, selectedHalls, selectedTags, selectedDate, selectedMeal, showFavorites]);

    // Reset to page 1 on filter change
    useEffect(() => { setCurrentPage(1); },
        [searchTerm, selectedHalls, selectedTags, selectedDate, selectedMeal, showFavorites]);

    const uniqueItemNames = useMemo(() =>
        Array.from(new Set(items.map(i => i.item_display))).sort(), [items]);

    const uniqueTags = useMemo(() => {
        const tags = new Set<string>();
        items.forEach(item => {
            item.other_tags.forEach(t => tags.add(t));
            if (item.nutrient_density) tags.add(`ND: ${item.nutrient_density}`);
            if (item.carbon_footprint) tags.add(`CF: ${item.carbon_footprint}`);
        });
        return Array.from(tags).sort();
    }, [items]);

    const uniqueDates = useMemo(() =>
        Array.from(new Set(items.map(i => i.date))).sort(), [items]);

    const filteredItems = useMemo(() => items.filter(item => {
        const matchesSearch = !searchTerm || item.item.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesHall = !selectedHalls.length || selectedHalls.includes(item.hall);
        const matchesDate = !selectedDate || item.date === selectedDate;
        const matchesMeal = !selectedMeal || item.meal === selectedMeal;
        const matchesFavorites = !showFavorites || favorites.includes(item.item_key);
        const matchesTags = !selectedTags.length || selectedTags.every(tag => {
            if (tag.startsWith('ND: ')) return item.nutrient_density === tag.slice(4);
            if (tag.startsWith('CF: ')) return item.carbon_footprint === tag.slice(4);
            return item.other_tags.includes(tag);
        });
        return matchesSearch && matchesHall && matchesDate && matchesMeal && matchesFavorites && matchesTags;
    }), [items, searchTerm, selectedHalls, selectedDate, selectedMeal, selectedTags, showFavorites, favorites]);

    // Group: date → meal → hall → station → items[]
    const grouped = useMemo(() => {
        const result = new Map<string, Map<string, Map<string, Map<string, MenuItem[]>>>>();
        for (const item of filteredItems) {
            if (!result.has(item.date)) result.set(item.date, new Map());
            const meals = result.get(item.date)!;
            if (!meals.has(item.meal)) meals.set(item.meal, new Map());
            const halls = meals.get(item.meal)!;
            if (!halls.has(item.hall)) halls.set(item.hall, new Map());
            const stations = halls.get(item.hall)!;
            const stKey = item.station ?? '';
            if (!stations.has(stKey)) stations.set(stKey, []);
            stations.get(stKey)!.push(item);
        }
        return result;
    }, [filteredItems]);

    const allDates = useMemo(() => Array.from(grouped.keys()), [grouped]);
    const totalPages = Math.max(1, Math.ceil(allDates.length / DATES_PER_PAGE));
    const visibleDates = allDates.slice(
        (currentPage - 1) * DATES_PER_PAGE,
        currentPage * DATES_PER_PAGE
    );

    const activeFilterCount = [
        !!searchTerm, !!selectedHalls.length, !!selectedTags.length,
        !!selectedDate, !!selectedMeal, showFavorites,
    ].filter(Boolean).length;

    const selectedPlate = useMemo(
        () => getPlate(plateDate, plateMeal),
        [getPlate, plateDate, plateMeal],
    );

    // Dates the user can build a plate for: whatever the menus cover, plus the
    // dates of any plate they already have (so old plates stay reachable).
    const plateDates = useMemo(() => {
        const set = new Set<string>(uniqueDates);
        Object.values(plates).forEach(p => set.add(p.date));
        if (plateDate) set.add(plateDate);
        return [...set].sort();
    }, [uniqueDates, plates, plateDate]);

    const clearAllFilters = () => {
        setSearchTerm(''); setSelectedHalls([]); setSelectedTags([]);
        setSelectedDate(''); setSelectedMeal(''); setShowFavorites(false);
    };

    const toggleHall = (hall: string) =>
        setSelectedHalls(prev => prev.includes(hall) ? prev.filter(h => h !== hall) : [...prev, hall]);

    const toggleTag = (tag: string) =>
        setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

    const handleOpenNow = () => {
        const { date: dateStr, meal } = inferDetroitNow();

        setSelectedDate(uniqueDates.includes(dateStr) ? dateStr : (uniqueDates[0] || ''));
        setSelectedMeal(meal);
        setSearchTerm(''); setSelectedHalls([]); setSelectedTags([]);
        setShowFavorites(false); setView('browse');
        setSettleKey(k => k + 1);
    };

    const addToPlate = (item: MenuItem) => {
        addItem(item.date, item.meal, {
            item_key: item.item_key,
            name: item.item_display,
            hall: item.hall,
            station: item.station ?? '',
            servings: 1,
            serving_size: item.nutrition?.serving_size ?? null,
            nutrition: nutritionFromMenuItem(item),
        });
        setPlateSel({ date: item.date, meal: item.meal });
    };

    const handleToggleFavorite = (itemKey: string) => {
        if (!favorites.includes(itemKey)) {
            setPoppedStar(itemKey);
            window.setTimeout(() => setPoppedStar(k => (k === itemKey ? null : k)), 400);
        }
        toggleFavorite(itemKey);
    };

    const addToCalendar = (item: MenuItem) => {
        const startMap: Record<string, string> = { Breakfast: '080000', Brunch: '100000', Lunch: '110000', Dinner: '170000' };
        const endMap: Record<string, string> = { Breakfast: '100000', Brunch: '140000', Lunch: '140000', Dinner: '200000' };
        const d = item.date.replace(/-/g, '');
        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE`
            + `&text=${encodeURIComponent(item.item_display)}`
            + `&dates=${d}T${startMap[item.meal] ?? '120000'}/${d}T${endMap[item.meal] ?? '130000'}`
            + `&details=${encodeURIComponent(`Served at ${item.hall} for ${item.meal}.`)}`
            + `&location=${encodeURIComponent(item.hall)}`;
        window.open(url, '_blank');
    };

    const TABS: Array<{ id: typeof view; label: string; count: number }> = [
        { id: 'browse', label: 'Browse', count: 0 },
        { id: 'mymenu', label: 'My Menu', count: favorites.length },
        { id: 'plate', label: 'Plate', count: selectedPlate.items.length },
    ];

    return (
        <div className="min-h-screen bg-bg text-fg">

            {/* ── App bar ── */}
            <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-md border-b border-line">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5">
                    <div className="flex items-center gap-2.5 shrink-0">
                        <span
                            className="w-7 h-7 rounded-lg bg-navy text-maize grid place-items-center text-sm font-extrabold"
                            aria-hidden="true"
                        >
                            M
                        </span>
                        <span className="hidden lg:block font-extrabold text-sm tracking-tight">
                            Michigan Food Finder
                        </span>
                        <span className="lg:hidden sr-only">Michigan Food Finder</span>
                    </div>

                    <nav
                        className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-line"
                        aria-label="Views"
                    >
                        {TABS.map(tab => {
                            const active = view === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setView(tab.id)}
                                    aria-current={active ? 'page' : undefined}
                                    className={`px-2.5 sm:px-3 py-1.5 rounded-md text-[0.8125rem] font-semibold transition-colors ${
                                        active
                                            ? 'bg-surface text-fg shadow-panel ring-1 ring-line'
                                            : 'text-fg-3 hover:text-fg-2'
                                    }`}
                                >
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className={`ml-1.5 tnum text-[0.6875rem] px-1 py-px rounded ${
                                            active ? 'bg-maize-wash text-maize-ink' : 'text-fg-3'
                                        }`}>
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="flex-1" />

                    <div className="flex items-center gap-2 shrink-0">
                        {authEnabled && (session ? (
                            <>
                                <span className="hidden md:block text-xs text-fg-3 max-w-[9rem] truncate">
                                    {session.user.email}
                                </span>
                                <button
                                    onClick={signOut}
                                    className="text-xs px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-surface-2 hover:text-fg transition-colors font-semibold"
                                >
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={signIn}
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-line text-fg-2 hover:bg-surface-2 hover:text-fg transition-colors font-semibold flex items-center gap-1.5"
                                title="Sign in to sync favorites and plates across devices"
                            >
                                <GoogleIcon size={14} /> <span className="hidden sm:inline">Sign in</span>
                            </button>
                        ))}
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className="p-1.5 rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg transition-colors"
                            aria-pressed={darkMode}
                            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        >
                            {darkMode
                                ? <MoonIcon size={17} title="Switch to light mode" />
                                : <SunIcon size={17} title="Switch to dark mode" />}
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

                {/* ── Hero ── */}
                {view === 'browse' ? (
                    <section className={`${PANEL} p-5 sm:p-6 mb-5 flex flex-col lg:flex-row lg:items-start lg:gap-10`}>
                        <div className="lg:flex-1 min-w-0">
                            <h1 className="text-[1.625rem] sm:text-[2rem] font-extrabold tracking-tight leading-tight text-balance">
                                {headline.line}
                            </h1>
                            <p className="mt-1.5 text-sm text-fg-3">
                                {dateRange
                                    ? `Seven halls · ${formatShortDate(dateRange.start)} – ${formatShortDate(dateRange.end)}`
                                    : 'Seven halls across campus'}
                                {lastUpdated && ` · ${freshness(lastUpdated)}`}
                            </p>

                            <div className="mt-5 flex flex-wrap items-center gap-3">
                                <button
                                    onClick={handleOpenNow}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-navy text-on-navy font-bold text-sm shadow-panel hover:bg-navy-2 hover:shadow-lift active:translate-y-px transition-all duration-150"
                                >
                                    <ClockIcon size={16} />
                                    What&rsquo;s on right now
                                </button>
                                <p className="text-xs text-fg-3 tnum">
                                    {items.length.toLocaleString()} items tracked
                                </p>
                            </div>
                        </div>

                        <p className="mt-4 pt-4 border-t border-line text-xs text-fg-3 leading-relaxed
                                      lg:mt-0 lg:pt-0 lg:border-t-0 lg:border-l lg:pl-10 lg:w-[22rem] lg:shrink-0 lg:self-stretch">
                            Menus are scraped from the dining site, so treat them as a good guess rather
                            than gospel. Halls swap things out without telling anyone, so it is worth a
                            glance at the hall&rsquo;s own posting before you commit to the walk.
                        </p>
                    </section>
                ) : (
                    <section className="mb-5">
                        <h1 className="text-[1.5rem] sm:text-[1.875rem] font-extrabold tracking-tight">
                            {view === 'plate' ? 'Your plate' : 'Your menu'}
                        </h1>
                        <p className="mt-1 text-sm text-fg-3">
                            {view === 'plate'
                                ? 'Everything you picked for one meal, added up.'
                                : 'Everything you starred, on the days it is actually being served.'}
                        </p>
                    </section>
                )}

                {view === 'plate' ? (
                    <PlateView
                        plate={selectedPlate}
                        date={plateDate}
                        meal={plateMeal}
                        availableDates={plateDates}
                        meals={MEALS}
                        onSelect={(d, m) => setPlateSel({ date: d, meal: m })}
                        setServings={(id, n) => setServings(plateDate, plateMeal, id, n)}
                        removeItem={(id) => removeItem(plateDate, plateMeal, id)}
                        clearPlate={() => clearPlate(plateDate, plateMeal)}
                        syncError={syncError}
                        signedIn={session !== null}
                        authEnabled={authEnabled}
                    />
                ) : view === 'mymenu' ? (
                    <MyMenu
                        items={items}
                        favorites={favorites}
                        toggleFavorite={handleToggleFavorite}
                        addToCalendar={addToCalendar}
                        signedIn={session !== null}
                        authEnabled={authEnabled}
                    />
                ) : (
                    <>
                        {error && (
                            <div className="flex items-start gap-2.5 border border-danger/40 bg-danger-wash text-danger rounded-xl px-4 py-3 mb-5 text-sm">
                                <AlertIcon size={16} className="shrink-0 mt-px" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* ── Filters ── */}
                        <div className={`${PANEL} p-4 mb-6`}>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="relative flex-1 min-w-0">
                                    <SearchIcon
                                        size={16}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
                                    />
                                    <input
                                        type="text"
                                        aria-label="Search menu items"
                                        className={`${FIELD} pl-9`}
                                        placeholder="Search items…"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        list="item-suggestions"
                                    />
                                    <datalist id="item-suggestions">
                                        {uniqueItemNames.slice(0, 50).map(name => <option key={name} value={name} />)}
                                    </datalist>
                                </div>

                                <div className="relative sm:w-44">
                                    <select
                                        aria-label="Filter by day"
                                        className={`${FIELD} appearance-none pr-9 cursor-pointer`}
                                        value={selectedDate}
                                        onChange={e => setSelectedDate(e.target.value)}
                                    >
                                        <option value="">All days</option>
                                        {uniqueDates.map(date => (
                                            <option key={date} value={date}>{formatShortDate(date)}</option>
                                        ))}
                                    </select>
                                    <ChevronDownIcon
                                        size={15}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
                                    />
                                </div>

                                <div className="relative sm:w-36">
                                    <select
                                        aria-label="Filter by meal"
                                        className={`${FIELD} appearance-none pr-9 cursor-pointer`}
                                        value={selectedMeal}
                                        onChange={e => setSelectedMeal(e.target.value)}
                                    >
                                        <option value="">All meals</option>
                                        {MEALS.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                    <ChevronDownIcon
                                        size={15}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {DINING_HALLS.map(hall => {
                                    const on = selectedHalls.includes(hall);
                                    return (
                                        <button
                                            key={hall}
                                            onClick={() => toggleHall(hall)}
                                            aria-pressed={on}
                                            className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                                        >
                                            {hall}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex items-center flex-wrap gap-2 mt-3 pt-3 border-t border-line">
                                <button
                                    onClick={() => setShowFavorites(!showFavorites)}
                                    aria-pressed={showFavorites}
                                    className={`${CHIP} flex items-center gap-1.5 ${
                                        showFavorites
                                            ? 'bg-maize-wash border-maize-ink/40 text-maize-ink'
                                            : CHIP_OFF
                                    }`}
                                >
                                    <StarIcon size={13} filled={showFavorites} /> Starred
                                </button>
                                <button
                                    onClick={() => setShowTagFilter(!showTagFilter)}
                                    aria-expanded={showTagFilter}
                                    className={`${CHIP} flex items-center gap-1.5 ${
                                        selectedTags.length > 0 ? CHIP_ON : CHIP_OFF
                                    }`}
                                >
                                    Tags{selectedTags.length > 0 ? ` · ${selectedTags.length}` : ''}
                                    <ChevronDownIcon
                                        size={13}
                                        className={`transition-transform duration-200 ${showTagFilter ? 'rotate-180' : ''}`}
                                    />
                                </button>

                                <div className="flex-1" />

                                <span className="text-xs text-fg-3 tnum">
                                    {filteredItems.length.toLocaleString()} item{filteredItems.length !== 1 ? 's' : ''}
                                    {allDates.length > 0 && ` · ${allDates.length} day${allDates.length !== 1 ? 's' : ''}`}
                                </span>
                                {activeFilterCount > 0 && (
                                    <button
                                        onClick={clearAllFilters}
                                        className="text-xs font-semibold text-fg-2 hover:text-danger transition-colors"
                                    >
                                        Clear {activeFilterCount}
                                    </button>
                                )}
                            </div>

                            {showTagFilter && (
                                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-line max-h-36 overflow-y-auto">
                                    {uniqueTags.map(tag => (
                                        <button
                                            key={tag}
                                            onClick={() => toggleTag(tag)}
                                            aria-pressed={selectedTags.includes(tag)}
                                            className={`${CHIP} ${selectedTags.includes(tag) ? CHIP_ON : CHIP_OFF}`}
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── Results ── */}
                        {loading ? (
                            <>
                                <div className="h-6 w-48 bg-surface-3 rounded animate-pulse mb-4" />
                                <SkeletonCard />
                                <SkeletonCard />
                            </>
                        ) : filteredItems.length === 0 ? (
                            <div className={`${PANEL} px-6 py-16 text-center`}>
                                <TrayIcon size={40} className="mx-auto text-fg-3" />
                                <p className="mt-4 text-lg font-extrabold">
                                    {showFavorites && favorites.length === 0
                                        ? 'Nothing starred yet'
                                        : 'Nothing matches that'}
                                </p>
                                <p className="mt-1.5 text-sm text-fg-3 max-w-[38ch] mx-auto leading-relaxed">
                                    {showFavorites && favorites.length === 0
                                        ? 'Star anything while browsing and it will turn up here the next time it is being served.'
                                        : 'Plenty on the menu, just not this. Try dropping a hall or widening the day.'}
                                </p>
                                {activeFilterCount > 0 && (
                                    <button
                                        onClick={clearAllFilters}
                                        className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-on-navy text-sm font-bold shadow-panel hover:bg-navy-2 transition-colors"
                                    >
                                        Clear all filters
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div key={settleKey}>
                                {visibleDates.map((date, dayIndex) => {
                                    const mealMap = grouped.get(date)!;
                                    return (
                                        <section
                                            key={date}
                                            className="mb-8 settle"
                                            style={{ animationDelay: `${dayIndex * 80}ms` }}
                                        >
                                            <div className="flex items-center gap-2.5 mb-3">
                                                <h2 className="text-base sm:text-lg font-extrabold tracking-tight">
                                                    {formatLongDate(date)}
                                                </h2>
                                                {date === today && (
                                                    <span className="label px-2 py-1 rounded-md bg-maize text-[#0f172a]">
                                                        Today
                                                    </span>
                                                )}
                                            </div>

                                            <div className="space-y-4">
                                                {[...mealMap.entries()]
                                                    .sort(([a], [b]) => MEALS.indexOf(a) - MEALS.indexOf(b))
                                                    .flatMap(([meal, hallMap]) =>
                                                        [...hallMap.entries()]
                                                            .sort(([a], [b]) => a.localeCompare(b))
                                                            .map(([hall, stationMap]) => {
                                                                const total = [...stationMap.values()]
                                                                    .reduce((n, arr) => n + arr.length, 0);
                                                                return (
                                                                    <article
                                                                        key={`${meal}-${hall}`}
                                                                        className={`${PANEL} overflow-hidden`}
                                                                    >
                                                                        {/* Hall header */}
                                                                        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
                                                                            <span className={`label shrink-0 px-2 py-1 rounded-md ${MEAL_CHIP[meal] ?? 'bg-surface-2 text-fg-2'}`}>
                                                                                {meal}
                                                                            </span>
                                                                            <h3 className="font-bold text-[0.9375rem] truncate">{hall}</h3>
                                                                            <span className="flex-1" />
                                                                            <span className="text-xs text-fg-3 tnum shrink-0">
                                                                                {total} item{total !== 1 ? 's' : ''}
                                                                            </span>
                                                                        </div>

                                                                        {/* Stations, each its own banded block */}
                                                                        {[...stationMap.entries()].map(([station, stationItems]) => (
                                                                            <div key={station}>
                                                                                {station && (
                                                                                    <div className="flex items-center gap-2 px-4 py-2 bg-surface-2 border-b border-line">
                                                                                        <span className="label text-fg-2">{station}</span>
                                                                                        <span className="flex-1" />
                                                                                        <span className="text-[0.6875rem] text-fg-3 tnum">
                                                                                            {stationItems.length}
                                                                                        </span>
                                                                                    </div>
                                                                                )}

                                                                                <ul className="divide-y divide-line">
                                                                                    {stationItems.map((item, idx) => {
                                                                                        const isFav = favorites.includes(item.item_key);
                                                                                        const rowId = entryId({
                                                                                            item_key: item.item_key,
                                                                                            hall: item.hall,
                                                                                            station: item.station ?? '',
                                                                                        });
                                                                                        const onPlate = getPlate(item.date, item.meal)
                                                                                            .items.find(e => entryId(e) === rowId);
                                                                                        const atMin = onPlate ? onPlate.servings <= MIN_SERVINGS : false;
                                                                                        const step =
                                                                                            'w-7 h-7 grid place-items-center rounded-lg shrink-0 transition-colors';

                                                                                        return (
                                                                                            <li
                                                                                                key={`${item.item_key}-${idx}`}
                                                                                                className={`flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2 ${
                                                                                                    isFav ? 'bg-maize-wash' : ''
                                                                                                }`}
                                                                                            >
                                                                                                <button
                                                                                                    onClick={() => handleToggleFavorite(item.item_key)}
                                                                                                    aria-pressed={isFav}
                                                                                                    aria-label={isFav
                                                                                                        ? `Unstar ${item.item_display}`
                                                                                                        : `Star ${item.item_display}`}
                                                                                                    className={`shrink-0 transition-colors ${
                                                                                                        isFav
                                                                                                            ? 'text-maize-ink'
                                                                                                            : 'text-icon-idle hover:text-maize-ink'
                                                                                                    } ${poppedStar === item.item_key ? 'star-pop' : ''}`}
                                                                                                >
                                                                                                    <StarIcon size={16} filled={isFav} />
                                                                                                </button>

                                                                                                <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                                                <span className="text-sm font-medium max-w-full">
                                                                                                    {item.item_display}
                                                                                                </span>

                                                                                                <span className="flex flex-wrap items-center gap-1">
                                                                                                    {marksFor(item).map(({ text, diet }) => (
                                                                                                        <span
                                                                                                            key={text}
                                                                                                            className={`text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded border ${
                                                                                                                diet ? 'border-good/35 text-good' : 'border-line text-fg-3'
                                                                                                            }`}
                                                                                                        >
                                                                                                            {text}
                                                                                                        </span>
                                                                                                    ))}
                                                                                                </span>
                                                                                                </span>

                                                                                                {item.nutrition?.calories != null ? (
                                                                                                    <div className="group/cal relative shrink-0 sm:w-[4.5rem] text-right">
                                                                                                        <span className="text-[0.8125rem] font-semibold text-fg-2 tnum whitespace-nowrap cursor-default">
                                                                                                            {item.nutrition.calories}
                                                                                                            <span className="hidden sm:inline text-fg-3 font-medium text-[0.6875rem] ml-0.5">kcal</span>
                                                                                                        </span>
                                                                                                        <div className="absolute bottom-full right-0 mb-2 hidden group-hover/cal:block w-44 bg-surface border border-line rounded-lg p-3 z-20 shadow-pop pointer-events-none text-left">
                                                                                                            {item.nutrition.serving_size && (
                                                                                                                <div className="pb-1.5 mb-1.5 border-b border-line text-xs text-fg-3">
                                                                                                                    {item.nutrition.serving_size}
                                                                                                                </div>
                                                                                                            )}
                                                                                                            <dl className="space-y-1 tnum text-xs">
                                                                                                                {([
                                                                                                                    ['Fat', item.nutrition.total_fat],
                                                                                                                    ['Carbs', item.nutrition.total_carbohydrate],
                                                                                                                    ['Protein', item.nutrition.protein],
                                                                                                                    ['Sodium', item.nutrition.sodium],
                                                                                                                ] as Array<[string, string | null]>)
                                                                                                                    .filter(([, v]) => v)
                                                                                                                    .map(([label, value]) => (
                                                                                                                        <div key={label} className="flex justify-between gap-4">
                                                                                                                            <dt className="text-fg-3">{label}</dt>
                                                                                                                            <dd className="font-semibold">{value}</dd>
                                                                                                                        </div>
                                                                                                                    ))}
                                                                                                            </dl>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <span
                                                                                                        className="text-[0.8125rem] text-fg-3 shrink-0 sm:w-[4.5rem] text-right"
                                                                                                        title="No nutrition published"
                                                                                                    >
                                                                                                        —
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

                                                                                                {!onPlate ? (
                                                                                                    <span className="sm:w-[5.25rem] flex justify-end shrink-0">
                                                                                                        <button
                                                                                                            onClick={() => addToPlate(item)}
                                                                                                            className={`${step} border border-line-2 text-fg-2 hover:bg-navy hover:border-navy hover:text-on-navy`}
                                                                                                            aria-label={`Add ${item.item_display} to plate`}
                                                                                                            title="Add to plate"
                                                                                                        >
                                                                                                            <PlusIcon size={15} />
                                                                                                        </button>
                                                                                                    </span>
                                                                                                ) : (
                                                                                                    <span className="sm:w-[5.25rem] flex items-center justify-end gap-1 shrink-0">
                                                                                                        <button
                                                                                                            onClick={() => decrementItem(item.date, item.meal, rowId)}
                                                                                                            className={`${step} border ${atMin
                                                                                                                ? 'border-danger/40 text-danger hover:bg-danger-wash'
                                                                                                                : 'border-line-2 text-fg-2 hover:bg-surface-3'}`}
                                                                                                            aria-label={atMin
                                                                                                                ? `Remove ${item.item_display} from plate`
                                                                                                                : `One fewer serving of ${item.item_display}`}
                                                                                                            title={atMin ? 'Remove from plate' : 'Fewer servings'}
                                                                                                        >
                                                                                                            {atMin ? <CloseIcon size={14} /> : <MinusIcon size={15} />}
                                                                                                        </button>
                                                                                                        <span className="w-5 text-center text-[0.8125rem] font-bold tnum">
                                                                                                            {onPlate.servings}
                                                                                                        </span>
                                                                                                        <button
                                                                                                            onClick={() => addToPlate(item)}
                                                                                                            className={`${step} bg-navy text-on-navy hover:bg-navy-2`}
                                                                                                            aria-label={`One more serving of ${item.item_display}`}
                                                                                                            title="More servings"
                                                                                                        >
                                                                                                            <PlusIcon size={15} />
                                                                                                        </button>
                                                                                                    </span>
                                                                                                )}
                                                                                            </li>
                                                                                        );
                                                                                    })}
                                                                                </ul>
                                                                            </div>
                                                                        ))}
                                                                    </article>
                                                                );
                                                            })
                                                    )}
                                            </div>
                                        </section>
                                    );
                                })}

                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between gap-4 mt-6">
                                        <span className="text-xs text-fg-3 tnum">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                disabled={currentPage === 1}
                                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface border border-line text-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface transition-colors"
                                            >
                                                <ArrowLeftIcon size={15} /> Earlier
                                            </button>
                                            <button
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                disabled={currentPage === totalPages}
                                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface border border-line text-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface transition-colors"
                                            >
                                                Later <ArrowRightIcon size={15} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </main>

            <footer className="border-t border-line mt-4">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-fg-3">
                        Michigan Food Finder · Not affiliated with the University of Michigan
                    </p>
                    <a
                        href="https://github.com/BereZone/MichiganFoodFinder/blob/main/CHANGELOG.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="What changed recently"
                        className="px-2 py-1 rounded-md border border-line text-[10px] font-semibold tnum text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors"
                    >
                        v{__APP_VERSION__}
                    </a>
                </div>
            </footer>
        </div>
    );
};

export default MenuFinder;
