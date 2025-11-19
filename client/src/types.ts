export interface MenuItem {
    item: string;
    item_key: string;
    meal: string;
    hall: string;
    date: string;
    nutrient_density: string;
    carbon_footprint: string;
    other_tags: string[];
    other_tags_str: string;
    item_display: string;
}

export interface MenuResponse {
    status: string;
    items_count: number;
    last_built: string;
    is_building: boolean;
}
