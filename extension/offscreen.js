// Offscreen document: fetches menu pages inside the user's browser session
// (so Cloudflare's clearance applies), parses them with the same rules as
// scrape_menus.py, and POSTs rows to the ingest endpoint one day at a time.

const DAYS_AHEAD = 14;
const CONCURRENCY = 4;
const WEEKDAY_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
const WEEKEND_MEALS = ['Brunch', 'Dinner'];

const DINING_HALLS = {
    'Bursley': 'https://dining.umich.edu/menus-locations/dining-halls/bursley/',
    'East Quad': 'https://dining.umich.edu/menus-locations/dining-halls/east-quad/',
    'Markley': 'https://dining.umich.edu/menus-locations/dining-halls/markley/',
    'Mosher-Jordan': 'https://dining.umich.edu/menus-locations/dining-halls/mosher-jordan/',
    'North Quad': 'https://dining.umich.edu/menus-locations/dining-halls/north-quad/',
    'Twigs at Oxford': 'https://dining.umich.edu/menus-locations/dining-halls/twigs-at-oxford/',
    'South Quad': 'https://dining.umich.edu/menus-locations/dining-halls/south-quad/',
};

const ND_RX = /Nutrient\s*Dense\s*(Low\s*Medium|Medium\s*High|Low|Medium|High)/i;
const CF_RX = /Carbon\s*Footprint\s*(Low|Medium|High)|CO[2₂]\s*(Low|Medium|High)/i;
const TAG_RXES = {
    'Gluten Free': /\bGluten\s*Free\b/i,
    'Halal': /\bHalal\b/i,
    'Kosher': /\bKosher\b/i,
    'Spicy': /\bSpicy\b/i,
    'Vegan': /\bVegan\b/i,
    'Vegetarian': /\bVegetarian\b/i,
};

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const itemKey = (s) => norm(s).toLowerCase();

function normalizeNd(v) {
    const m = { LOW: 'Low', LOWMEDIUM: 'Low/Medium', MEDIUM: 'Medium', MEDIUMHIGH: 'Medium/High', HIGH: 'High' };
    return m[norm(v).toUpperCase().replace(/ /g, '')] || '';
}

function normalizeCf(v) {
    const m = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };
    return m[norm(v).toUpperCase()] || '';
}

function parseTags(liText) {
    const head = norm(liText.split(/\b(?:close|Contains:|Nutrition Facts|Serving Size)\b/i)[0]);
    const nd = ND_RX.test(head) ? normalizeNd(head.match(ND_RX)[1]) : '';
    const cfM = head.match(CF_RX);
    const cf = cfM ? normalizeCf(cfM[1] || cfM[2]) : '';
    const others = Object.entries(TAG_RXES).filter(([, rx]) => rx.test(head)).map(([t]) => t).sort();
    return { nd, cf, others };
}

function parseNutrition(li) {
    const nut = { calories: null, total_fat: null, total_carbohydrate: null, protein: null, sodium: null };
    if (!li) return nut;
    const calTr = li.querySelector('tr.portion-calories');
    if (calTr) {
        const m = norm(calTr.textContent).match(/Calories\s+(\d+)/i);
        if (m) nut.calories = parseInt(m[1], 10);
    }
    const findVal = (labelRx) => {
        for (const td of li.querySelectorAll('td')) {
            const txt = norm(td.textContent);
            if (labelRx.test(txt)) {
                const m = txt.match(new RegExp(labelRx.source + String.raw`\s*(\d+(?:\.\d+)?(?:g|mg))`, 'i'));
                if (m) return m[1];
            }
        }
        return null;
    };
    nut.total_fat = findVal(/Total\s*Fat/i);
    nut.total_carbohydrate = findVal(/Total\s*Carbohydrate/i);
    nut.protein = findVal(/Protein/i);
    nut.sodium = findVal(/Sodium/i);
    return nut;
}

function parseDayHall(html, hallName, dateStr, meals) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = [];

    const mealHeader = {};
    for (const h of doc.querySelectorAll('h3')) {
        const a = h.querySelector('a');
        const txt = norm((a || h).textContent);
        if (txt) mealHeader[txt.toLowerCase()] = h;
    }

    for (const meal of meals) {
        const header = mealHeader[meal.toLowerCase()];
        if (!header) continue;

        let contentDiv = null;
        for (let sib = header.nextElementSibling; sib; sib = sib.nextElementSibling) {
            if (sib.tagName === 'DIV') { contentDiv = sib; break; }
            if (sib.tagName === 'H3') break;
        }
        if (!contentDiv) continue;

        for (const child of contentDiv.children) {
            if (child.tagName !== 'UL') continue;
            for (const stationLi of child.querySelectorAll(':scope > li')) {
                const h4 = stationLi.querySelector('h4');
                const station = h4 ? norm(h4.textContent) : '';
                const itemsUl = stationLi.querySelector('ul.items');
                if (!itemsUl) continue;

                const seen = new Set();
                for (const it of itemsUl.querySelectorAll('div.item-name')) {
                    const display = norm(it.textContent);
                    if (!display) continue;
                    const key = itemKey(display);
                    const uid = `${key}|${station}`;
                    if (seen.has(uid)) continue;
                    seen.add(uid);

                    const li = it.closest('li');
                    const liText = li ? norm(li.textContent) : display;
                    const { nd, cf, others } = parseTags(liText);

                    results.push({
                        item: display,
                        item_display: display,
                        item_key: key,
                        meal,
                        hall: hallName,
                        date: dateStr,
                        station,
                        nutrient_density: nd,
                        carbon_footprint: cf,
                        other_tags: others,
                        other_tags_str: others.join(', '),
                        nutrition: parseNutrition(li),
                    });
                }
            }
        }
    }
    return results;
}

