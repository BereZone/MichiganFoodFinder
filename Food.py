"""
UMich Dining Menu Finder — Interactive Dash App
(+ Nutrient & Carbon & Other Tags, show all by default)

What it does
- Scrapes UMich dining menus for the next 14 days (today + 13) across all dining halls listed.
- Builds a searchable index of unique menu items.
- Lets you search via a dropdown and instantly see which locations serve that item on which dates & meals.
- Adds per-item Nutrient Density, Carbon Footprint, and Other Tags (Spicy/Halal/Kosher/Vegan/Vegetarian/Gluten Free).
- Shows ALL items by default (optionally filter by hall).
- Includes a "Rebuild Index" button to refresh data on-demand.

Requirements
pip install dash aiohttp beautifulsoup4 certifi pandas

Run
python app.py
Then open http://127.0.0.1:8050 in your browser.
"""

import asyncio
import aiohttp
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re
import ssl
import certifi
from collections import defaultdict
import pandas as pd

import dash
from dash import dcc, html, Input, Output, State, dash_table
from dash.exceptions import PreventUpdate

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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
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

async def build_index_async(start: datetime, end: datetime) -> pd.DataFrame:
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
        return pd.DataFrame(columns=[
            "item", "item_key", "meal", "hall", "date",
            "nutrient_density", "carbon_footprint", "other_tags", "other_tags_str"
        ])

    df = pd.DataFrame(rows)
    # Keep a canonical display label per item_key (first occurrence wins)
    # This ensures the dropdown has unique options even if site casing varies day-to-day
    first_display = {}
    for _, r in df.iterrows():
        first_display.setdefault(r["item_key"], r["item"])  # don't overwrite once set
    df["item_display"] = df["item_key"].map(first_display)

    return df

# Synchronous wrapper
def build_index(start: datetime, end: datetime) -> pd.DataFrame:
    return asyncio.run(build_index_async(start, end))

# =========================
# Initial data build (today + 13 days)
# =========================
START_DATE = datetime.today()
END_DATE = START_DATE + timedelta(days=14)
print("Building initial index — this can take ~10–30s depending on network...")
MENU_DF = build_index(START_DATE, END_DATE)
LAST_BUILT = datetime.now()
print(
    f"Index built: {len(MENU_DF):,} rows, {MENU_DF['item_key'].nunique():,} unique items; "
    f"ND present: {MENU_DF['nutrient_density'].astype(bool).sum():,}, "
    f"CF present: {MENU_DF['carbon_footprint'].astype(bool).sum():,}, "
    f"Other-tags rows: {(MENU_DF['other_tags_str'].astype(bool).sum() if 'other_tags_str' in MENU_DF else 0):,}"
)

# =========================
# Dash App
# =========================
app = dash.Dash(__name__)
app.title = "UMich Food Finder"

server = app.server


# Precompute dropdown options
unique_items = (
    MENU_DF[["item_key", "item_display"]]
    .drop_duplicates("item_key")
    .sort_values("item_display", key=lambda s: s.str.casefold())
)
ITEM_OPTIONS = [
    {"label": row["item_display"], "value": row["item_key"]}
    for _, row in unique_items.iterrows()
]

