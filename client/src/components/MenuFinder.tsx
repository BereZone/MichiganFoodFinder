import React, { useState, useEffect, useMemo } from 'react';
import type { MenuItem } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useFavorites } from '../hooks/useFavorites';
import MyMenu from './MyMenu';

const DINING_HALLS = [
    'Bursley', 'East Quad', 'Markley', 'Mosher-Jordan',
    'North Quad', 'Twigs at Oxford', 'South Quad',
];

const MEALS = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'];
const ITEMS_PER_PAGE = 24;

const MEAL_COLORS: Record<string, string> = {
    Breakfast: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    Brunch:    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
    Lunch:     'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    Dinner:    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
};

function formatShortDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const SkeletonCard = () => (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden animate-pulse">
        <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <div className="h-5 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-4 w-24 bg-gray-100 dark:bg-slate-700/60 rounded" />
        </div>
        <div className="px-4 pb-4">
            <div className="h-4 w-3/4 bg-gray-200 dark:bg-slate-700 rounded mb-2" />
            <div className="h-3 w-1/2 bg-gray-100 dark:bg-slate-700/60 rounded" />
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-700/50 flex justify-between">
            <div className="h-3 w-14 bg-gray-100 dark:bg-slate-700/60 rounded" />
            <div className="h-3 w-5 bg-gray-100 dark:bg-slate-700/60 rounded" />
        </div>
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
    const [view, setView] = useState<'browse' | 'mymenu'>('browse');

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

    // Sync state → URL on change
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

    // Reset to page 1 whenever filters change
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

    const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const activeFilterCount = [
        !!searchTerm, !!selectedHalls.length, !!selectedTags.length,
        !!selectedDate, !!selectedMeal, showFavorites,
    ].filter(Boolean).length;

    const clearAllFilters = () => {
        setSearchTerm(''); setSelectedHalls([]); setSelectedTags([]);
        setSelectedDate(''); setSelectedMeal(''); setShowFavorites(false);
    };

    const toggleHall = (hall: string) =>
        setSelectedHalls(prev => prev.includes(hall) ? prev.filter(h => h !== hall) : [...prev, hall]);

    const toggleTag = (tag: string) =>
        setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

    const handleOpenNow = () => {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Detroit',
            year: 'numeric', month: '2-digit', day: '2-digit',
            weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(now);
        const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
        const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
        const isWeekend = get('weekday') === 'Sun' || get('weekday') === 'Sat';
        const time = parseInt(get('hour'), 10) + parseInt(get('minute'), 10) / 60;

        let meal = '';
        if (time < 10.5) {
            meal = 'Breakfast';
        } else if (time >= 16.5) {
            meal = 'Dinner';
        } else {
            if (isWeekend) {
                meal = time < 14.0 ? 'Lunch' : 'Dinner';
            } else {
                meal = 'Lunch';
            }
        }

        setSelectedDate(uniqueDates.includes(dateStr) ? dateStr : (uniqueDates[0] || ''));
        setSelectedMeal(meal);
        setSearchTerm(''); setSelectedHalls([]); setSelectedTags([]);
        setShowFavorites(false); setView('browse');
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
                    {/* Brand */}
                    <div className="flex items-center gap-2.5 shrink-0">
                        <div className="w-7 h-7 rounded-lg bg-[#00274C] flex items-center justify-center shrink-0 shadow-sm">
                            <span className="text-[#FFCB05] font-extrabold text-sm leading-none">M</span>
                        </div>
                        <span className="font-bold text-gray-900 dark:text-white text-sm hidden sm:block tracking-tight">
                            UMich Dining
                        </span>
                    </div>

                    {/* Auth + dark mode */}
                    <div className="flex items-center gap-2">
                        {authEnabled && (session ? (
                            <>
                                <span className="hidden md:block text-xs text-gray-400 dark:text-gray-500 max-w-[9rem] truncate">
                                    {session.user.email}
                                </span>
                                <button
                                    onClick={signOut}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors font-medium"
                                >
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={signIn}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium flex items-center gap-1.5"
                                title="Sign in to sync favorites across devices"
                            >
                                <span className="font-bold text-blue-600 dark:text-blue-400">G</span> Sign in
                            </button>
                        ))}
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
                            title="Toggle dark mode"
                        >
                            {darkMode ? '🌙' : '☀️'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">

                {/* ── Hero ── */}
                <div className="text-center mb-10">
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-[#00274C] dark:text-white tracking-tight mb-2">
                        UMich Dining
                    </h1>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                        {dateRange
                            ? `Menus ${formatShortDate(dateRange.start)} – ${formatShortDate(dateRange.end)}`
                            : 'Explore menus across campus'}
                    </p>
                    <button
                        onClick={handleOpenNow}
                        className="inline-flex items-center gap-2 px-7 py-2.5 bg-[#FFCB05] hover:bg-[#e6b800] text-[#00274C] font-bold rounded-full shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.03] active:scale-100 active:shadow-md"
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
                        {(['browse', 'mymenu'] as const).map(v => (
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
                                    : `★ My Menu${favorites.length > 0 ? ` (${favorites.length})` : ''}`}
                            </button>
                        ))}
                    </div>
                </div>

                {view === 'mymenu' ? (
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
                        {/* ── Error ── */}
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
                                    {filteredItems.length.toLocaleString()} result{filteredItems.length !== 1 ? 's' : ''}
                                </span>
                                {activeFilterCount > 0 && (
                                    <button
                                        onClick={clearAllFilters}
                                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 underline transition-colors"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>

                            {/* Tag panel (collapsible) */}
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
                            </div>
                        ) : paginatedItems.length === 0 ? (
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {paginatedItems.map((item, idx) => {
                                    const isFav = favorites.includes(item.item_key);
                                    return (
                                        <div
                                            key={`${item.item_key}-${item.date}-${item.meal}-${item.hall}-${idx}`}
                                            className={`flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-transparent overflow-hidden transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                                                isFav ? 'border-yellow-300/60 dark:border-yellow-500/30 ring-1 ring-yellow-300/40 dark:ring-yellow-500/20' : 'dark:border-slate-700/30'
                                            }`}
                                        >
                                            {/* Card header */}
                                            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${MEAL_COLORS[item.meal] ?? 'bg-gray-100 text-gray-600'}`}>
                                                        {item.meal}
                                                    </span>
                                                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{item.hall}</span>
                                                </div>
                                                <button
                                                    onClick={() => toggleFavorite(item.item_key)}
                                                    className={`ml-2 text-xl shrink-0 transition-all hover:scale-110 active:scale-95 ${
                                                        isFav ? 'text-yellow-400' : 'text-gray-200 dark:text-slate-700 hover:text-yellow-400'
                                                    }`}
                                                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                                >
                                                    {isFav ? '★' : '☆'}
                                                </button>
                                            </div>

                                            {/* Name + subtitle */}
                                            <div className="px-4 pb-3 flex-1">
                                                <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-snug">
                                                    {item.item_display}
                                                </h3>
                                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                                    {[item.station, formatShortDate(item.date)].filter(Boolean).join(' · ')}
                                                </p>
                                            </div>

                                            {/* Tags */}
                                            {(item.nutrient_density || item.carbon_footprint || item.other_tags.length > 0) && (
                                                <div className="px-4 pb-3 flex flex-wrap gap-1">
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
                                                    {item.other_tags.slice(0, 3).map(tag => (
                                                        <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                    {item.other_tags.length > 3 && (
                                                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500">
                                                            +{item.other_tags.length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Card footer: calories + calendar */}
                                            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-slate-900/40 border-t border-gray-100 dark:border-slate-700/50 mt-auto">
                                                {item.nutrition?.calories != null ? (
                                                    <div className="group relative">
                                                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 cursor-default select-none">
                                                            {item.nutrition.calories} kcal
                                                        </span>
                                                        <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block w-40 bg-gray-900 dark:bg-slate-700 text-white text-xs rounded-xl p-2.5 z-10 shadow-xl pointer-events-none">
                                                            <div className="space-y-1">
                                                                {item.nutrition.total_fat && <div className="flex justify-between"><span className="text-gray-400">Fat</span><span>{item.nutrition.total_fat}</span></div>}
                                                                {item.nutrition.total_carbohydrate && <div className="flex justify-between"><span className="text-gray-400">Carbs</span><span>{item.nutrition.total_carbohydrate}</span></div>}
                                                                {item.nutrition.protein && <div className="flex justify-between"><span className="text-gray-400">Protein</span><span>{item.nutrition.protein}</span></div>}
                                                                {item.nutrition.sodium && <div className="flex justify-between"><span className="text-gray-400">Sodium</span><span>{item.nutrition.sodium}</span></div>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-gray-300 dark:text-slate-700">—</span>
                                                )}
                                                <button
                                                    onClick={() => addToCalendar(item)}
                                                    className="text-gray-300 dark:text-slate-700 hover:text-blue-500 dark:hover:text-blue-400 transition-colors text-base"
                                                    title="Add to Google Calendar"
                                                >
                                                    📅
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* ── Pagination ── */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-8">
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
            </main>

            <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-center">
                <p className="text-xs text-gray-300 dark:text-slate-700">
                    UMich Dining Menu Finder · Not affiliated with the University of Michigan
                </p>
            </footer>
        </div>
    );
};

export default MenuFinder;
