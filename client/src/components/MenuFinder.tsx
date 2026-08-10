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

const DINING_HALLS = [
    'Bursley', 'East Quad', 'Markley', 'Mosher-Jordan',
    'North Quad', 'Twigs at Oxford', 'South Quad',
];

const MEALS = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'];
const DATES_PER_PAGE = 3;

const MEAL_COLORS: Record<string, string> = {
    Breakfast: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    Brunch:    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
    Lunch:     'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    Dinner:    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
};

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

const SkeletonGroup = () => (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 overflow-hidden animate-pulse mb-3">
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-slate-700/40 border-b border-gray-100 dark:border-slate-700/50">
            <div className="h-5 w-16 bg-gray-200 dark:bg-slate-600 rounded-md" />
            <div className="h-4 w-28 bg-gray-200 dark:bg-slate-600 rounded" />
        </div>
        {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-slate-700/30 last:border-0">
                <div className="h-4 w-4 bg-gray-200 dark:bg-slate-700 rounded shrink-0" />
                <div className="h-4 bg-gray-100 dark:bg-slate-700/60 rounded flex-1" />
                <div className="h-3 w-12 bg-gray-100 dark:bg-slate-700/60 rounded shrink-0" />
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

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 transition-colors duration-200">

            {/* ── Sticky header ── */}
            <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-gray-200/70 dark:border-slate-800">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 shrink-0">
                        <div className="w-7 h-7 rounded-lg bg-[#00274C] flex items-center justify-center shrink-0 shadow-sm">
                            <span className="text-[#FFCB05] font-extrabold text-sm leading-none">M</span>
                        </div>
                        <span className="font-bold text-gray-900 dark:text-white text-sm hidden sm:block tracking-tight">
                            Michigan Food Finder
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {authEnabled && (session ? (
                            <>
                                <span className="hidden md:block text-xs text-gray-400 dark:text-gray-500 max-w-[9rem] truncate">
                                    {session.user.email}
                                </span>
                                <button onClick={signOut} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors font-medium">
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <button onClick={signIn} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium flex items-center gap-1.5" title="Sign in to sync favorites across devices">
                                <span className="font-bold text-blue-600 dark:text-blue-400">G</span> Sign in
                            </button>
                        ))}
                        <button onClick={() => setDarkMode(!darkMode)} className="p-1.5 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors" title="Toggle dark mode">
                            {darkMode ? '🌙' : '☀️'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">

                {/* ── Hero ── */}
                <div className="text-center mb-10">
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-[#00274C] dark:text-white tracking-tight mb-2">
                        Michigan Food Finder
                    </h1>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                        {dateRange
                            ? `Menus ${formatShortDate(dateRange.start)} – ${formatShortDate(dateRange.end)}`
                            : 'Explore menus across campus'}
                    </p>
                    <button
                        onClick={handleOpenNow}
                        className="inline-flex items-center gap-2 px-7 py-2.5 bg-[#FFCB05] hover:bg-[#e6b800] text-[#00274C] font-bold rounded-full shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.03] active:scale-100"
                    >
                        <span>🕒</span> What's Open Now
                    </button>
                    <p className="mt-4 text-xs text-gray-400 dark:text-gray-600">
                        {lastUpdated && `Updated ${new Date(lastUpdated).toLocaleString()} · `}
                        Data may not be 100% accurate — verify with the dining hall.
                    </p>
                </div>

                {/* ── View tabs ── */}
                <div className="flex justify-center mb-6">
                    <div className="flex bg-gray-100 dark:bg-slate-800 rounded-xl p-1 gap-1">
                        {(['browse', 'mymenu', 'plate'] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setView(v)}
                                className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                                    view === v
                                        ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                }`}
                            >
                                {v === 'browse'
                                    ? '🍽️ Browse'
                                    : v === 'mymenu'
                                        ? `★ My Menu${favorites.length > 0 ? ` (${favorites.length})` : ''}`
                                        : `🧮 Plate${selectedPlate.items.length > 0 ? ` (${selectedPlate.items.length})` : ''}`}
                            </button>
                        ))}
                    </div>
                </div>

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
                        toggleFavorite={toggleFavorite}
                        addToCalendar={addToCalendar}
                        signedIn={session !== null}
                        authEnabled={authEnabled}
                    />
                ) : (
                    <>
                        {error && (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 mb-6 text-center text-sm text-red-600 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        {/* ── Filters ── */}
                        <div className="bg-white dark:bg-slate-800/80 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 p-4 mb-6 space-y-3">

                            {/* Search + Date + Meal */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="relative flex-1">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-sm select-none">🔍</span>
                                    <input
                                        type="text"
                                        className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 focus:border-[#FFCB05] outline-none transition-all bg-gray-50 dark:bg-slate-700 dark:text-white placeholder-gray-400 dark:placeholder-slate-500"
                                        placeholder="Search items…"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        list="item-suggestions"
                                    />
                                    <datalist id="item-suggestions">
                                        {uniqueItemNames.slice(0, 50).map(name => <option key={name} value={name} />)}
                                    </datalist>
                                </div>
                                <select
                                    className="sm:w-44 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 outline-none bg-gray-50 dark:bg-slate-700 dark:text-white"
                                    value={selectedDate}
                                    onChange={e => setSelectedDate(e.target.value)}
                                >
                                    <option value="">All dates</option>
                                    {uniqueDates.map(date => (
                                        <option key={date} value={date}>{formatShortDate(date)}</option>
                                    ))}
                                </select>
                                <select
                                    className="sm:w-36 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-[#FFCB05]/60 outline-none bg-gray-50 dark:bg-slate-700 dark:text-white"
                                    value={selectedMeal}
                                    onChange={e => setSelectedMeal(e.target.value)}
                                >
                                    <option value="">All meals</option>
                                    {MEALS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>

                            {/* Hall chips */}
                            <div className="flex flex-wrap gap-2">
                                {DINING_HALLS.map(hall => (
                                    <button
                                        key={hall}
                                        onClick={() => toggleHall(hall)}
                                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                            selectedHalls.includes(hall)
                                                ? 'bg-[#00274C] text-white dark:bg-[#003870]'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
                                        }`}
                                    >
                                        {hall}
                                    </button>
                                ))}
                            </div>

                            {/* Favorites · Tags · Count · Clear */}
                            <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-gray-100 dark:border-slate-700/50">
                                <button
                                    onClick={() => setShowFavorites(!showFavorites)}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                        showFavorites
                                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
                                    }`}
                                >
                                    <span>{showFavorites ? '★' : '☆'}</span> Favorites
                                </button>
                                <button
                                    onClick={() => setShowTagFilter(!showTagFilter)}
                                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                        selectedTags.length > 0
                                            ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600'
                                    }`}
                                >
                                    Tags{selectedTags.length > 0 ? ` (${selectedTags.length})` : ''}
                                    <span className="text-[10px] ml-0.5">{showTagFilter ? '▲' : '▼'}</span>
                                </button>
                                <div className="flex-1" />
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                    {filteredItems.length.toLocaleString()} item{filteredItems.length !== 1 ? 's' : ''}
                                    {allDates.length > 0 && ` · ${allDates.length} date${allDates.length !== 1 ? 's' : ''}`}
                                </span>
                                {activeFilterCount > 0 && (
                                    <button onClick={clearAllFilters} className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 underline transition-colors">
                                        Clear all
                                    </button>
                                )}
                            </div>

                            {/* Tag panel */}
                            {showTagFilter && (
                                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100 dark:border-slate-700/50 max-h-32 overflow-y-auto">
                                    {uniqueTags.map(tag => (
                                        <button
                                            key={tag}
                                            onClick={() => toggleTag(tag)}
                                            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                                                selectedTags.includes(tag)
                                                    ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700'
                                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-slate-700 dark:text-gray-300 dark:border-slate-600 dark:hover:bg-slate-600'
                                            }`}
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
                                {[1, 2].map(i => (
                                    <div key={i} className="mb-8">
                                        <div className="h-5 w-44 bg-gray-200 dark:bg-slate-700 rounded animate-pulse mb-3" />
                                        <SkeletonGroup />
                                        <SkeletonGroup />
                                        <SkeletonGroup />
                                    </div>
                                ))}
                            </>
                        ) : filteredItems.length === 0 ? (
                            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 p-16 text-center">
                                <p className="text-4xl mb-3">🍽️</p>
                                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing found</p>
                                <p className="text-sm text-gray-400 dark:text-gray-500">
                                    {showFavorites && favorites.length === 0
                                        ? 'Star items in Browse to save favorites here.'
                                        : 'Try adjusting your filters.'}
                                </p>
                            </div>
                        ) : (
                            <>
                                {visibleDates.map(date => {
                                    const mealMap = grouped.get(date)!;
                                    return (
                                        <div key={date} className="mb-8">
                                            {/* Date heading */}
                                            <div className="flex items-center gap-2.5 mb-3">
                                                <h2 className="text-base font-bold text-gray-900 dark:text-white">
                                                    {formatLongDate(date)}
                                                </h2>
                                                {date === today && (
                                                    <span className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                                                        Today
                                                    </span>
                                                )}
                                            </div>

                                            {/* One card per meal × hall */}
                                            <div className="space-y-3">
                                                {[...mealMap.entries()]
                                                    .sort(([a], [b]) => MEALS.indexOf(a) - MEALS.indexOf(b))
                                                    .flatMap(([meal, hallMap]) =>
                                                        [...hallMap.entries()]
                                                            .sort(([a], [b]) => a.localeCompare(b))
                                                            .map(([hall, stationMap]) => (
                                                                <div
                                                                    key={`${meal}-${hall}`}
                                                                    className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/50 overflow-hidden"
                                                                >
                                                                    {/* Card header: meal badge + hall name */}
                                                                    <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50 dark:bg-slate-700/40 border-b border-gray-100 dark:border-slate-700/50">
                                                                        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${MEAL_COLORS[meal] ?? 'bg-gray-100 text-gray-600'}`}>
                                                                            {meal}
                                                                        </span>
                                                                        <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{hall}</span>
                                                                    </div>

                                                                    {/* Station groups → item rows */}
                                                                    {[...stationMap.entries()].map(([station, stationItems]) => (
                                                                        <div key={station}>
                                                                            {station && (
                                                                                <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 bg-gray-50/60 dark:bg-slate-900/20 border-b border-gray-100 dark:border-slate-700/30">
                                                                                    {station}
                                                                                </div>
                                                                            )}
                                                                            {stationItems.map((item, idx) => {
                                                                                const isFav = favorites.includes(item.item_key);
                                                                                return (
                                                                                    <div
                                                                                        key={`${item.item_key}-${idx}`}
                                                                                        className={`flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-slate-700/30 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors ${isFav ? 'bg-yellow-50/60 dark:bg-yellow-900/10' : ''}`}
                                                                                    >
                                                                                        <button
                                                                                            onClick={() => toggleFavorite(item.item_key)}
                                                                                            className={`text-lg shrink-0 transition-all hover:scale-110 active:scale-95 ${isFav ? 'text-yellow-400' : 'text-gray-200 dark:text-slate-700 hover:text-yellow-400'}`}
                                                                                            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                                                                        >
                                                                                            {isFav ? '★' : '☆'}
                                                                                        </button>
                                                                                        <span className="flex-1 text-sm font-medium text-gray-900 dark:text-white min-w-0 truncate">
                                                                                            {item.item_display}
                                                                                        </span>
                                                                                        {/* Tags — hidden on small screens to keep rows compact */}
                                                                                        <div className="hidden sm:flex items-center gap-1 shrink-0">
                                                                                            {item.nutrient_density && (
                                                                                                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                                                                                    ND: {item.nutrient_density}
                                                                                                </span>
                                                                                            )}
                                                                                            {item.carbon_footprint && (
                                                                                                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                                                                                    CF: {item.carbon_footprint}
                                                                                                </span>
                                                                                            )}
                                                                                            {item.other_tags.slice(0, 2).map(tag => (
                                                                                                <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                                                                                                    {tag}
                                                                                                </span>
                                                                                            ))}
                                                                                            {item.other_tags.length > 2 && (
                                                                                                <span className="text-xs text-gray-400 dark:text-slate-500">
                                                                                                    +{item.other_tags.length - 2}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                        {/* Calories with macro tooltip */}
                                                                                        {item.nutrition?.calories != null ? (
                                                                                            <div className="group relative shrink-0">
                                                                                                <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums cursor-default">
                                                                                                    {item.nutrition.calories} kcal
                                                                                                </span>
                                                                                                <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-40 bg-gray-900 dark:bg-slate-700 text-white text-xs rounded-xl p-2.5 z-10 shadow-xl pointer-events-none">
                                                                                                    <div className="space-y-1">
                                                                                                        {item.nutrition.serving_size && (
                                                                                                            <div className="pb-1 mb-1 border-b border-white/15 text-gray-300">
                                                                                                                {item.nutrition.serving_size}
                                                                                                            </div>
                                                                                                        )}
                                                                                                        {item.nutrition.total_fat && <div className="flex justify-between"><span className="text-gray-400">Fat</span><span>{item.nutrition.total_fat}</span></div>}
                                                                                                        {item.nutrition.total_carbohydrate && <div className="flex justify-between"><span className="text-gray-400">Carbs</span><span>{item.nutrition.total_carbohydrate}</span></div>}
                                                                                                        {item.nutrition.protein && <div className="flex justify-between"><span className="text-gray-400">Protein</span><span>{item.nutrition.protein}</span></div>}
                                                                                                        {item.nutrition.sodium && <div className="flex justify-between"><span className="text-gray-400">Sodium</span><span>{item.nutrition.sodium}</span></div>}
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        ) : (
                                                                                            <span className="text-xs text-gray-200 dark:text-slate-700 shrink-0 tabular-nums">—</span>
                                                                                        )}
                                                                                        <button
                                                                                            onClick={() => addToCalendar(item)}
                                                                                            className="text-gray-300 dark:text-slate-700 hover:text-blue-500 dark:hover:text-blue-400 transition-colors text-sm shrink-0"
                                                                                            title="Add to Google Calendar"
                                                                                        >
                                                                                            📅
                                                                                        </button>
                                                                                        {(() => {
                                                                                            const rowId = entryId({
                                                                                                item_key: item.item_key,
                                                                                                hall: item.hall,
                                                                                                station: item.station ?? '',
                                                                                            });
                                                                                            const onPlate = getPlate(item.date, item.meal)
                                                                                                .items.find(e => entryId(e) === rowId);
                                                                                            const btn = 'w-6 h-6 rounded-lg text-xs font-bold shrink-0 transition-colors leading-none';
                                                                                            const plain = 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400 dark:hover:bg-slate-600';

                                                                                            if (!onPlate) {
                                                                                                return (
                                                                                                    <button
                                                                                                        onClick={() => addToPlate(item)}
                                                                                                        className={`${btn} ${plain}`}
                                                                                                        title="Add to plate"
                                                                                                    >
                                                                                                        +
                                                                                                    </button>
                                                                                                );
                                                                                            }

                                                                                            // At the minimum there is no lower step, so the
                                                                                            // control turns into an explicit remove.
                                                                                            const atMin = onPlate.servings <= MIN_SERVINGS;
                                                                                            return (
                                                                                                <div className="flex items-center gap-0.5 shrink-0">
                                                                                                    <button
                                                                                                        onClick={() => decrementItem(item.date, item.meal, rowId)}
                                                                                                        className={`${btn} ${atMin
                                                                                                            ? 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60'
                                                                                                            : plain}`}
                                                                                                        title={atMin ? 'Remove from plate' : 'Fewer servings'}
                                                                                                    >
                                                                                                        {atMin ? '×' : '−'}
                                                                                                    </button>
                                                                                                    <span className="w-6 text-center text-xs font-bold tabular-nums text-[#00274C] dark:text-blue-300">
                                                                                                        {onPlate.servings}
                                                                                                    </span>
                                                                                                    <button
                                                                                                        onClick={() => addToPlate(item)}
                                                                                                        className={`${btn} bg-[#00274C] text-white hover:bg-[#003870] dark:bg-[#003870] dark:hover:bg-[#004a94]`}
                                                                                                        title="More servings"
                                                                                                    >
                                                                                                        +
                                                                                                    </button>
                                                                                                </div>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ))
                                                    )
                                                }
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* ── Pagination ── */}
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between mt-4">
                                        <span className="text-sm text-gray-400 dark:text-gray-500">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                disabled={currentPage === 1}
                                                className="px-4 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                            >
                                                ← Prev
                                            </button>
                                            <button
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                disabled={currentPage === totalPages}
                                                className="px-4 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                            >
                                                Next →
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </main>

            <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-center">
                <p className="text-xs text-gray-300 dark:text-slate-700">
                    Michigan Food Finder · Not affiliated with the University of Michigan
                </p>
                <a
                    href="https://github.com/BereZone/MichiganFoodFinder/blob/main/CHANGELOG.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View changelog"
                    className="inline-block mt-2 px-2 py-0.5 rounded-full border border-gray-200 dark:border-slate-800 text-[10px] font-mono tabular-nums text-gray-300 dark:text-slate-700 hover:text-gray-500 dark:hover:text-slate-500 hover:border-gray-300 dark:hover:border-slate-700 transition-colors"
                >
                    v{__APP_VERSION__}
                </a>
            </footer>
        </div>
    );
};

export default MenuFinder;
