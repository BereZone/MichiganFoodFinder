import React, { useState, useEffect, useMemo } from 'react';
import type { MenuItem } from '../types';

const DINING_HALLS = [
    "Bursley",
    "East Quad",
    "Markley",
    "Mosher-Jordan",
    "North Quad",
    "Twigs at Oxford",
    "South Quad",
];

const MEALS = ["Breakfast", "Brunch", "Lunch", "Dinner"];

const ITEMS_PER_PAGE = 20;

const MenuFinder: React.FC = () => {
    const [items, setItems] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter States
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedHalls, setSelectedHalls] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [selectedMeal, setSelectedMeal] = useState<string>('');
    const [showFavorites, setShowFavorites] = useState(false);

    // Theme State
    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('umich-dining-theme');
            if (saved) {
                return saved === 'dark';
            }
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return false;
    });

    // Data States
    const [favorites, setFavorites] = useState<string[]>(() => {
        const saved = localStorage.getItem('umich-dining-favorites');
        return saved ? JSON.parse(saved) : [];
    });
    const [currentPage, setCurrentPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

    // Apply Dark Mode
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

    // Load initial data
    useEffect(() => {
        const fetchMenus = async () => {
            setLoading(true);
            setError(null);

            try {
                // Fetch from the new dynamic API endpoint
                const response = await fetch('/api/menus');
                if (!response.ok) {
                    throw new Error('Failed to load menu data');
                }
                const data = await response.json();

                // The API now returns a flat list of items directly, or we might need to adapt if the structure matches exactly.
                // Our API returns a list of items directly.
                let menuItems: MenuItem[] = [];
                if (Array.isArray(data)) {
                    menuItems = data;
                } else if (data.menus) {
                    // Fallback if it matches old structure
                    menuItems = data.menus;
                }

                // Sort menus by date, then meal, then hall, then station, then item name
                const sortedMenus = menuItems.sort((a: MenuItem, b: MenuItem) => {
                    if (a.date !== b.date) return a.date.localeCompare(b.date);
                    if (a.meal !== b.meal) return MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal);
                    if (a.hall !== b.hall) return a.hall.localeCompare(b.hall);
                    if (a.station && b.station && a.station !== b.station) return a.station.localeCompare(b.station);
                    return a.item_display.localeCompare(b.item_display);
                });

                setItems(sortedMenus);
                // We'll trust the API is fresh. If we want metadata, we'd need to update the API to return it.
                // For now, let's set last updated to "Now" effectively, or just don't set it if the field is missing.
                setLastUpdated(new Date().toISOString());
                // Calculate date range from data
                if (sortedMenus.length > 0) {
                    const dates = sortedMenus.map(i => i.date).sort();
                    setDateRange({ start: dates[0], end: dates[dates.length - 1] });
                }
            } catch (err) {
                console.error("Error loading menus:", err);
                setError("Failed to load menu data. Please try refreshing.");
            } finally {
                setLoading(false);
            }
        };

        fetchMenus();
    }, []);

    // Sync URL -> State on Mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q');
        const halls = params.get('halls');
        const tags = params.get('tags');
        const date = params.get('date');
        const meal = params.get('meal');
        const favs = params.get('favs');

        if (q) setSearchTerm(q);
        if (halls) setSelectedHalls(halls.split(','));
        if (tags) setSelectedTags(tags.split(','));
        if (date) setSelectedDate(date);
        if (meal) setSelectedMeal(meal);
        if (favs === 'true') setShowFavorites(true);
    }, []);

    // Sync State -> URL on Change
    useEffect(() => {
        const params = new URLSearchParams();
        if (searchTerm) params.set('q', searchTerm);
        if (selectedHalls.length) params.set('halls', selectedHalls.join(','));
        if (selectedTags.length) params.set('tags', selectedTags.join(','));
        if (selectedDate) params.set('date', selectedDate);
        if (selectedMeal) params.set('meal', selectedMeal);
        if (showFavorites) params.set('favs', 'true');

        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
    }, [searchTerm, selectedHalls, selectedTags, selectedDate, selectedMeal, showFavorites]);

    // Persist Favorites
    useEffect(() => {
        localStorage.setItem('umich-dining-favorites', JSON.stringify(favorites));
    }, [favorites]);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, selectedHalls, selectedTags, selectedDate, selectedMeal, showFavorites]);

    const uniqueItemNames = useMemo(() => {
        const names = new Set(items.map(i => i.item_display));
        return Array.from(names).sort();
    }, [items]);

    const uniqueTags = useMemo(() => {
        const tags = new Set<string>();
        items.forEach(item => {
            item.other_tags.forEach(tag => tags.add(tag));
            if (item.nutrient_density) tags.add(`ND: ${item.nutrient_density}`);
            if (item.carbon_footprint) tags.add(`CF: ${item.carbon_footprint}`);
        });
        return Array.from(tags).sort();
    }, [items]);

    const uniqueDates = useMemo(() => {
        const dates = new Set(items.map(i => i.date));
        return Array.from(dates).sort();
    }, [items]);

    const filteredItems = useMemo(() => {
        return items.filter(item => {
            const matchesSearch = searchTerm === '' ||
                item.item.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesHall = selectedHalls.length === 0 ||
                selectedHalls.includes(item.hall);

            const matchesDate = selectedDate === '' || item.date === selectedDate;

            const matchesMeal = selectedMeal === '' || item.meal === selectedMeal;

            const matchesFavorites = !showFavorites || favorites.includes(item.item_key);

            const matchesTags = selectedTags.length === 0 || selectedTags.every(tag => {
                if (tag.startsWith('ND: ')) return item.nutrient_density === tag.replace('ND: ', '');
                if (tag.startsWith('CF: ')) return item.carbon_footprint === tag.replace('CF: ', '');
                return item.other_tags.includes(tag);
            });

            return matchesSearch && matchesHall && matchesDate && matchesMeal && matchesFavorites && matchesTags;
        });
    }, [items, searchTerm, selectedHalls, selectedDate, selectedMeal, selectedTags, showFavorites, favorites]);

    const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const toggleHall = (hall: string) => {
        setSelectedHalls(prev =>
            prev.includes(hall) ? prev.filter(h => h !== hall) : [...prev, hall]
        );
    };

    const toggleTag = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
        );
    };

    const toggleFavorite = (itemKey: string) => {
        setFavorites(prev =>
            prev.includes(itemKey) ? prev.filter(k => k !== itemKey) : [...prev, itemKey]
        );
    };

    const handleOpenNow = () => {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const day = now.getDay(); // 0 = Sunday, 6 = Saturday
        const isWeekend = day === 0 || day === 6;

        const hour = now.getHours();
        const minutes = now.getMinutes();
        const time = hour + minutes / 60;

        let meal = '';

        if (time < 10.5) {
            meal = 'Breakfast';
        } else if (time >= 16.5) {
            meal = 'Dinner';
        } else {
            if (isWeekend) {
                if (time < 14.0) {
                    meal = 'Lunch';
                } else {
                    meal = 'Dinner';
                }
            } else {
                meal = 'Lunch';
            }
        }

        if (uniqueDates.includes(dateStr)) {
            setSelectedDate(dateStr);
        } else {
            setSelectedDate(uniqueDates[0] || '');
        }

        setSelectedMeal(meal);
        setSearchTerm('');
        setSelectedHalls([]);
        setSelectedTags([]);
        setShowFavorites(false);
    };

    const addToCalendar = (item: MenuItem) => {
        const startTimeMap: Record<string, string> = {
            "Breakfast": "080000",
            "Brunch": "100000",
            "Lunch": "110000",
            "Dinner": "170000"
        };
        const endTimeMap: Record<string, string> = {
            "Breakfast": "100000",
            "Brunch": "140000",
            "Lunch": "140000",
            "Dinner": "200000"
        };

        const sTime = startTimeMap[item.meal] || "120000";
        const eTime = endTimeMap[item.meal] || "130000";
        const dateStr = item.date.replace(/-/g, '');

        const details = `Served at ${item.hall} for ${item.meal}.`;
        const location = item.hall;

        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(item.item_display)}&dates=${dateStr}T${sTime}/${dateStr}T${eTime}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;

        window.open(url, '_blank');
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-gray-50 dark:bg-gray-900 text-red-600 transition-colors duration-200">
                {error}
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 sm:p-8 font-sans text-gray-900 bg-gray-50 dark:bg-gray-900 dark:text-gray-100 transition-colors duration-200">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8 text-center relative">
                    <button
                        onClick={() => setDarkMode(!darkMode)}
                        className="absolute top-0 right-0 p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-yellow-300 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center gap-2 px-4"
                        title="Toggle Dark Mode"
                    >
                        <span>{darkMode ? '🌙' : '☀️'}</span>
                        <span className="text-xs font-medium">{darkMode ? 'Dark' : 'Light'}</span>
                    </button>

                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 mb-2">
                        UMich Dining Menu Finder
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mb-2">
                        Explore menus across campus{dateRange && ` from ${dateRange.start} to ${dateRange.end}`}.
                    </p>
                    {lastUpdated && (
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                            Last updated: {new Date(lastUpdated).toLocaleString()}
                        </p>
                    )}
                    <div className="mt-4 mx-auto max-w-2xl flex flex-col gap-2 items-center">
                        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 w-full">
                            <p className="font-medium text-yellow-800 dark:text-yellow-500 mb-1">⚠️ Disclaimer</p>
                            <p className="text-xs">
                                This data is not 100% accurate. For the most up-to-date menu information,
                                please check the official dining hall menus on the day you plan to visit.
                            </p>
                        </div>
                        <button
                            onClick={handleOpenNow}
                            className="mt-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-full shadow-md transition-all transform hover:scale-105 flex items-center gap-2"
                        >
                            <span>🕒</span> What's Open Now?
                        </button>
                    </div>
                </header>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-8 transition-all duration-300 hover:shadow-xl">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Search */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Search Item
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white dark:bg-gray-700 dark:text-white"
                                    placeholder="e.g., Chicken..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    list="item-suggestions"
                                />
                                <datalist id="item-suggestions">
                                    {uniqueItemNames.slice(0, 50).map(name => (
                                        <option key={name} value={name} />
                                    ))}
                                </datalist>
                            </div>
                        </div>

                        {/* Date Filter */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Date
                            </label>
                            <select
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                            >
                                <option value="">All Dates</option>
                                {uniqueDates.map(date => (
                                    <option key={date} value={date}>{date}</option>
                                ))}
                            </select>
                        </div>

                        {/* Meal Filter */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Meal
                            </label>
                            <select
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                                value={selectedMeal}
                                onChange={(e) => setSelectedMeal(e.target.value)}
                            >
                                <option value="">All Meals</option>
                                {MEALS.map(meal => (
                                    <option key={meal} value={meal}>{meal}</option>
                                ))}
                            </select>
                        </div>

                        {/* Favorites Toggle */}
                        <div className="flex items-end pb-2">
                            <button
                                onClick={() => setShowFavorites(!showFavorites)}
                                className={`w-full px-4 py-2 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2 border ${showFavorites
                                    ? 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-300 dark:border-yellow-600'
                                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'
                                    }`}
                            >
                                <span>{showFavorites ? '★' : '☆'}</span>
                                {showFavorites ? 'Showing Favorites' : 'Show Favorites'}
                            </button>
                        </div>

                        {/* Hall Filter */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Dining Halls
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {DINING_HALLS.map(hall => (
                                    <button
                                        key={hall}
                                        onClick={() => toggleHall(hall)}
                                        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${selectedHalls.includes(hall)
                                            ? 'bg-blue-600 text-white shadow-md'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        {hall}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tag Filter */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-4 border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Filter by Tags
                            </label>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                {uniqueTags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => toggleTag(tag)}
                                        className={`px-2 py-1 rounded text-xs font-medium transition-colors duration-200 border ${selectedTags.includes(tag)
                                            ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-700'
                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-12">Fav</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Item</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Meal</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Hall</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Tags</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Nutrition</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Cal</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {paginatedItems.map((item, idx) => {
                                    const isFav = favorites.includes(item.item_key);
                                    const showStationHeader = idx === 0 || item.station !== paginatedItems[idx - 1].station;

                                    return (
                                        <React.Fragment key={`${item.item_key}-${item.date}-${item.meal}-${item.hall}-${idx}`}>
                                            {showStationHeader && item.station && (
                                                <tr className="bg-gray-100 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                                                    <td colSpan={8} className="px-6 py-2 text-sm font-bold text-yellow-700 dark:text-yellow-500 uppercase tracking-wider">
                                                        {item.station}
                                                    </td>
                                                </tr>
                                            )}
                                            <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${isFav ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}`}>
                                                <td className="px-2 py-4 whitespace-nowrap text-center">
                                                    <button
                                                        onClick={() => toggleFavorite(item.item_key)}
                                                        className={`text-xl focus:outline-none transition-transform hover:scale-110 ${isFav ? 'text-yellow-500' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'}`}
                                                        title={isFav ? "Remove from favorites" : "Add to favorites"}
                                                    >
                                                        {isFav ? '★' : '☆'}
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900 dark:text-white">{item.item_display}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">{item.date}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.meal === 'Breakfast' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                                                        item.meal === 'Lunch' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                                            'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
                                                        }`}>
                                                        {item.meal}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">{item.hall}</td>
                                                <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                                    <div className="flex flex-wrap gap-1">
                                                        {item.nutrient_density && (
                                                            <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" title="Nutrient Density">
                                                                ND: {item.nutrient_density}
                                                            </span>
                                                        )}
                                                        {item.carbon_footprint && (
                                                            <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" title="Carbon Footprint">
                                                                CF: {item.carbon_footprint}
                                                            </span>
                                                        )}
                                                        {item.other_tags.map(tag => (
                                                            <span key={tag} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                    {item.nutrition && item.nutrition.calories !== null ? (
                                                        <div className="group relative cursor-help">
                                                            <span className="font-medium text-gray-900 dark:text-gray-200">{item.nutrition.calories} kcal</span>
                                                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block w-48 bg-black text-white text-xs rounded p-2 z-10 shadow-lg">
                                                                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                                                    <span>Fat:</span> <span className="text-right">{item.nutrition.total_fat || '-'}</span>
                                                                    <span>Carbs:</span> <span className="text-right">{item.nutrition.total_carbohydrate || '-'}</span>
                                                                    <span>Protein:</span> <span className="text-right">{item.nutrition.protein || '-'}</span>
                                                                    <span>Sodium:</span> <span className="text-right">{item.nutrition.sodium || '-'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">
                                                    <button
                                                        onClick={() => addToCalendar(item)}
                                                        className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                                        title="Add to Google Calendar"
                                                    >
                                                        📅
                                                    </button>
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    );
                                })}
                                {paginatedItems.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                            {showFavorites && favorites.length === 0
                                                ? "You haven't added any favorites yet. Click the star icon next to an item to add it!"
                                                : "No items found matching your criteria."}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Controls */}
                    <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 flex items-center justify-between">
                        <div className="text-sm text-gray-500 dark:text-gray-300">
                            Showing {filteredItems.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)} of {filteredItems.length} results
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                &larr; Previous
                            </button>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next &rarr;
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MenuFinder;
