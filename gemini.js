// Gemini Scroll Fix
// 1. Disable browser overflow-anchor (was causing auto-scroll on content growth)
// 2. On send: position new message 20% above bottom
// 3. Lock scroll after that — user manual scroll (upward) unlocks it

const VIEWPORT_RATIO = 0.80; // msg top at 80% down = 20% above input box

let scrollBox = null;
let cachedScrollBox = null;
let locked = false;
let logCount = 0;

function log(...a) { console.log(`[GeminiScrollFix ${logCount++}]`, ...a); }

// ── Step 1: Kill overflow-anchor via CSS ──────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  infinite-scroller.chat-history,
  infinite-scroller.chat-history * {
    overflow-anchor: none !important;
  }
`;
document.head.appendChild(style);
log('overflow-anchor disabled');

// ── Scroll container ──────────────────────────────────────────────────────────
function findScrollBox() {
    // Return cached element if still valid and scrollable
    if (cachedScrollBox && cachedScrollBox.isConnected && cachedScrollBox.scrollHeight > cachedScrollBox.clientHeight) {
        return cachedScrollBox;
    }
    const el = document.querySelector('infinite-scroller.chat-history');
    if (el && el.scrollHeight > el.clientHeight) { cachedScrollBox = el; return el; }
    // fallback: largest scrollable div only (not all elements)
    let best = null, bestOv = 0;
    for (const el of document.querySelectorAll('div')) {
        const ov = window.getComputedStyle(el).overflowY;
        if (!['auto', 'scroll', 'overlay'].includes(ov)) continue;
        const overflow = el.scrollHeight - el.clientHeight;
        if (overflow > bestOv) { best = el; bestOv = overflow; }
    }
    if (best) cachedScrollBox = best;
    return best;
}

function waitForScrollBox(cb) {
    const el = findScrollBox();
    if (el) { cb(el); return; }
    const obs = new MutationObserver(() => {
        const el = findScrollBox();
        if (el) { clearTimeout(timer); obs.disconnect(); cb(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => { obs.disconnect(); log('waitForScrollBox timed out after 10s'); }, 10000);
}

// ── Scroll helper ─────────────────────────────────────────────────────────────
function scrollTo(pos) {
    if (!scrollBox) return;
    const max = scrollBox.scrollHeight - scrollBox.clientHeight;
    scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
    scrollBox.scrollTop = Math.min(Math.max(0, pos), max);
    scrollBox.style.removeProperty('scroll-behavior');
    log('scrollTop set to', Math.round(scrollBox.scrollTop));
}

// ── Position new message 20% above bottom ────────────────────────────────────
function positionNewMessage() {
    const msgs = document.querySelectorAll('user-query');
    if (!msgs.length || !scrollBox) return;
    const msg = msgs[msgs.length - 1];

    // Get message position relative to scroll container
    const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;

    const target = offset - scrollBox.clientHeight * VIEWPORT_RATIO;

    // Gap-close: find previous AI response to prevent gap between it and new message
    let minScroll = 0;
    const prevResponse = msg.previousElementSibling;
    if (prevResponse) {
        const prevOffset = prevResponse.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
        minScroll = prevOffset - 8; // 8px padding from viewport top
    }

    const finalTarget = Math.max(target, minScroll);
    log('positioning: msgOffset=', Math.round(offset), 'target=', Math.round(target), 'minScroll=', Math.round(minScroll), 'final=', Math.round(finalTarget));
    scrollTo(finalTarget);
    locked = true;
    log('scroll locked');
}

// ── Manual scroll detection (upward = unlock) ─────────────────────────────────
let scrollHandler = null;
function setupScrollDetection() {
    // Remove previous listener to prevent stacking on SPA navigation
    if (scrollHandler && scrollBox) scrollBox.removeEventListener('scroll', scrollHandler);
    let lastTop = scrollBox.scrollTop;
    scrollHandler = () => {
        const cur = scrollBox.scrollTop;
        const delta = cur - lastTop;
        lastTop = cur;
        if (locked && delta < -10) {
            locked = false;
            log('user scrolled up — unlocked');
        }
    };
    scrollBox.addEventListener('scroll', scrollHandler, { passive: true });
}

// ── Send detection ────────────────────────────────────────────────────────────
function setupSendDetection() {
    let prevUserCount = document.querySelectorAll('user-query').length;
    let prevResponseCount = document.querySelectorAll('model-response').length;
    let pendingPosition = false;
    let lastCheckTime = 0;
    const THROTTLE_MS = 100;

    const obs = new MutationObserver(() => {
        const now = performance.now();
        if (now - lastCheckTime < THROTTLE_MS) return;
        lastCheckTime = now;

        const userCount = document.querySelectorAll('user-query').length;
        const responseCount = document.querySelectorAll('model-response').length;

        // New user message sent — flag that we need to position soon
        if (userCount > prevUserCount) {
            prevUserCount = userCount;
            pendingPosition = true;
            locked = false;
            log('user message detected, waiting for response bubble...');
        }

        // Model response bubble appeared — NOW measure and position
        // At this point the user message has its final offset
        if (pendingPosition && responseCount > prevResponseCount) {
            prevResponseCount = responseCount;
            pendingPosition = false;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                positionNewMessage();
            }));
        }
    });

    obs.observe(document.body, { childList: true, subtree: true });
    log('send detection active');

    // Expose reset for SPA navigation
    return function resetSendDetection() {
        prevUserCount = document.querySelectorAll('user-query').length;
        prevResponseCount = document.querySelectorAll('model-response').length;
        pendingPosition = false;
        log('send detection counters reset after nav');
    };
}

// ── SPA navigation ────────────────────────────────────────────────────────────
let lastUrl = location.href;
let resetSendDetection = null;
setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    cachedScrollBox = null; // invalidate scrollBox cache on navigation
    log('navigation — rebinding');
    waitForScrollBox(el => {
        scrollBox = el;
        setupScrollDetection();
        if (resetSendDetection) resetSendDetection();
        log('rebound after nav');
    });
}, 500);

// ── Init ──────────────────────────────────────────────────────────────────────
waitForScrollBox(el => {
    scrollBox = el;
    setupScrollDetection();
    resetSendDetection = setupSendDetection();
    log('init complete');
});