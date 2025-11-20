#!/usr/bin/env python3
"""
Standalone script to scrape UMich dining menus for the next 14 days.
Outputs to client/public/menus.json for static serving.

Run: python scrape_menus.py
"""

import asyncio
import aiohttp
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re
import ssl
import certifi
import json
import os
from pathlib import Path

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

SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
MAX_CONCURRENCY = 8

# =========================
# Helpers
# =========================
def normalize_spaces(s):
    return re.sub(r"\s+", " ", s or "").strip()

def item_key(name: str) -> str:
    """Casefolded key for dedup/search."""
    return normalize_spaces(name).casefold()

# --- Tag extraction regexes ---
ND_RX = re.compile(
    r"\bNutrient\s*Dense\s*(Low\s*Medium|Medium\s*High|Low|Medium|High)\b",
    re.I,
)
CF_RX = re.compile(
    r"\bCarbon\s*Footprint\s*(Low|Medium|High)\b|\bCO[2₂]\s*(Low|Medium|High)\b",
    re.I,
)
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

def normalize_nd(v: str) -> str:
    v = normalize_spaces(v).upper().replace(" ", "")
    mapping = {
        "LOW": "Low",
        "LOWMEDIUM": "Low/Medium",
        "MEDIUM": "Medium",
        "MEDIUMHIGH": "Medium/High",
        "HIGH": "High",
    }
    return mapping.get(v, "")

def normalize_cf(v: str) -> str:
    v = normalize_spaces(v).upper()
    mapping = {"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High"}
    return mapping.get(v, "")

def parse_tags_from_li_text(li_text: str) -> tuple:
    """Extract Nutrient Density, Carbon Footprint, and Other Tags."""
    head = normalize_spaces(
        re.split(r"\b(close|Contains:|Nutrition Facts|Serving Size)\b", li_text, 1, flags=re.I)[0]
    )

    # Nutrient Density
    nd = ""
    m_nd = ND_RX.search(head)
    if m_nd:
        nd = normalize_nd(m_nd.group(1))

    # Carbon Footprint
    cf = ""
    m_cf = CF_RX.search(head)
    if m_cf:
        cf_raw = m_cf.group(1) or m_cf.group(2)
        cf = normalize_cf(cf_raw)

    # Other tags
    others_set = set()
    for label, rx in TAG_RXES.items():
        if rx.search(head):
            others_set.add(PRETTY_OTHER.get(label, label.title()))
    others = sorted(others_set)
    others_str = ", ".join(others)

    return nd, cf, others, others_str

def parse_nutrition_from_li(li) -> dict:
    """
    Extract detailed nutrition facts from the LI element's HTML structure.
    Returns a dict with calories, protein, sugar, carbohydrate, total_fat, sodium.
    """
    nut = {
        "calories": None,
        "total_fat": None,
        "total_carbohydrate": None,
        "protein": None,
        "sodium": None
    }
    
    if not li:
        return nut

    # Calories: Look for <tr class="portion-calories"> -> <td>Calories 164</td>
    cal_tr = li.find("tr", class_="portion-calories")
    if cal_tr:
        txt = normalize_spaces(cal_tr.get_text())
        # "Calories 164"
        m = re.search(r"Calories\s+(\d+)", txt, re.I)
        if m:
            nut["calories"] = int(m.group(1))

    # For others, we iterate rows or look for specific text
    # The structure is usually <tr><td><strong>Label</strong> Value</td>...</tr>
    # We can search for the label in the text of the rows
    
    # Helper to find value for a label
    def find_val(label_pattern):
        # Find a td that contains this pattern
        # The HTML is like: <td><strong>Total Fat</strong> 3g</td>
        # So we search all tds
        for td in li.find_all("td"):
            txt = normalize_spaces(td.get_text())
            if re.search(label_pattern, txt, re.I):
                # Extract the value. Usually it's "Label Value" or "LabelValue"
                # Regex: Label\s*(\d+(?:g|mg))
                m_val = re.search(rf"{label_pattern}\s*(\d+(?:\.\d+)?(?:g|mg))", txt, re.I)
                if m_val:
                    return m_val.group(1)
        return None

    nut["total_fat"] = find_val(r"Total\s*Fat")
    nut["total_carbohydrate"] = find_val(r"Total\s*Carbohydrate")
    nut["protein"] = find_val(r"Protein")
    nut["sodium"] = find_val(r"Sodium")
    
    return nut

async def fetch_text(session: aiohttp.ClientSession, url: str) -> str:
    try:
        async with session.get(url, headers=HEADERS, ssl=SSL_CONTEXT, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            return await resp.text()
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return ""

async def parse_menu_for_day_hall(session, hall_name: str, base_url: str, date: datetime) -> list:
    date_str = date.strftime("%Y-%m-%d")
    is_today = (date.date() == datetime.today().date())
    meals = WEEKDAY_MEALS if date.weekday() < 5 else WEEKEND_MEALS

    url = f"{base_url}?date={date_str}" if is_today else f"{base_url}?menuDate={date_str}"
    html = await fetch_text(session, url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results = []

    # Find meal headers
    h3s = soup.find_all("h3")
    meal_header = {}
    for h in h3s:
        a = h.find("a")
        if a and a.text:
            name = normalize_spaces(a.text)
            meal_header[name.casefold()] = h

    for meal in meals:
        header = meal_header.get(meal.casefold())
        if not header:
            continue
        ul = header.find_next("ul")
        if not ul:
            continue
        items = ul.find_all("div", class_="item-name")
        seen_for_section = set()
        for it in items:
            display = normalize_spaces(it.get_text(strip=True))
            if not display:
                continue

            li = it.find_parent("li")
            li_text = normalize_spaces(li.get_text(" ", strip=True)) if li else display
            nutrient_density, carbon_footprint, other_tags, other_tags_str = parse_tags_from_li_text(li_text)
            
            # Parse detailed nutrition
            nutrition = parse_nutrition_from_li(li)

            k = item_key(display)
            if k in seen_for_section:
                continue
            seen_for_section.add(k)
            results.append({
                "item": display,
                "item_display": display,
                "item_key": k,
                "meal": meal,
                "hall": hall_name,
                "date": date_str,
                "nutrient_density": nutrient_density,
                "carbon_footprint": carbon_footprint,
                "other_tags": other_tags,
                "other_tags_str": other_tags_str,
                "nutrition": nutrition
            })
    return results

async def scrape_all_menus(days: int = 14) -> list:
    """Scrape menus for the next N days."""
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    start = datetime.today()
    end = start + timedelta(days=days)

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
    return rows

def main():
    print("🍽️  Scraping UMich dining menus for the next 14 days...")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Scrape data
    menus = asyncio.run(scrape_all_menus(14))
    
    # Add metadata
    output = {
        "last_updated": datetime.now().isoformat(),
        "date_range": {
            "start": datetime.today().strftime("%Y-%m-%d"),
            "end": (datetime.today() + timedelta(days=14)).strftime("%Y-%m-%d"),
        },
        "total_items": len(menus),
        "menus": menus
    }
    
    # Ensure output directory exists
    output_dir = Path(__file__).parent / "client" / "public"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Write to file
    output_file = output_dir / "menus.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Scraped {len(menus)} menu items")
    print(f"📝 Saved to: {output_file}")
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()
