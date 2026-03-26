// ChatPin — Background Service Worker
// Safety net: re-injects content scripts when Chrome misses injection
// (tab restore, background tabs, slow SPA renders)

const MATCHES = [
  { pattern: /^https:\/\/chatgpt\.com\//, file: 'content.js' },
  { pattern: /^https:\/\/gemini\.google\.com\//, file: 'gemini.js' },
  { pattern: /^https:\/\/grok\.com\//, file: 'grok.js' },
];

function getScriptForUrl(url) {
  return MATCHES.find(m => m.pattern.test(url));
}

// Re-inject on page load completion (catches missed injections)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const match = getScriptForUrl(tab.url);
  if (!match) return;

  // Inject as safety net — if script is already running, this is harmless
  // because init functions check state before acting
  chrome.scripting.executeScript({
    target: { tabId },
    files: [match.file],
  }).catch(() => {}); // Ignore errors (e.g., tab closed, restricted page)
});

// Re-inject when user activates a tab (catches restored/sleeping tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url) return;
    const match = getScriptForUrl(tab.url);
    if (!match) return;

    chrome.scripting.executeScript({
      target: { tabId: activeInfo.tabId },
      files: [match.file],
    }).catch(() => {});
  } catch (e) {}
});
