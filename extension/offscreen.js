// Offscreen document: fetches menu pages inside the user's browser session
// (so Cloudflare's clearance applies), parses them via parser.js (loaded
// before this script by offscreen.html), and POSTs rows to the ingest
// endpoint one day at a time.

const DAYS_AHEAD = 14;
const CONCURRENCY = 4;

function localDateStr(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function looksLikeChallenge(html) {
    return /Just a moment|challenges\.cloudflare\.com|cf-chl/i.test(html.slice(0, 4000));
}

async function fetchPage(url) {
    const resp = await fetch(url, { credentials: 'include' });
    const text = await resp.text();
    if (looksLikeChallenge(text)) throw Object.assign(new Error('cloudflare challenge'), { challenge: true });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return text;
}

function report(status) {
    chrome.runtime.sendMessage({ target: 'background', type: 'sync-status', status: { ...status, at: Date.now() } });
    chrome.runtime.sendMessage({ target: 'popup', type: 'sync-status', status: { ...status, at: Date.now() } }, () => void chrome.runtime.lastError);
}

let challengeWaiter = null;

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== 'offscreen') return;
    if (msg.type === 'sync') runSync(msg.ingestUrl, msg.ingestToken);
    if (msg.type === 'challenge-maybe-solved' && challengeWaiter) challengeWaiter();
});

async function runSync(ingestUrl, ingestToken) {
    try {
        // Challenge probe: one cheap request before fanning out 100+.
        try {
            await fetchPage(Object.values(DINING_HALLS)[0]);
        } catch (e) {
            if (!e.challenge) throw e;
            report({ state: 'progress', detail: 'Cloudflare challenge hit — opening a tab to clear it…' });
            await new Promise((resolve) => {
                challengeWaiter = resolve;
                chrome.runtime.sendMessage({ target: 'background', type: 'solve-challenge' });
                setTimeout(resolve, 40000); // failsafe
            });
            challengeWaiter = null;
            await fetchPage(Object.values(DINING_HALLS)[0]); // throws again if still blocked
        }

        const today = new Date();
        const todayStr = localDateStr(today);
        let totalRows = 0, totalDays = 0;
        const errors = [];

        for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
            const d = new Date(today);
            d.setDate(d.getDate() + offset);
            const dateStr = localDateStr(d);
            const meals = d.getDay() >= 1 && d.getDay() <= 5 ? WEEKDAY_MEALS : WEEKEND_MEALS;
            const param = dateStr === todayStr ? 'date' : 'menuDate';

            report({ state: 'progress', detail: `Fetching ${dateStr} (day ${offset + 1}/${DAYS_AHEAD + 1})…` });

            const entries = Object.entries(DINING_HALLS);
            const dayRows = [];
            for (let i = 0; i < entries.length; i += CONCURRENCY) {
                const batch = entries.slice(i, i + CONCURRENCY);
                const settled = await Promise.allSettled(batch.map(async ([hall, base]) => {
                    const html = await fetchPage(`${base}?${param}=${dateStr}`);
                    return parseDayHall(html, hall, dateStr, meals);
                }));
                for (let j = 0; j < settled.length; j++) {
                    if (settled[j].status === 'fulfilled') dayRows.push(...settled[j].value);
                    else errors.push(`${batch[j][0]} ${dateStr}: ${settled[j].reason}`);
                }
                await new Promise((r) => setTimeout(r, 250)); // be polite
            }

            if (dayRows.length === 0) continue; // nothing to send for this day

            const resp = await fetch(ingestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': ingestToken },
                body: JSON.stringify({ rows: dayRows }),
            });
            if (!resp.ok) {
                const body = await resp.text();
                throw new Error(`Ingest failed for ${dateStr}: HTTP ${resp.status} ${body.slice(0, 200)}`);
            }
            totalRows += dayRows.length;
            totalDays += 1;
        }

        if (totalRows === 0) {
            report({ state: 'error', reason: 'empty', detail: `Parsed 0 items across all days. ${errors.slice(0, 3).join(' | ')}` });
        } else {
            report({ state: 'done', detail: `Synced ${totalRows} rows across ${totalDays} day(s).${errors.length ? ` ${errors.length} page(s) failed.` : ''}` });
        }
    } catch (e) {
        report({ state: 'error', reason: e.challenge ? 'challenge' : 'other', detail: String(e.message || e) });
    }
}
