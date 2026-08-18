/**
 * Time-aware copy and the meal colour map.
 *
 * The headline changes with the Detroit clock, so someone checking at 8am and
 * again at 6pm gets a page that knows which it is. It reports the meal *period*
 * only, never that a particular hall is open, which varies by hall and is not
 * something this data can promise.
 */

export interface Headline {
    line: string;
    meal: string | null;
}

function detroitParts(now: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Detroit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return {
        weekend: get('weekday') === 'Sun' || get('weekday') === 'Sat',
        time: parseInt(get('hour'), 10) + parseInt(get('minute'), 10) / 60,
    };
}

export function mealHeadline(now: Date = new Date()): Headline {
    const { weekend, time } = detroitParts(now);

    if (time < 5) return { line: 'Kitchens are closed. Tomorrow is already listed.', meal: null };
    if (time < 10.5) return { line: 'Breakfast is on right now.', meal: 'Breakfast' };

    if (weekend) {
        if (time < 14) return { line: 'Brunch is on right now.', meal: 'Brunch' };
        if (time < 16.5) return { line: 'Between brunch and dinner.', meal: null };
    } else {
        if (time < 14) return { line: 'Lunch is on right now.', meal: 'Lunch' };
        if (time < 16.5) return { line: 'Between lunch and dinner.', meal: null };
    }

    if (time < 20.5) return { line: 'Dinner is on right now.', meal: 'Dinner' };
    return { line: 'Dinner is wrapping up. Tomorrow is already listed.', meal: null };
}

/**
 * "Updated 3 hours ago" answers the only question anyone asks of a timestamp:
 * is this stale? Falls back to a date once the answer is clearly yes.
 */
export function freshness(iso: string, now: Date = new Date()): string {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return '';

    const mins = Math.round((now.getTime() - then.getTime()) / 60000);
    if (mins < 2) return 'updated just now';
    if (mins < 60) return `updated ${mins} min ago`;

    const hours = Math.round(mins / 60);
    if (hours < 24) return `updated ${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    if (days <= 6) return `updated ${days} day${days === 1 ? '' : 's'} ago`;

    return `updated ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * Meal is the one categorical dimension that earns colour, so it gets four
 * hues and everything else on the row stays neutral. Each pair is contrast
 * checked against its own wash in both themes.
 */
export const MEAL_CHIP: Record<string, string> = {
    Breakfast: 'bg-meal-breakfast-wash text-meal-breakfast',
    Brunch: 'bg-meal-brunch-wash text-meal-brunch',
    Lunch: 'bg-meal-lunch-wash text-meal-lunch',
    Dinner: 'bg-meal-dinner-wash text-meal-dinner',
};

export const MEAL_TEXT: Record<string, string> = {
    Breakfast: 'text-meal-breakfast',
    Brunch: 'text-meal-brunch',
    Lunch: 'text-meal-lunch',
    Dinner: 'text-meal-dinner',
};
