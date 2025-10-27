"""
UMich Dining Menu Finder — with Attribute Columns

- Scrapes next 14 days across listed halls
- Parses tags from each item line
- Columns: Item, Nutrient Density, Carbon Footprint, Other Tags (+ Date/Meal/Hall)
- Item dropdown + hall filter + attribute (AND) filter
- Rebuild Index button

pip install dash aiohttp beautifulsoup4 certifi pandas
"""

import asyncio
import aiohttp
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re
import ssl
import certifi
import pandas as pd

import dash
from dash import dcc, html, Input, Output, State, dash_table

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
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
MAX_CONCURRENCY = 8

# =========================
# Attribute definitions
# =========================
ATTRIBUTES = [
    "GLUTEN FREE", "HALAL", "SPICY", "VEGAN", "VEGETARIAN", "KOSHER",
    "NUTRIENT DENSE LOW", "NUTRIENT DENSE LOW MEDIUM", "NUTRIENT DENSE MEDIUM",
    "NUTRIENT DENSE MEDIUM HIGH", "NUTRIENT DENSE HIGH",
    "CARBON FOOTPRINT LOW", "CARBON FOOTPRINT MEDIUM", "CARBON FOOTPRINT HIGH",
]
PRETTY_ATTR_LABEL = {
    "GLUTEN FREE": "Gluten Free",
    "HALAL": "Halal",
    "SPICY": "Spicy",
    "VEGAN": "Vegan",
    "VEGETARIAN": "Vegetarian",
    "KOSHER": "Kosher",
    "NUTRIENT DENSE LOW": "Nutrient Density: Low",
    "NUTRIENT DENSE LOW MEDIUM": "Nutrient Density: Low/Medium",
    "NUTRIENT DENSE MEDIUM": "Nutrient Density: Medium",
    "NUTRIENT DENSE MEDIUM HIGH": "Nutrient Density: Medium/High",
    "NUTRIENT DENSE HIGH": "Nutrient Density: High",
    "CARBON FOOTPRINT LOW": "Carbon Footprint: Low",
    "CARBON FOOTPRINT MEDIUM": "Carbon Footprint: Medium",
    "CARBON FOOTPRINT HIGH": "Carbon Footprint: High",
}

# Regexes to pull tags from the item line
ATTR_REGEXES = {
    "GLUTEN FREE": re.compile(r"\bgluten\s*free\b", re.I),
    "HALAL": re.compile(r"\bhalal\b", re.I),
    "SPICY": re.compile(r"\bspicy\b", re.I),
    "VEGAN": re.compile(r"\bvegan\b", re.I),
    "VEGETARIAN": re.compile(r"\bvegetarian\b", re.I),
    "KOSHER": re.compile(r"\bkosher\b", re.I),
    "NUTRIENT DENSE LOW MEDIUM": re.compile(r"\bnutrient\s*dense\s*low\s*medium\b", re.I),
    "NUTRIENT DENSE MEDIUM HIGH": re.compile(r"\bnutrient\s*dense\s*medium\s*high\b", re.I),
    "NUTRIENT DENSE LOW": re.compile(r"\bnutrient\s*dense\s*low\b", re.I),
    "NUTRIENT DENSE MEDIUM": re.compile(r"\bnutrient\s*dense\s*medium\b", re.I),
    "NUTRIENT DENSE HIGH": re.compile(r"\bnutrient\s*dense\s*high\b", re.I),
    "CARBON FOOTPRINT LOW": re.compile(r"\bcarbon\s*footprint\s*low\b|\bco[2₂]\s*low\b", re.I),
    "CARBON FOOTPRINT MEDIUM": re.compile(r"\bcarbon\s*footprint\s*medium\b|\bco[2₂]\s*medium\b", re.I),
    "CARBON FOOTPRINT HIGH": re.compile(r"\bcarbon\s*footprint\s*high\b|\bco[2₂]\s*high\b", re.I),
}

_normalize_spaces = lambda s: re.sub(r"\s+", " ", s or "").strip()
def item_key(name: str) -> str: return _normalize_spaces(name).casefold()

def split_item_and_tags(raw_line: str) -> tuple[str, list[str]]:
    """Return (item_name, tag_labels[]) from a single <li> text line."""
    line = _normalize_spaces(
        re.split(r"\b(close|Contains:|Nutrition Facts|Serving Size)\b", raw_line, 1, flags=re.I)[0]
    )
    found = []
    for label in sorted(ATTR_REGEXES.keys(), key=len, reverse=True):  # prefer longer phrases
        rx = ATTR_REGEXES[label]
        if rx.search(line):
            found.append(label)
            line = rx.sub("", line)
    name = _normalize_spaces(line).strip("—-:|• ")
    return name, sorted(set(found))

