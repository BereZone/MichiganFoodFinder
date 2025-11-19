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

const ITEMS_PER_PAGE = 20;

const MenuFinder: React.FC = () => {
    const [items, setItems] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedHalls, setSelectedHalls] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [currentPage, setCurrentPage] = useState(1);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAllDays = async () => {
            setLoading(true);
            setError(null);
            const today = new Date();
            const promises = [];

            // Create 14 requests for the next 14 days
            for (let i = 0; i < 14; i++) {
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                const dateStr = date.toISOString().split('T')[0];

                // Fetch each day individually to avoid Vercel timeouts
                promises.push(
                    fetch(`/api/menus?date=${dateStr}`)
                        .then(res => {
                            if (!res.ok) throw new Error(`Failed to fetch ${dateStr}`);
                            return res.json();
                        })
                        .then(data => {
                            // Progressively update state as days arrive
                            setItems(prev => {
                                // Avoid duplicates if multiple requests return same items (unlikely but safe)
                                const newItems = [...prev, ...data];
                                // Sort by date then item name
                                return newItems.sort((a, b) =>
                                    a.date.localeCompare(b.date) || a.item_display.localeCompare(b.item_display)
                                );
                            });
                        })
                        .catch(err => console.error(`Error fetching ${dateStr}:`, err))
                );
            }

            try {
                // Wait for all to finish (or fail silently for individual days)
                await Promise.all(promises);
            } catch (err) {
                console.error("Error in parallel fetch:", err);
                setError("Some menu data failed to load. Please try refreshing.");
            } finally {
                setLoading(false);
            }
        };

        fetchAllDays();
    }, []);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, selectedHalls, selectedTags, selectedDate]);

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

            const matchesTags = selectedTags.length === 0 || selectedTags.every(tag => {
                if (tag.startsWith('ND: ')) return item.nutrient_density === tag.replace('ND: ', '');
                if (tag.startsWith('CF: ')) return item.carbon_footprint === tag.replace('CF: ', '');
                return item.other_tags.includes(tag);
            });

            return matchesSearch && matchesHall && matchesDate && matchesTags;
        });
    }, [items, searchTerm, selectedHalls, selectedDate, selectedTags]);

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

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-gray-50 text-red-600">
                {error}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8 text-center">
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-2">
                        UMich Dining Menu Finder
                    </h1>
                    <p className="text-gray-600">
                        Explore menus across campus for the next 14 days.
                    </p>
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

                        {/* Hall Filter */}
                        <div className="col-span-1 md:col-span-2">
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
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meal</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hall</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tags</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {paginatedItems.map((item, idx) => (
                                    <tr key={`${item.item_key}-${item.date}-${item.meal}-${item.hall}-${idx}`} className="hover:bg-gray-50 transition-colors">
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
                                ))}
                                {paginatedItems.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                            No items found matching your criteria.
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
