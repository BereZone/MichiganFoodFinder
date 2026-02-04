const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// Configuration
const WEEKDAY_MEALS = ["Breakfast", "Lunch", "Dinner"];
const WEEKEND_MEALS = ["Brunch", "Dinner"];

const DINING_HALLS = {
    "Bursley": "https://dining.umich.edu/menus-locations/dining-halls/bursley/",
    "East Quad": "https://dining.umich.edu/menus-locations/dining-halls/east-quad/",
    "Markley": "https://dining.umich.edu/menus-locations/dining-halls/markley/",
    "Mosher-Jordan": "https://dining.umich.edu/menus-locations/dining-halls/mosher-jordan/",
    "North Quad": "https://dining.umich.edu/menus-locations/dining-halls/north-quad/",
    "Twigs at Oxford": "https://dining.umich.edu/menus-locations/dining-halls/twigs-at-oxford/",
    "South Quad": "https://dining.umich.edu/menus-locations/dining-halls/south-quad/",
};

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
};

// SSL Agent to match Python's certifi behavior (though Node usually handles this well)
const httpsAgent = new https.Agent({
    rejectUnauthorized: true,
});

// Regexes
const ND_RX = /\bNutrient\s*Dense\s*(Low\s*Medium|Medium\s*High|Low|Medium|High)\b/i;
const CF_RX = /\bCarbon\s*Footprint\s*(Low|Medium|High)\b|\bCO[2₂]\s*(Low|Medium|High)\b/i;

const TAG_RXES = {
    "GLUTEN FREE": /\bGluten\s*Free\b/i,
    "HALAL": /\bHalal\b/i,
    "KOSHER": /\bKosher\b/i,
    "SPICY": /\bSpicy\b/i,
    "VEGAN": /\bVegan\b/i,
    "VEGETARIAN": /\bVegetarian\b/i,
};

const PRETTY_OTHER = {
    "GLUTEN FREE": "Gluten Free",
    "HALAL": "Halal",
    "KOSHER": "Kosher",
    "SPICY": "Spicy",
    "VEGAN": "Vegan",
    "VEGETARIAN": "Vegetarian",
};

// Helpers
const normalizeSpaces = (s) => (s || "").replace(/\s+/g, " ").trim();

const itemKey = (name) => normalizeSpaces(name).toLowerCase();

const normalizeNd = (v) => {
    v = normalizeSpaces(v).toUpperCase().replace(" ", "");
    const mapping = {
        "LOW": "Low",
        "LOWMEDIUM": "Low/Medium",
        "MEDIUM": "Medium",
        "MEDIUMHIGH": "Medium/High",
        "HIGH": "High",
    };
    return mapping[v] || "";
};

const normalizeCf = (v) => {
    v = normalizeSpaces(v).toUpperCase();
    const mapping = { "LOW": "Low", "MEDIUM": "Medium", "HIGH": "High" };
    return mapping[v] || "";
};

const parseTagsFromLiText = (liText) => {
    // Limit to the portion before detail sections
    const head = normalizeSpaces(
        liText.split(/\b(close|Contains:|Nutrition Facts|Serving Size)\b/i)[0]
    );

    // Nutrient Density
    let nd = "";
    const mNd = head.match(ND_RX);
    if (mNd) {
        nd = normalizeNd(mNd[1]);
    }

    // Carbon Footprint
    let cf = "";
    const mCf = head.match(CF_RX);
    if (mCf) {
        const cfRaw = mCf[1] || mCf[2];
        cf = normalizeCf(cfRaw);
    }

    // Other tags
    const othersSet = new Set();
    for (const [label, rx] of Object.entries(TAG_RXES)) {
        if (rx.test(head)) {
            othersSet.add(PRETTY_OTHER[label] || label);
        }
    }
    const others = Array.from(othersSet).sort();
    const othersStr = others.join(", ");

    return { nd, cf, others, othersStr };
};