def group_tag_values(tags: list[str]) -> tuple[str, str, list[str], str]:
    """
    From canonical tag list → (nutrient_density, carbon_footprint, other_tags_list, other_tags_str)
    """
    nd, cf, others = "", "", []
    for t in tags or []:
        if t.startswith("NUTRIENT DENSE"):
            v = t.replace("NUTRIENT DENSE", "").strip()
            v = v.replace("LOW MEDIUM", "Low/Medium").replace("MEDIUM HIGH", "Medium/High").title()
            nd = v
        elif t.startswith("CARBON FOOTPRINT"):
            v = t.replace("CARBON FOOTPRINT", "").strip().title()
            cf = v
        else:
            # Pretty-print others
            others.append(PRETTY_ATTR_LABEL.get(t, t.title()))
    return nd, cf, others, ", ".join(others)

async def fetch_text(session: aiohttp.ClientSession, url: str) -> str:
    try:
        async with session.get(url, headers=HEADERS, ssl=SSL_CONTEXT,
                               timeout=aiohttp.ClientTimeout(total=20)) as resp:
            return await resp.text()
    except Exception:
        return ""

async def parse_menu_for_day_hall(session, hall_name: str, base_url: str, date: datetime) -> list[dict]:
    """
    Read first-level <li> rows under each meal's <ul>, split name + tags from text.
    """
    date_str = date.strftime("%Y-%m-%d")
    is_today = (date.date() == datetime.today().date())
    meals = WEEKDAY_MEALS if date.weekday() < 5 else WEEKEND_MEALS

    url = f"{base_url}?date={date_str}" if is_today else f"{base_url}?menuDate={date_str}"
    html = await fetch_text(session, url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results = []

    meal_header = {}
    for h in soup.find_all("h3"):
        a = h.find("a")
        if a and a.text:
            meal_header[_normalize_spaces(a.text).casefold()] = h

    for meal in meals:
        header = meal_header.get(meal.casefold())
        if not header:
            continue
        ul = header.find_next("ul")
        if not ul:
            continue

        for li in ul.find_all("li", recursive=False):
            line = _normalize_spaces(li.get_text(" ", strip=True))
            if not line or re.search(r"\b(No Service|No Menu|Closed)\b", line, re.I):
                continue

            name, tags = split_item_and_tags(line)
            if not name:
                continue

            nd, cf, others, others_str = group_tag_values(tags)
            results.append({
                "item": name,
                "item_key": item_key(name),
                "item_display": name,
                "meal": meal,
                "hall": hall_name,
                "date": date_str,
                "tags": tags,
                "nutrient_density": nd,        # Low / Low/Medium / Medium / Medium/High / High
                "carbon_footprint": cf,        # Low / Medium / High
                "other_tags": others,          # list[str] of Gluten Free / Vegan / etc.
                "other_tags_str": others_str,  # pretty string for table
            })

    # Dedup within date/hall/meal by item_key
    seen = set()
    uniq = []
    for r in results:
        key = (r["date"], r["hall"], r["meal"], r["item_key"])
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    return uniq

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
            "item","item_key","item_display","meal","hall","date","tags",
            "nutrient_density","carbon_footprint","other_tags","other_tags_str"
        ])

    df = pd.DataFrame(rows)

    # Keep canonical display per item_key (first occurrence wins)
    first_display = {}
    for _, r in df.iterrows():
        first_display.setdefault(r["item_key"], r["item"])
    df["item_display"] = df["item_key"].map(first_display)

    return df

def build_index(start: datetime, end: datetime) -> pd.DataFrame:
    return asyncio.run(build_index_async(start, end))

# =========================
# Initial data build
# =========================
START_DATE = datetime.today()
END_DATE = START_DATE + timedelta(days=14)
print("Building initial index …")
MENU_DF = build_index(START_DATE, END_DATE)
LAST_BUILT = datetime.now()
print(
    f"Index built: {len(MENU_DF):,} rows, {MENU_DF['item_key'].nunique():,} unique items; "
    f"nutrient tags on {MENU_DF['nutrient_density'].astype(bool).sum():,} rows; "
    f"carbon tags on {MENU_DF['carbon_footprint'].astype(bool).sum():,} rows"
)

# =========================
# Dash App
# =========================
app = dash.Dash(__name__)
app.title = "UMich Dining — Menu Finder"

unique_items = (
    MENU_DF[["item_key", "item_display"]]
    .drop_duplicates("item_key")
    .sort_values("item_display", key=lambda s: s.str.casefold())
)
ITEM_OPTIONS = [{"label": row["item_display"], "value": row["item_key"]} for _, row in unique_items.iterrows()]

# Attribute options (for the AND filter)
ATTR_OPTIONS = [{"label": PRETTY_ATTR_LABEL[a], "value": a} for a in ATTRIBUTES]

