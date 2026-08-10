const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Create the client once (outside the handler) so warm lambda invocations reuse it.
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;

const DAYS_AHEAD = 14;
const PAGE_SIZE = 1000; // Supabase caps responses at 1000 rows by default

// Today's date (YYYY-MM-DD) in America/Detroit, regardless of server timezone.
function getDetroitToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
}

// Add days to a YYYY-MM-DD string without timezone drift.
function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Normalize whatever Postgres/supabase-js returns for a date column to YYYY-MM-DD.
function normalizeDate(value) {
    if (typeof value === 'string') return value.slice(0, 10);
    return new Date(value).toISOString().slice(0, 10);
}

// Fetch all offerings in [startDate, endDate], paginating past the 1000-row cap.
async function fetchAllOfferings(startDate, endDate) {
    const rows = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('offerings')
            .select(
                'date, hall, meal, station, nutrient_density, carbon_footprint, tags, ' +
                'calories, serving_size, total_fat, total_carbohydrate, protein, sodium, scraped_at, ' +
                'items ( name, item_key )'
            )
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: true })
            .order('id', { ascending: true }) // stable order so pages don't overlap
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return rows;
}

function toLegacyShape(rows, startDate, endDate) {
    let lastUpdated = null;

    const menus = rows.map((row) => {
        if (row.scraped_at && (!lastUpdated || row.scraped_at > lastUpdated)) {
            lastUpdated = row.scraped_at;
        }

        const item = row.items || {};
        const name = item.name || '';
        const otherTags = Array.isArray(row.tags) ? row.tags : [];

        return {
            item: name,
            item_display: name,
            item_key: item.item_key || '',
            meal: row.meal,
            hall: row.hall,
            date: normalizeDate(row.date),
            station: row.station,
            nutrient_density: row.nutrient_density,
            carbon_footprint: row.carbon_footprint,
            other_tags: otherTags,
            other_tags_str: otherTags.join(','),
            nutrition: {
                calories: row.calories,
                serving_size: row.serving_size ?? null,
                total_fat: row.total_fat,
                total_carbohydrate: row.total_carbohydrate,
                protein: row.protein,
                sodium: row.sodium,
            },
        };
    });

    return {
        last_updated: lastUpdated
            ? new Date(lastUpdated).toISOString()
            : new Date().toISOString(),
        date_range: { start: startDate, end: endDate },
        total_items: menus.length,
        menus,
    };
}

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

    if (!supabase) {
        res.status(500).json({ error: 'Supabase env vars not configured (SUPABASE_URL / SUPABASE_ANON_KEY)' });
        return;
    }

    try {
        const startDate = getDetroitToday();
        const endDate = addDays(startDate, DAYS_AHEAD);

        const rows = await fetchAllOfferings(startDate, endDate);
        const payload = toLegacyShape(rows, startDate, endDate);

        // Set Vercel CDN Cache Control
        // s-maxage=3600: Cache on Vercel's Edge Network for 1 hour
        // stale-while-revalidate=600: Serve stale content for up to 10 mins while fetching new data in background
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

        res.status(200).json(payload);
    } catch (error) {
        console.error('Error in /api/menus:', error);
        res.status(500).json({ error: 'Failed to fetch menu data' });
    }
};
