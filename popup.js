// ChatPin — Popup Script
// Controls the pin height (distance from bottom of viewport)

const DEFAULT_HEIGHT = 30;
const slider = document.getElementById('heightSlider');
const valueDisplay = document.getElementById('heightValue');
const resetBtn = document.getElementById('resetBtn');

// Load saved value
chrome.storage.local.get('pinHeight', (result) => {
  const height = result.pinHeight ?? DEFAULT_HEIGHT;
  slider.value = height;
  valueDisplay.textContent = height + '%';
});

// Save on change
slider.addEventListener('input', () => {
  const height = parseInt(slider.value, 10);
  valueDisplay.textContent = height + '%';
  chrome.storage.local.set({ pinHeight: height });
  // Notify all ChatPin tabs
  broadcastToTabs(height);
});

// Reset button
resetBtn.addEventListener('click', () => {
  slider.value = DEFAULT_HEIGHT;
  valueDisplay.textContent = DEFAULT_HEIGHT + '%';
  chrome.storage.local.set({ pinHeight: DEFAULT_HEIGHT });
  broadcastToTabs(DEFAULT_HEIGHT);
});

// Send updated height to all matching tabs
function broadcastToTabs(height) {
  const urls = [
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://grok.com/*',
  ];
  urls.forEach((url) => {
    chrome.tabs.query({ url }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'chatpin-height-update',
          pinHeight: height,
        }).catch(() => {}); // Tab may not have content script yet
      });
    });
  });
}