app.layout = html.Div(
    [
        html.H1("UMich Dining — Menu Finder"),
        dcc.Markdown(
            f"**Date window:** {START_DATE.strftime('%Y-%m-%d')} → {END_DATE.strftime('%Y-%m-%d')}  \n"
            f"**Built:** {LAST_BUILT.strftime('%Y-%m-%d %H:%M:%S')}  \n"
            "Search an item and/or filter by halls and attributes."
        ),
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
                    style={"flex": 2, "minWidth": 280, "marginRight": 12},
                ),
                html.Div(
                    [
                        html.Label("Dining hall (optional)"),
                        dcc.Dropdown(
                            id="hall-filter",
                            options=[{"label": h, "value": h} for h in sorted(DINING_HALLS.keys())],
                            placeholder="All halls",
                            multi=True,
                            clearable=True,
                        ),
                    ],
                    style={"flex": 1.5, "minWidth": 240, "marginRight": 12},
                ),
                html.Div(
                    [
                        html.Label("Attributes (AND filter)"),
                        dcc.Dropdown(
                            id="attr-filter",
                            options=ATTR_OPTIONS,
                            placeholder="Any attributes",
                            multi=True,
                            clearable=True,
                        ),
                    ],
                    style={"flex": 2, "minWidth": 280, "marginRight": 12},
                ),
                html.Div(
                    [
                        html.Label("Rebuild index"),
                        html.Button("Fetch next 14 days", id="rebuild-btn"),
                        dcc.Loading(html.Div(id="rebuild-status", style={"marginTop": 6})),
                    ],
                    style={"flex": 1, "minWidth": 220},
                ),
            ],
            style={"display": "flex", "flexWrap": "wrap", "alignItems": "flex-end", "gap": 8},
        ),

        html.Hr(),
        html.Div(id="result-summary"),

        dash_table.DataTable(
            id="result-table",
            columns=[
                {"name": "Date", "id": "date"},
                {"name": "Meal", "id": "meal"},
                {"name": "Dining Hall", "id": "hall"},
                {"name": "Item", "id": "item_display"},
                {"name": "Nutrient Density", "id": "nutrient_density"},
                {"name": "Carbon Footprint", "id": "carbon_footprint"},
                {"name": "Other Tags", "id": "other_tags_str"},
            ],
            data=[],
            sort_action="native",
            filter_action="native",
            page_size=25,
            style_table={"overflowX": "auto"},
            style_cell={"padding": "8px", "fontFamily": "Arial, sans-serif", "fontSize": 14},
            style_header={"fontWeight": "bold"},
        ),
    ],
    style={"maxWidth": 1200, "margin": "24px auto", "padding": "0 12px"},
)

# =========================
# Callbacks
# =========================
@app.callback(
    Output("result-table", "data"),
    Output("result-summary", "children"),
    Input("item-dropdown", "value"),
    Input("hall-filter", "value"),
    Input("attr-filter", "value"),
    State("menu-data", "data"),
)
def update_results(selected_item_key, hall_filter, attr_filter, records):
    df = pd.DataFrame(records)

    # Base selection: by item (or everything if none selected)
    if selected_item_key:
        f = df[df["item_key"] == selected_item_key]
        if f.empty:
            f = df[df["item"].str.casefold().str.contains(selected_item_key or "", na=False)]
    else:
        f = df.copy()

    # Hall filter
    if hall_filter:
        f = f[f["hall"].isin(hall_filter)]

    # Attribute (AND) filter — uses underlying canonical tag list
    if attr_filter:
        need = set(attr_filter)
        f = f[f["tags"].apply(lambda t: need.issubset(set(t or [])))]

    if f.empty:
        return [], html.Div([html.Em("No matches in the current 14-day window.")])

    f = f.sort_values(["date", "hall", "meal", "item_display"])

    title = f"**{f.iloc[0]['item_display']}**" if selected_item_key else "**All items** (filtered)"
    num_rows = len(f)
    num_halls = f["hall"].nunique()
    date_min, date_max = f["date"].min(), f["date"].max()
    halls_list = ", ".join(sorted(f["hall"].unique()))
    attrs_line = (
        "\n\n**Attributes:** " + ", ".join(
            PRETTY_ATTR_LABEL.get(a, a.title()) for a in attr_filter
        ) if attr_filter else ""
    )

    summary = dcc.Markdown(
        f"{title} — **{num_rows}** rows across **{num_halls}** halls"
        f"{attrs_line}\n\n**Halls:** {halls_list}\n\n"
        f"**Dates covered:** {date_min} → {date_max}"
    )

    cols = ["date", "meal", "hall", "item_display", "nutrient_density", "carbon_footprint", "other_tags_str"]
    return f[cols].to_dict("records"), summary

@app.callback(
    Output("menu-data", "data"),
    Output("rebuild-status", "children"),
    Output("item-dropdown", "options"),
    Input("rebuild-btn", "n_clicks"),
    prevent_initial_call=True,
)
def rebuild_index(n_clicks):
    start = datetime.today()
    end = start + timedelta(days=14)
    new_df = build_index(start, end)

    unique_items = (
        new_df[["item_key", "item_display"]]
        .drop_duplicates("item_key")
        .sort_values("item_display", key=lambda s: s.str.casefold())
    )
    options = [{"label": r["item_display"], "value": r["item_key"]} for _, r in unique_items.iterrows()]
    status = html.Span(
        f"Index updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} — "
        f"{len(new_df):,} rows, {new_df['item_key'].nunique():,} unique items"
    )
    return new_df.to_dict("records"), status, options

if __name__ == "__main__":
    app.run(debug=True)
