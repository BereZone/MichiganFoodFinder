import { describe, it, expect } from 'vitest';
import { inferDetroitNow } from './mealTime';

// Fixtures verified against America/Detroit.
describe('inferDetroitNow', () => {
    it('returns Breakfast before 10:30 on a weekday', () => {
        // 2026-08-10T14:00Z is Mon 10:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-10T14:00:00Z')))
            .toEqual({ date: '2026-08-10', meal: 'Breakfast' });
    });

    it('returns Lunch midday on a weekday', () => {
        // 2026-01-15T16:00Z is Thu 11:00 EST — also proves EST/EDT handling.
        expect(inferDetroitNow(new Date('2026-01-15T16:00:00Z')))
            .toEqual({ date: '2026-01-15', meal: 'Lunch' });
    });

    it('returns Dinner from 16:30 on a weekday', () => {
        // 2026-08-10T22:00Z is Mon 18:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-10T22:00:00Z')))
            .toEqual({ date: '2026-08-10', meal: 'Dinner' });
    });

    it('returns Lunch before 14:00 on a weekend', () => {
        // 2026-08-09T17:00Z is Sun 13:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-09T17:00:00Z')))
            .toEqual({ date: '2026-08-09', meal: 'Lunch' });
    });

    it('returns Dinner after 14:00 on a weekend', () => {
        // 2026-08-09T19:00Z is Sun 15:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-09T19:00:00Z')))
            .toEqual({ date: '2026-08-09', meal: 'Dinner' });
    });

    it('uses the Detroit date, not the UTC date', () => {
        // 2026-08-10T03:00Z is Sun 2026-08-09 23:00 EDT.
        expect(inferDetroitNow(new Date('2026-08-10T03:00:00Z')).date).toBe('2026-08-09');
    });
});