app.layout = html.Div(
    [
        html.H1("UMich Dining — Menu Finder"),
        dcc.Markdown(
            f"**Date window:** {START_DATE.strftime('%Y-%m-%d')} → {END_DATE.strftime('%Y-%m-%d')}  \n"
            f"**Built:** {LAST_BUILT.strftime('%Y-%m-%d %H:%M:%S')}  \n"
            "Type to search the dropdown for an item (e.g., *chicken tenders*, *tofu*, *pancakes*)."
        ),

        # Hidden store for the dataset so callbacks don't rely on module globals
        dcc.Store(id="menu-data", data=MENU_DF.to_dict("records")),

        html.Div(
            [
                html.Div(
                    [
                        html.Label("Menu item"),
                        dcc.Dropdown(
                            id="item-dropdown",
                            options=ITEM_OPTIONS,
                            placeholder="Search menu item...",
                            clearable=True,
                            multi=False,
                        ),
                    ],
                    style={"flex": 2, "minWidth": 300, "marginRight": 12},
                ),
                html.Div(
                    [
                        html.Label("Dining hall (optional filter)"),
                        dcc.Dropdown(
                            id="hall-filter",
                            options=[{"label": h, "value": h} for h in sorted(DINING_HALLS.keys())],
                            placeholder="All halls",
                            multi=True,
                            clearable=True,
                        ),
                    ],
                    style={"flex": 2, "minWidth": 250, "marginRight": 12},
                ),
            ],
            style={"display": "flex", "flexWrap": "wrap", "alignItems": "flex-end", "gap": 8},
        ),

        html.Hr(),

        html.Div(id="result-summary"),

        dash_table.DataTable(
            id="result-table",
            columns=[
                {"name": "Item", "id": "item_display"},
                {"name": "Date", "id": "date"},
                {"name": "Meal", "id": "meal"},
                {"name": "Dining Hall", "id": "hall"},
                {"name": "Nutrient Density", "id": "nutrient_density"},
                {"name": "Carbon Footprint", "id": "carbon_footprint"},
                {"name": "Other Tags", "id": "other_tags_str"},
            ],
            data=[],  # filled by callback (shows ALL by default)
            sort_action="native",
            filter_action="native",
            page_size=25,
            style_table={"overflowX": "auto"},
            style_cell={"padding": "8px", "fontFamily": "Arial, sans-serif", "fontSize": 14},
            style_header={"fontWeight": "bold"},
        ),
    ],
    style={"maxWidth": 1100, "margin": "24px auto", "padding": "0 12px"},
)

# =========================
# Callbacks
# =========================

@app.callback(
    Output("result-table", "data"),
    Output("result-summary", "children"),
    Input("item-dropdown", "value"),
    Input("hall-filter", "value"),
    State("menu-data", "data"),
)
def update_results(selected_item_key, hall_filter, records):
    df = pd.DataFrame(records)

    # If no item selected -> show ALL items by default
    if not selected_item_key:
        f = df.copy()
    else:
        f = df[df["item_key"] == selected_item_key]
        if f.empty:
            # Soft contains fallback (in case casing/spacing shifted)
            f = df[df["item"].str.casefold().str.contains(selected_item_key, na=False)]

    # Optional hall filter
    if hall_filter:
        f = f[f["hall"].isin(hall_filter)]

    if f.empty:
        return [], html.Div([html.Em("No matches in the current 14-day window.")])

    # Sort
    f = f.sort_values(["date", "hall", "meal", "item_display"])

    # Summary
    if selected_item_key and not f.empty:
        first_label = f.iloc[0]["item_display"]
        title = f"**{first_label}**"
    else:
        title = "**All items**"

    num_rows = len(f)
    num_halls = f["hall"].nunique()
    date_min, date_max = f["date"].min(), f["date"].max()
    halls_list = ", ".join(sorted(f["hall"].unique()))

    summary = dcc.Markdown(
        f"{title} — **{num_rows}** rows across **{num_halls}** halls\n\n"
        f"**Halls:** {halls_list}\n\n"
        f"**Dates covered:** {date_min} → {date_max}"
    )

    # Return records for the table (includes name + ND + CF + Other Tags)
    cols = ["item_display", "date", "meal", "hall", "nutrient_density", "carbon_footprint", "other_tags_str"]
    return f[cols].to_dict("records"), summary


@app.callback(
    Output("menu-data", "data"),
    Output("rebuild-status", "children"),
    Output("item-dropdown", "options"),
    Input("rebuild-btn", "n_clicks"),
    prevent_initial_call=True,
)
def rebuild_index(n_clicks):
    # Always rebuild for new 14-day window starting today
    start = datetime.today()
    end = start + timedelta(days=14)
    new_df = build_index(start, end)

    # Options for dropdown
    unique_items = (
        new_df[["item_key", "item_display"]]
        .drop_duplicates("item_key")
        .sort_values("item_display", key=lambda s: s.str.casefold())
    )
    options = [
        {"label": row["item_display"], "value": row["item_key"]}
        for _, row in unique_items.iterrows()
    ]

    status = html.Span(
        f"Index updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} — "
        f"{len(new_df):,} rows, {new_df['item_key'].nunique():,} unique items; "
        f"ND present: {new_df['nutrient_density'].astype(bool).sum():,}, "
        f"CF present: {new_df['carbon_footprint'].astype(bool).sum():,}, "
        f"Other-tags rows: {new_df['other_tags_str'].astype(bool).sum():,}"
    )

    return new_df.to_dict("records"), status, options


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8050))
    # 0.0.0.0 is required on most hosts
    app.run(host="0.0.0.0", port=port, debug=False)