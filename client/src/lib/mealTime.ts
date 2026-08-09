/**
 * Current dining date and meal in America/Detroit, regardless of the viewer's
 * own timezone. Extracted from MenuFinder's "What's Open Now" so the plate
 * screen and that button agree.
 */
export function inferDetroitNow(now: Date = new Date()): { date: string; meal: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Detroit',
        year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const isWeekend = get('weekday') === 'Sun' || get('weekday') === 'Sat';
    const time = parseInt(get('hour'), 10) + parseInt(get('minute'), 10) / 60;

    let meal: string;
    if (time < 10.5) {
        meal = 'Breakfast';
    } else if (time >= 16.5) {
        meal = 'Dinner';
    } else if (isWeekend) {
        meal = time < 14.0 ? 'Lunch' : 'Dinner';
    } else {
        meal = 'Lunch';
    }

    return { date, meal };
}