function localDateStr(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function looksLikeChallenge(html) {
    return /Just a moment|challenges\.cloudflare\.com|cf-chl/i.test(html.slice(0, 4000));
}

async function fetchPage(url) {
    const resp = await fetch(url, { credentials: 'include' });
    const text = await resp.text();
    if (looksLikeChallenge(text)) throw Object.assign(new Error('cloudflare challenge'), { challenge: true });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return text;
}

function report(status) {
    chrome.runtime.sendMessage({ target: 'background', type: 'sync-status', status: { ...status, at: Date.now() } });
    chrome.runtime.sendMessage({ target: 'popup', type: 'sync-status', status: { ...status, at: Date.now() } }, () => void chrome.runtime.lastError);
}

let challengeWaiter = null;

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== 'offscreen') return;
    if (msg.type === 'sync') runSync(msg.ingestUrl, msg.ingestToken);
    if (msg.type === 'challenge-maybe-solved' && challengeWaiter) challengeWaiter();
});

async function runSync(ingestUrl, ingestToken) {
    try {
        // Challenge probe: one cheap request before fanning out 100+.
        try {
            await fetchPage(Object.values(DINING_HALLS)[0]);
        } catch (e) {
            if (!e.challenge) throw e;
            report({ state: 'progress', detail: 'Cloudflare challenge hit — opening a tab to clear it…' });
            await new Promise((resolve) => {
                challengeWaiter = resolve;
                chrome.runtime.sendMessage({ target: 'background', type: 'solve-challenge' });
                setTimeout(resolve, 40000); // failsafe
            });
            challengeWaiter = null;
            await fetchPage(Object.values(DINING_HALLS)[0]); // throws again if still blocked
        }

        const today = new Date();
        const todayStr = localDateStr(today);
        let totalRows = 0, totalDays = 0;
        const errors = [];

        for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
            const d = new Date(today);
            d.setDate(d.getDate() + offset);
            const dateStr = localDateStr(d);
            const meals = d.getDay() >= 1 && d.getDay() <= 5 ? WEEKDAY_MEALS : WEEKEND_MEALS;
            const param = dateStr === todayStr ? 'date' : 'menuDate';

            report({ state: 'progress', detail: `Fetching ${dateStr} (day ${offset + 1}/${DAYS_AHEAD + 1})…` });

            const entries = Object.entries(DINING_HALLS);
            const dayRows = [];
            for (let i = 0; i < entries.length; i += CONCURRENCY) {
                const batch = entries.slice(i, i + CONCURRENCY);
                const settled = await Promise.allSettled(batch.map(async ([hall, base]) => {
                    const html = await fetchPage(`${base}?${param}=${dateStr}`);
                    return parseDayHall(html, hall, dateStr, meals);
                }));
                for (let j = 0; j < settled.length; j++) {
                    if (settled[j].status === 'fulfilled') dayRows.push(...settled[j].value);
                    else errors.push(`${batch[j][0]} ${dateStr}: ${settled[j].reason}`);
                }
                await new Promise((r) => setTimeout(r, 250)); // be polite
            }

            if (dayRows.length === 0) continue; // nothing to send for this day

            const resp = await fetch(ingestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': ingestToken },
                body: JSON.stringify({ rows: dayRows }),
            });
            if (!resp.ok) {
                const body = await resp.text();
                throw new Error(`Ingest failed for ${dateStr}: HTTP ${resp.status} ${body.slice(0, 200)}`);
            }
            totalRows += dayRows.length;
            totalDays += 1;
        }

        if (totalRows === 0) {
            report({ state: 'error', reason: 'empty', detail: `Parsed 0 items across all days. ${errors.slice(0, 3).join(' | ')}` });
        } else {
            report({ state: 'done', detail: `Synced ${totalRows} rows across ${totalDays} day(s).${errors.length ? ` ${errors.length} page(s) failed.` : ''}` });
        }
    } catch (e) {
        report({ state: 'error', reason: e.challenge ? 'challenge' : 'other', detail: String(e.message || e) });
    }
}
