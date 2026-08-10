// Pure menu-page parser shared by the extension (offscreen.js) and node tests.
// Mirrors parse_menu_html in scrape_menus.py — keep the two in sync.
//
// Markup as of mid-2026: meals are <h3> headers followed by a content <div>;
// stations are <ul class=courses_wrapper> > <li> with an <h4>; items are
// <li> entries in <ul class=items> with a .item-name (span, formerly div),
// tags in <ul class=traits>, and the nutrition table in a <div class=nutrition>
// that is the item li's NEXT SIBLING (older markup kept it inside the li —
// both are handled).

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

function parseTags(text) {
    const head = norm(text.split(/\b(?:close|Contains:|Nutrition Facts|Serving Size)\b/i)[0]);
    const nd = ND_RX.test(head) ? normalizeNd(head.match(ND_RX)[1]) : '';
    const cfM = head.match(CF_RX);
    const cf = cfM ? normalizeCf(cfM[1] || cfM[2]) : '';
    const others = Object.entries(TAG_RXES).filter(([, rx]) => rx.test(head)).map(([t]) => t).sort();
    return { nd, cf, others };
}

function parseNutrition(el) {
    const nut = { calories: null, serving_size: null, total_fat: null, total_carbohydrate: null, protein: null, sodium: null };
    if (!el) return nut;
    const calTr = el.querySelector('tr.portion-calories');
    if (calTr) {
        const m = norm(calTr.textContent).match(/Calories\s+(\d+)/i);
        if (m) nut.calories = parseInt(m[1], 10);
    }
    // Opaque display text, e.g. "1/2 Cup (113g)" — see scrape_menus.py.
    const sizeTr = el.querySelector('tr.serving-size');
    if (sizeTr) {
        const m = norm(sizeTr.textContent).match(/Serving\s*Size\s*(.+)/i);
        if (m && m[1].trim()) nut.serving_size = m[1].trim();
    }
    const findVal = (labelRx) => {
        for (const td of el.querySelectorAll('td')) {
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
                for (const li of itemsUl.querySelectorAll(':scope > li')) {
                    const nameEl = li.querySelector('.item-name');
                    if (!nameEl) continue;
                    const display = norm(nameEl.textContent);
                    if (!display) continue;
                    const key = itemKey(display);
                    const uid = `${key}|${station}`;
                    if (seen.has(uid)) continue;
                    seen.add(uid);

                    const traitsEl = li.querySelector('ul.traits');
                    const { nd, cf, others } = parseTags(norm((traitsEl || li).textContent));

                    let nutEl = li.nextElementSibling;
                    if (!(nutEl && nutEl.tagName === 'DIV' && nutEl.classList.contains('nutrition'))) nutEl = li;

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
                        nutrition: parseNutrition(nutEl),
                    });
                }
            }
        }
    }
    return results;
}

if (typeof module !== 'undefined') {
    module.exports = { WEEKDAY_MEALS, WEEKEND_MEALS, DINING_HALLS, norm, itemKey, parseTags, parseNutrition, parseDayHall };
}
