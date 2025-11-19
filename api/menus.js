const { buildIndex } = require('./_lib/scraper');

// Simple in-memory cache (note: this resets when the lambda cold starts)
// For better caching, we rely on Vercel's CDN caching via headers.
let menuCache = null;
let lastFetch = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour in ms

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const now = Date.now();

        // If we have a warm cache, use it
        if (menuCache && (now - lastFetch < CACHE_DURATION)) {
            // Serve from memory
        } else {
            // Scrape
            console.log("Scraping fresh data...");

            if (req.query.date) {
                // Scrape a specific date (for parallel fetching)
                const targetDate = new Date(req.query.date);
                // We need to expose a way to scrape a single day in scraper.js or just use buildIndex with 1 day
                // But buildIndex starts from "today". We need to modify buildIndex or call parseMenuForDayHall directly.
                // Let's modify scraper.js to export parseMenuForDayHall or a buildDay function.
                // For now, let's assume we update scraper.js to export `scrapeDate`.
                const { scrapeDate } = require('./_lib/scraper');
                menuCache = await scrapeDate(targetDate);
            } else {
                // Legacy/Local mode
                const days = req.query.days ? parseInt(req.query.days) : 3;
                menuCache = await buildIndex(days);
            }

            lastFetch = now;
        }

        // Set Vercel CDN Cache Control
        // s-maxage=3600: Cache on Vercel's Edge Network for 1 hour
        // stale-while-revalidate=600: Serve stale content for up to 10 mins while fetching new data in background
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

        res.status(200).json(menuCache);
    } catch (error) {
        console.error("Error in /api/menus:", error);
        res.status(500).json({ error: "Failed to fetch menu data" });
    }
};
