// Service worker: schedules syncs, owns the offscreen parser document, and
// handles Cloudflare-challenge recovery by briefly opening a real tab.

const SYNC_ALARM = 'menu-relay-sync';
const SYNC_PERIOD_MINUTES = 360; // every 6 hours while the browser is running

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);

function scheduleAlarm() {
    chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 2, periodInMinutes: SYNC_PERIOD_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) startSync('alarm');
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.target !== 'background') return;
    if (msg.type === 'sync-now') {
        startSync('manual');
        sendResponse({ ok: true });
    } else if (msg.type === 'sync-status') {
        // Progress/results from the offscreen document: persist + badge
        chrome.storage.local.set({ lastStatus: msg.status });
        if (msg.status.state === 'done') {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
            closeOffscreen();
        } else if (msg.status.state === 'error') {
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
            if (msg.status.reason === 'challenge') {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                    title: 'Menu Relay blocked',
                    message: 'Cloudflare wants a human check. Open dining.umich.edu once in a tab, then click Sync now again.',
                });
            }
            closeOffscreen();
        }
    } else if (msg.type === 'solve-challenge') {
        // Open the site in a background tab so the challenge can clear, then retry
        chrome.tabs.create({ url: 'https://dining.umich.edu/', active: false }, (tab) => {
            setTimeout(() => {
                chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError);
                chrome.runtime.sendMessage({ target: 'offscreen', type: 'challenge-maybe-solved' });
            }, 25000);
        });
        sendResponse({ ok: true });
    }
});

async function startSync(trigger) {
    const { ingestUrl, ingestToken } = await chrome.storage.local.get(['ingestUrl', 'ingestToken']);
    if (!ingestUrl || !ingestToken) {
        chrome.storage.local.set({
            lastStatus: { state: 'error', reason: 'config', detail: 'Set the ingest URL and token in the popup first.', at: Date.now() },
        });
        return;
    }
    chrome.action.setBadgeText({ text: '…' });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    await ensureOffscreen();
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'sync', ingestUrl, ingestToken, trigger });
}

async function ensureOffscreen() {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_PARSER'],
            justification: 'Parse dining hall menu HTML pages',
        });
    }
}

async function closeOffscreen() {
    try {
        if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    } catch (_) { /* already closed */ }
}
