const urlInput = document.getElementById('url');
const tokenInput = document.getElementById('token');
const syncBtn = document.getElementById('sync');
const statusEl = document.getElementById('status');

function showStatus(status) {
    if (!status) return;
    statusEl.className = status.state === 'error' ? 'error' : status.state === 'done' ? 'done' : '';
    const when = status.at ? new Date(status.at).toLocaleString() : '';
    statusEl.textContent = `${status.detail || status.state}${when ? `\n(${when})` : ''}`;
}

chrome.storage.local.get(['ingestUrl', 'ingestToken', 'lastStatus'], (cfg) => {
    if (cfg.ingestUrl) urlInput.value = cfg.ingestUrl;
    if (cfg.ingestToken) tokenInput.value = cfg.ingestToken;
    showStatus(cfg.lastStatus);
});

function saveConfig() {
    chrome.storage.local.set({ ingestUrl: urlInput.value.trim(), ingestToken: tokenInput.value.trim() });
}
urlInput.addEventListener('change', saveConfig);
tokenInput.addEventListener('change', saveConfig);

syncBtn.addEventListener('click', () => {
    saveConfig();
    if (!urlInput.value.trim() || !tokenInput.value.trim()) {
        showStatus({ state: 'error', detail: 'Fill in the ingest URL and token first.' });
        return;
    }
    showStatus({ state: 'progress', detail: 'Starting sync…' });
    chrome.runtime.sendMessage({ target: 'background', type: 'sync-now' }, () => void chrome.runtime.lastError);
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target === 'popup' && msg.type === 'sync-status') showStatus(msg.status);
});
