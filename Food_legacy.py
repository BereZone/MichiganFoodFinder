import dash
from dash import dcc, html, Input, Output, State, dash_table
from dash.exceptions import PreventUpdate
import pandas as pd
from datetime import datetime, timedelta
# Import scraping logic from the dedicated module
try:
    from .scraping import DINING_HALLS, build_index, build_index_async
except ImportError:
    from scraping import DINING_HALLS, build_index, build_index_async

# =========================
# Initial data build (today + 13 days)
# =========================
START_DATE = datetime.today()
END_DATE = START_DATE + timedelta(days=14)
print("Building initial index — this can take ~10–30s depending on network...")
MENU_DF = pd.DataFrame(build_index(START_DATE, END_DATE))
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
    new_df = pd.DataFrame(build_index(start, end))

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