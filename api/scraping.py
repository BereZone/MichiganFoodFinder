import asyncio
import aiohttp
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re
import ssl
import certifi
from collections import defaultdict

# =========================
# Configuration
# =========================
WEEKDAY_MEALS = ["Breakfast", "Lunch", "Dinner"]
WEEKEND_MEALS = ["Brunch", "Dinner"]

DINING_HALLS = {
    "Bursley": "https://dining.umich.edu/menus-locations/dining-halls/bursley/",
    "East Quad": "https://dining.umich.edu/menus-locations/dining-halls/east-quad/",
    "Markley": "https://dining.umich.edu/menus-locations/dining-halls/markley/",
    "Mosher-Jordan": "https://dining.umich.edu/menus-locations/dining-halls/mosher-jordan/",
    "North Quad": "https://dining.umich.edu/menus-locations/dining-halls/north-quad/",
    "Twigs at Oxford": "https://dining.umich.edu/menus-locations/dining-halls/twigs-at-oxford/",
    "South Quad": "https://dining.umich.edu/menus-locations/dining-halls/south-quad/",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://dining.umich.edu/",
}

# Create an SSL context using certifi
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

# Concurrency guard so we don't hammer the site
MAX_CONCURRENCY = 8

# =========================
# Helpers
# =========================
_normalize_spaces = lambda s: re.sub(r"\s+", " ", s or "").strip()

def item_key(name: str) -> str:
    """Casefolded key for dedup/search."""
    return _normalize_spaces(name).casefold()

# --- Regexes to pull tags from the parent <li> text ---
# Nutrient Density (handles Low/Medium combos)
ND_RX = re.compile(
    r"\bNutrient\s*Dense\s*(Low\s*Medium|Medium\s*High|Low|Medium|High)\b",
    re.I,
)
# Carbon Footprint or CO2
CF_RX = re.compile(
    r"\bCarbon\s*Footprint\s*(Low|Medium|High)\b|\bCO[2₂]\s*(Low|Medium|High)\b",
    re.I,
)
# Other tags we want to capture
TAG_RXES = {
    "GLUTEN FREE": re.compile(r"\bGluten\s*Free\b", re.I),
    "HALAL": re.compile(r"\bHalal\b", re.I),
    "KOSHER": re.compile(r"\bKosher\b", re.I),
    "SPICY": re.compile(r"\bSpicy\b", re.I),
    "VEGAN": re.compile(r"\bVegan\b", re.I),
    "VEGETARIAN": re.compile(r"\bVegetarian\b", re.I),
}

PRETTY_OTHER = {
    "GLUTEN FREE": "Gluten Free",
    "HALAL": "Halal",
    "KOSHER": "Kosher",
    "SPICY": "Spicy",
    "VEGAN": "Vegan",
    "VEGETARIAN": "Vegetarian",
}

def _normalize_nd(v: str) -> str:
    v = _normalize_spaces(v).upper().replace(" ", "")
    mapping = {
        "LOW": "Low",
        "LOWMEDIUM": "Low/Medium",
        "MEDIUM": "Medium",
        "MEDIUMHIGH": "Medium/High",
        "HIGH": "High",
    }
    return mapping.get(v, "")

def _normalize_cf(v: str) -> str:
    v = _normalize_spaces(v).upper()
    mapping = {"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High"}
    return mapping.get(v, "")

def parse_tags_from_li_text(li_text: str) -> tuple[str, str, list[str], str]:
    """
    Extract Nutrient Density, Carbon Footprint, and Other Tags from the full LI text.
    We do NOT rely on images; the words are in the same line as the item.
    Returns (nutrient_density, carbon_footprint, other_tags_list, other_tags_str)
    """
    # Limit to the portion before detail sections like "Contains"/"Nutrition Facts"
    head = _normalize_spaces(
        re.split(r"\b(close|Contains:|Nutrition Facts|Serving Size)\b", li_text, 1, flags=re.I)[0]
    )

    # Nutrient Density
    nd = ""
    m_nd = ND_RX.search(head)
    if m_nd:
        nd = _normalize_nd(m_nd.group(1))

    # Carbon Footprint
    cf = ""
    m_cf = CF_RX.search(head)
    if m_cf:
        cf_raw = m_cf.group(1) or m_cf.group(2)  # first alt, else second alt
        cf = _normalize_cf(cf_raw)

    # Other tags
    others_set = set()
    for label, rx in TAG_RXES.items():
        if rx.search(head):
            others_set.add(PRETTY_OTHER.get(label, label.title()))
    others = sorted(others_set)
    others_str = ", ".join(others)

    return nd, cf, others, others_str

