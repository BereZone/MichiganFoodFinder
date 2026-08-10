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
    nutrition: {
        calories: number | null;
        serving_size: string | null;
        total_fat: string | null;
        total_carbohydrate: string | null;
        protein: string | null;
        sodium: string | null;
    };
    item_display: string;
    station?: string;
}

export interface MenuResponse {
    status: string;
    items_count: number;
    last_built: string;
    is_building: boolean;
}

export interface PlateNutrition {
    calories: number | null;
    fat_g: number | null;
    carbs_g: number | null;
    protein_g: number | null;
    sodium_mg: number | null;
}

export interface PlateEntry {
    item_key: string;
    name: string;
    hall: string;
    station: string;
    servings: number;
    /** As published, e.g. "1/2 Cup (113g)". Optional because plates saved
     *  before this field existed have no such key, and because the menu does
     *  not publish a serving size for every item. */
    serving_size?: string | null;
    nutrition: PlateNutrition;
}

export interface Plate {
    date: string;        // YYYY-MM-DD
    meal: string;        // Breakfast | Brunch | Lunch | Dinner
    items: PlateEntry[];
    updated_at: string;  // ISO 8601, always via new Date(...).toISOString()
}

export type PlateMap = Record<string, Plate>;