const fetchText = async (url) => {
    try {
        const response = await axios.get(url, {
            headers: HEADERS,
            httpsAgent,
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        console.error(`Failed to fetch ${url}:`, error.message);
        return "";
    }
};

const parseMenuForDayHall = async (hallName, baseUrl, date) => {
    const dateStr = date.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = dateStr === todayStr;

    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    const meals = (dayOfWeek > 0 && dayOfWeek < 6) ? WEEKDAY_MEALS : WEEKEND_MEALS;

    const url = isToday ? `${baseUrl}?date=${dateStr}` : `${baseUrl}?menuDate=${dateStr}`;
    const html = await fetchText(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const results = [];

    // Cache meal headers
    const mealHeader = {};
    $('h3').each((i, el) => {
        const a = $(el).find('a');
        if (a.length && a.text()) {
            const name = normalizeSpaces(a.text());
            mealHeader[name.toLowerCase()] = $(el);
        }
    });

    if (Object.keys(mealHeader).length === 0) {
        console.log(`No meal headers found for ${hallName} on ${dateStr}`);
    }

    for (const meal of meals) {
        const header = mealHeader[meal.toLowerCase()];
        if (!header) {
            continue;
        }

        // Try to find UL in siblings (sometimes direct, sometimes in a div)
        let ul = header.nextAll('ul').first();

        // If not found, maybe it's inside a div sibling?
        if (!ul.length) {
            ul = header.nextAll('div').find('ul').first();
        }

        if (!ul.length) {
            continue;
        }

        const items = ul.find('div.item-name');
        const seenForSection = new Set();

        items.each((i, el) => {
            const display = normalizeSpaces($(el).text());
            if (!display) return;

            const li = $(el).closest('li');
            const liText = li.length ? normalizeSpaces(li.text()) : display;
            const { nd, cf, others, othersStr } = parseTagsFromLiText(liText);

            // Extract Station Name
            // Structure: Station LI -> H4 (Name) + UL.items -> Item LI -> ... -> div.item-name
            const stationName = normalizeSpaces($(el).closest('ul.items').siblings('h4').text());

            const k = itemKey(display);
            if (seenForSection.has(k)) return;
            seenForSection.add(k);

            results.push({
                item: display,
                item_key: k,
                station: stationName || "Other", // Default to "Other" if no station found
                meal: meal,
                hall: hallName,
                date: dateStr,
                nutrient_density: nd,
                carbon_footprint: cf,
                other_tags: others,
                other_tags_str: othersStr,
            });
        });
    }
    return results;
};

const buildIndex = async (days = 14) => {
    const tasks = [];
    const startDate = new Date();

    for (let i = 0; i < days; i++) {
        const curDate = new Date(startDate);
        curDate.setDate(startDate.getDate() + i);

        for (const [hallName, base] of Object.entries(DINING_HALLS)) {
            tasks.push(parseMenuForDayHall(hallName, base, curDate));
        }
    }

    // Limit concurrency if needed, but Promise.all is usually fine for this scale
    const chunks = await Promise.all(tasks);
    const rows = chunks.flat();

    // Dedup item display names
    const firstDisplay = {};
    rows.forEach(r => {
        if (!firstDisplay[r.item_key]) {
            firstDisplay[r.item_key] = r.item;
        }
    });

    // Add item_display to all rows
    rows.forEach(r => {
        r.item_display = firstDisplay[r.item_key];
    });

    return rows;
};

const scrapeDate = async (date) => {
    const tasks = [];
    for (const [hallName, base] of Object.entries(DINING_HALLS)) {
        tasks.push(parseMenuForDayHall(hallName, base, date));
    }
    const chunks = await Promise.all(tasks);
    const rows = chunks.flat();

    // Dedup and add display names (same logic as buildIndex)
    const firstDisplay = {};
    rows.forEach(r => {
        if (!firstDisplay[r.item_key]) firstDisplay[r.item_key] = r.item;
    });
    rows.forEach(r => {
        r.item_display = firstDisplay[r.item_key];
    });
    return rows;
};

module.exports = { buildIndex, scrapeDate };