async def fetch_text(session: aiohttp.ClientSession, url: str) -> str:
    try:
        async with session.get(url, headers=HEADERS, ssl=SSL_CONTEXT, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            return await resp.text()
    except Exception:
        return ""

async def parse_menu_for_day_hall(session, hall_name: str, base_url: str, date: datetime) -> list[dict]:
    date_str = date.strftime("%Y-%m-%d")
    is_today = (date.date() == datetime.today().date())
    meals = WEEKDAY_MEALS if date.weekday() < 5 else WEEKEND_MEALS

    # The UM site uses different query keys depending on whether it's today
    url = f"{base_url}?date={date_str}" if is_today else f"{base_url}?menuDate={date_str}"
    html = await fetch_text(session, url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")

    # We'll look for each meal's section, then list items
    results = []

    # h3 > a contains meal names (Breakfast/Lunch/Dinner/Brunch)
    h3s = soup.find_all("h3")
    # Cache: map lower meal name -> the h3 node
    meal_header = {}
    for h in h3s:
        a = h.find("a")
        if a and a.text:
            name = _normalize_spaces(a.text)
            meal_header[name.casefold()] = h

    for meal in meals:
        header = meal_header.get(meal.casefold())
        if not header:
            continue
        # The ul following the header contains items (div.item-name)
        ul = header.find_next("ul")
        if not ul:
            continue
        items = ul.find_all("div", class_="item-name")
        seen_for_section = set()
        for it in items:
            display = _normalize_spaces(it.get_text(strip=True))
            if not display:
                continue

            # Find the encompassing <li> and parse tags from its full text
            li = it.find_parent("li")
            li_text = _normalize_spaces(li.get_text(" ", strip=True)) if li else display
            nutrient_density, carbon_footprint, other_tags, other_tags_str = parse_tags_from_li_text(li_text)

            k = item_key(display)
            # Dedup within a hall/date/meal section
            if k in seen_for_section:
                continue
            seen_for_section.add(k)
            results.append({
                "item": display,
                "item_key": k,
                "meal": meal,
                "hall": hall_name,
                "date": date_str,
                "nutrient_density": nutrient_density,
                "carbon_footprint": carbon_footprint,
                "other_tags": other_tags,
                "other_tags_str": other_tags_str,
            })
    return results

async def build_index_async(start: datetime, end: datetime) -> list[dict]:
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async with aiohttp.ClientSession() as session:
        tasks = []
        cur = start
        while cur <= end:
            for hall_name, base in DINING_HALLS.items():
                async def task_wrapper(hn=hall_name, b=base, d=cur):
                    async with sem:
                        return await parse_menu_for_day_hall(session, hn, b, d)
                tasks.append(task_wrapper())
            cur += timedelta(days=1)

        chunks = await asyncio.gather(*tasks)

    rows = [r for chunk in chunks for r in chunk]
    if not rows:
        return []

    # Keep a canonical display label per item_key (first occurrence wins)
    # This ensures the dropdown has unique options even if site casing varies day-to-day
    first_display = {}
    for r in rows:
        if r["item_key"] not in first_display:
            first_display[r["item_key"]] = r["item"]
            
    # Map the canonical display name back to all rows
    for r in rows:
        r["item_display"] = first_display.get(r["item_key"], r["item"])

    return rows

# Synchronous wrapper
def build_index(start: datetime, end: datetime) -> list[dict]:
    return asyncio.run(build_index_async(start, end))
