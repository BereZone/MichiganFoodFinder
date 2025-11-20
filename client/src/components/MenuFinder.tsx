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

    // Data States
    const [favorites, setFavorites] = useState<string[]>(() => {
        const saved = localStorage.getItem('umich-dining-favorites');
        return saved ? JSON.parse(saved) : [];
    });
    const [currentPage, setCurrentPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

    // Load initial data
    useEffect(() => {
        const fetchMenus = async () => {
            setLoading(true);
            setError(null);

            try {
                const response = await fetch('/menus.json');
                if (!response.ok) {
                    throw new Error('Failed to load menu data');
                }
                const data = await response.json();

                // Sort menus by date then item name
                const sortedMenus = data.menus.sort((a: MenuItem, b: MenuItem) =>
                    a.date.localeCompare(b.date) || a.item_display.localeCompare(b.item_display)
                );

                setItems(sortedMenus);
                setLastUpdated(data.last_updated);
                setDateRange(data.date_range);
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

        // Logic:
        // Breakfast: < 10:30 AM
        // Dinner: >= 4:30 PM (16.5)
        // Lunch (Weekday): 10:30 AM - 4:30 PM
        // Lunch (Weekend): 10:30 AM - 2:00 PM (14.0)

        if (time < 10.5) {
            meal = 'Breakfast';
        } else if (time >= 16.5) {
            meal = 'Dinner';
        } else {
            // It's between 10:30 AM and 4:30 PM
            if (isWeekend) {
                // On weekends, Lunch ends at 2 PM
                if (time < 14.0) {
                    meal = 'Lunch';
                    // Note: Some halls might serve Brunch, but we'll stick to Lunch as requested.
                    // If we wanted to be smarter, we could check if 'Brunch' exists in the data.
                } else {
                    // Gap between 2 PM and 4:30 PM on weekends
                    // Default to upcoming Dinner
                    meal = 'Dinner';
                }
            } else {
                // Weekdays: Lunch runs until Dinner starts
                meal = 'Lunch';
            }
        }

        // Check if date exists in our data (might be out of range)
        if (uniqueDates.includes(dateStr)) {
            setSelectedDate(dateStr);
        } else {
            // If today isn't in range (e.g. late night scrape), default to first available
            setSelectedDate(uniqueDates[0] || '');
        }

        setSelectedMeal(meal);
        setSearchTerm('');
        setSelectedHalls([]);
        setSelectedTags([]);
        setShowFavorites(false);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center min-h-screen text-red-600">
                {error}
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 sm:p-8 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8 text-center">
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-2">
                        UMich Dining Menu Finder
                    </h1>
                    <p className="text-gray-600 mb-2">
                        Explore menus across campus{dateRange && ` from ${dateRange.start} to ${dateRange.end}`}.
                    </p>
                    {lastUpdated && (
                        <p className="text-xs text-gray-500">
                            Last updated: {new Date(lastUpdated).toLocaleString()}
                        </p>
                    )}
                    <div className="mt-4 mx-auto max-w-2xl flex flex-col gap-2 items-center">
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-gray-700 w-full">
                            <p className="font-medium text-yellow-800 mb-1">⚠️ Disclaimer</p>
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

                <div className="bg-white rounded-xl shadow-lg p-6 mb-8 transition-all duration-300 hover:shadow-xl">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Search */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-1">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Search Item
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Date
                            </label>
                            <select
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Meal
                            </label>
                            <select
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
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
                                    ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                    }`}
                            >
                                <span>{showFavorites ? '★' : '☆'}</span>
                                {showFavorites ? 'Showing Favorites' : 'Show Favorites'}
                            </button>
                        </div>

                        {/* Hall Filter */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Dining Halls
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {DINING_HALLS.map(hall => (
                                    <button
                                        key={hall}
                                        onClick={() => toggleHall(hall)}
                                        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${selectedHalls.includes(hall)
                                            ? 'bg-blue-600 text-white shadow-md'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        {hall}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tag Filter */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-4 border-t pt-4 mt-2">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Filter by Tags
                            </label>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                {uniqueTags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => toggleTag(tag)}
                                        className={`px-2 py-1 rounded text-xs font-medium transition-colors duration-200 border ${selectedTags.includes(tag)
                                            ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                            }`}
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">Fav</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meal</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hall</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tags</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {paginatedItems.map((item, idx) => {
                                    const isFav = favorites.includes(item.item_key);
                                    return (
                                        <tr key={`${item.item_key}-${item.date}-${item.meal}-${item.hall}-${idx}`} className={`hover:bg-gray-50 transition-colors ${isFav ? 'bg-yellow-50' : ''}`}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <button
                                                    onClick={() => toggleFavorite(item.item_key)}
                                                    className={`text-xl focus:outline-none transition-transform hover:scale-110 ${isFav ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
                                                    title={isFav ? "Remove from favorites" : "Add to favorites"}
                                                >
                                                    {isFav ? '★' : '☆'}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{item.item_display}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">{item.date}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.meal === 'Breakfast' ? 'bg-yellow-100 text-yellow-800' :
                                                    item.meal === 'Lunch' ? 'bg-green-100 text-green-800' :
                                                        'bg-indigo-100 text-indigo-800'
                                                    }`}>
                                                    {item.meal}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">{item.hall}</td>
                                            <td className="px-6 py-4 text-sm text-gray-500">
                                                <div className="flex flex-wrap gap-1">
                                                    {item.nutrient_density && (
                                                        <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800" title="Nutrient Density">
                                                            ND: {item.nutrient_density}
                                                        </span>
                                                    )}
                                                    {item.carbon_footprint && (
                                                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800" title="Carbon Footprint">
                                                            CF: {item.carbon_footprint}
                                                        </span>
                                                    )}
                                                    {item.other_tags.map(tag => (
                                                        <span key={tag} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {paginatedItems.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
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
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                        <div className="text-sm text-gray-500">
                            Showing {filteredItems.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)} of {filteredItems.length} results
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                &larr; Previous
                            </button>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="px-3 py-1 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
