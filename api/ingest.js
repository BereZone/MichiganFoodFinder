const { createClient } = require('@supabase/supabase-js');

// Ingest endpoint for the browser-relay extension (see docs/browser-relay.md).
// Auth: shared secret in the x-ingest-token header (INGEST_TOKEN env var).
// Writes use the service role key, which bypasses RLS — never expose it client-side.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INGEST_TOKEN = process.env.INGEST_TOKEN;

const supabase = SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

const MAX_ROWS = 20000;
const CHUNK = 500;

function todayInDetroit() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
}

function chunked(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function validRow(r) {
    return r && typeof r === 'object'
        && typeof r.item_key === 'string' && r.item_key.length > 0
        && typeof r.item_display === 'string' && r.item_display.length > 0
        && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')
        && typeof r.hall === 'string' && r.hall.length > 0
        && typeof r.meal === 'string' && r.meal.length > 0;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Ingest-Token');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!INGEST_TOKEN || !supabase) {
        res.status(500).json({ error: 'Ingest env vars not configured (INGEST_TOKEN / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
        return;
    }
    if (req.headers['x-ingest-token'] !== INGEST_TOKEN) {
        res.status(401).json({ error: 'Invalid ingest token' });
        return;
    }

    const rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
        res.status(400).json({ error: 'Body must be {"rows": [...]} with at least one row — refusing to touch the database with an empty payload' });
        return;
    }
    if (rows.length > MAX_ROWS) {
        res.status(413).json({ error: `Too many rows (${rows.length} > ${MAX_ROWS}) — send one day per request` });
        return;
    }
    const bad = rows.findIndex((r) => !validRow(r));
    if (bad !== -1) {
        res.status(400).json({ error: `Row ${bad} is malformed (need item_key, item_display, date YYYY-MM-DD, hall, meal)` });
        return;
    }

    try {
        // 1. Upsert canonical items, collect ids
        const nameByKey = new Map();
        for (const r of rows) nameByKey.set(r.item_key, r.item_display);
        const idByKey = new Map();
        for (const chunk of chunked([...nameByKey], CHUNK)) {
            const { data, error } = await supabase
                .from('items')
                .upsert(chunk.map(([item_key, name]) => ({ item_key, name })), { onConflict: 'item_key' })
                .select('id,item_key');
            if (error) throw new Error(`items upsert: ${error.message}`);
            for (const it of data) idByKey.set(it.item_key, it.id);
        }

        // 2. Upsert offerings, deduped on the conflict target
        const offerings = new Map();
        for (const r of rows) {
            const item_id = idByKey.get(r.item_key);
            const station = r.station || '';
            const n = r.nutrition || {};
            offerings.set(`${r.date}|${r.hall}|${r.meal}|${station}|${item_id}`, {
                item_id,
                date: r.date,
                hall: r.hall,
                meal: r.meal,
                station,
                nutrient_density: r.nutrient_density || '',
                carbon_footprint: r.carbon_footprint || '',
                tags: Array.isArray(r.other_tags) ? r.other_tags : [],
                calories: Number.isInteger(n.calories) ? n.calories : null,
                serving_size: n.serving_size ?? null,
                total_fat: n.total_fat ?? null,
                total_carbohydrate: n.total_carbohydrate ?? null,
                protein: n.protein ?? null,
                sodium: n.sodium ?? null,
                scraped_at: new Date().toISOString(),
            });
        }
        const keptByGroup = new Map(); // "date|hall|meal" -> [ids]
        for (const chunk of chunked([...offerings.values()], CHUNK)) {
            const { data, error } = await supabase
                .from('offerings')
                .upsert(chunk, { onConflict: 'date,hall,meal,station,item_id' })
                .select('id,date,hall,meal');
            if (error) throw new Error(`offerings upsert: ${error.message}`);
            for (const o of data) {
                const g = `${o.date}|${o.hall}|${o.meal}`;
                if (!keptByGroup.has(g)) keptByGroup.set(g, []);
                keptByGroup.get(g).push(o.id);
            }
        }

        // 3. Remove future-dated offerings that dropped off the menu, but only
        //    within (date, hall, meal) groups this payload actually covered.
        const today = todayInDetroit();
        let removed = 0;
        for (const [g, ids] of keptByGroup) {
            const [date, hall, meal] = g.split('|');
            if (date < today) continue;
            const { count, error } = await supabase
                .from('offerings')
                .delete({ count: 'exact' })
                .eq('date', date).eq('hall', hall).eq('meal', meal)
                .not('id', 'in', `(${ids.join(',')})`);
            if (error) throw new Error(`stale cleanup: ${error.message}`);
            removed += count || 0;
        }

        res.status(200).json({ items: nameByKey.size, offerings: offerings.size, removed });
    } catch (error) {
        console.error('Error in /api/ingest:', error);
        res.status(500).json({ error: String(error.message || error) });
    }
};
