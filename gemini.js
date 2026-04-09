// Guard against re-injection by background service worker
if (window.__chatpinLoaded_gemini) throw new Error('[ChatPin] Already loaded');
window.__chatpinLoaded_gemini = true;

// ChatPin — Gemini
// 1. Disable browser overflow-anchor (was causing auto-scroll on content growth)
// 2. On send: position new message 30% above bottom
// 3. Lock scroll after that — user manual scroll (upward) unlocks it

const VIEWPORT_RATIO = 0.70; // msg top at 70% down = 30% above input box

let scrollBox = null;
let cachedScrollBox = null;
let locked = false;
let logCount = 0;
let holdId = null;
let lockedTarget = 0;
let lastProgrammaticScroll = 0;
let lastTop = 0; // track scroll position for delta calculation

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
    // Return cached element if still valid and styled as scrollable
    if (cachedScrollBox && cachedScrollBox.isConnected) {
        const ov = window.getComputedStyle(cachedScrollBox).overflowY;
        if (['auto', 'scroll', 'overlay'].includes(ov)) return cachedScrollBox;
    }
    const el = document.querySelector('infinite-scroller.chat-history');
    if (el) { cachedScrollBox = el; return el; }
    // fallback: largest scrollable div
    let best = null, bestOv = -1;
    for (const el of document.querySelectorAll('div')) {
        const ov = window.getComputedStyle(el).overflowY;
        if (!['auto', 'scroll', 'overlay'].includes(ov)) continue;
        const overflow = el.scrollHeight - el.clientHeight;
        if (overflow > bestOv) { best = el; bestOv = overflow; }
    }
    if (best) cachedScrollBox = best;
    return best;
}

function waitForScrollBox(cb, attempt = 1) {
    const el = findScrollBox();
    if (el) { cb(el); return; }
    const obs = new MutationObserver(() => {
        const el = findScrollBox();
        if (el) { clearTimeout(timer); obs.disconnect(); cb(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
        obs.disconnect();
        if (attempt < 3) {
            log(`waitForScrollBox timed out, retry ${attempt}/3...`);
            waitForScrollBox(cb, attempt + 1);
        } else {
            log('waitForScrollBox failed after 3 attempts');
        }
    }, 10000);
}

// ── Scroll helper ─────────────────────────────────────────────────────────────
function scrollTo(pos) {
    if (!scrollBox) return;
    const max = scrollBox.scrollHeight - scrollBox.clientHeight;
    scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
    scrollBox.scrollTop = Math.min(Math.max(0, pos), max);
    scrollBox.style.removeProperty('scroll-behavior');
    lastProgrammaticScroll = performance.now();
    lastTop = scrollBox.scrollTop;
    log('scrollTop set to', Math.round(scrollBox.scrollTop));
}

// ── Active scroll hold during streaming ──────────────────────────────────────
function startHold(target) {
    stopHold();
    lockedTarget = target;
    holdId = setInterval(() => {
        if (!scrollBox) return;
        if (Math.abs(scrollBox.scrollTop - lockedTarget) > 2) {
            scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
            scrollBox.scrollTop = lockedTarget;
            scrollBox.style.removeProperty('scroll-behavior');
            lastProgrammaticScroll = performance.now();
            lastTop = lockedTarget;
        }
    }, 100);
    log('hold started at', Math.round(target));
}

function stopHold() {
    if (holdId) { clearInterval(holdId); holdId = null; }
    log('hold stopped');
}

// ── Position new message 30% above bottom ────────────────────────────────────
function positionNewMessage() {
    const msgs = document.querySelectorAll('user-query');
    if (!msgs.length || !scrollBox) return;
    const msg = msgs[msgs.length - 1];

    // Get message position relative to scroll container
    const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;

    const target = offset + msg.offsetHeight - scrollBox.clientHeight * VIEWPORT_RATIO;

    // Gap-close: find previous turn's AI response to prevent gap
    let minScroll = 0;
    const container = msg.closest('.conversation-container');
    const prevContainer = container?.previousElementSibling;
    const prevResponse = prevContainer?.querySelector('model-response');
    if (prevResponse) {
        const prevOffset = prevResponse.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
        minScroll = prevOffset - 8; // 8px padding from viewport top
    }

    // If target < 0, content fits in viewport — don't scroll or hold.
    // Let the natural layout handle it. The hold will start when the
    // AI response appears and content overflows.
    if (target < 0) {
        log('content fits viewport, waiting for response');
        return;
    }

    const finalTarget = Math.max(target, minScroll);
    log('positioning: msgOffset=', Math.round(offset), 'target=', Math.round(target), 'minScroll=', Math.round(minScroll), 'final=', Math.round(finalTarget));
    scrollTo(finalTarget);
    locked = true;
    startHold(finalTarget);
    log('scroll locked');
}

// ── Manual scroll detection (upward = unlock) ─────────────────────────────────
let scrollHandler = null;
let wheelHandler = null;
let resizeTimeout = null;

function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Verify scrollBox cache is still scrollable after resize
        if (cachedScrollBox && cachedScrollBox.isConnected) {
            const ov = window.getComputedStyle(cachedScrollBox).overflowY;
            if (!['auto', 'scroll', 'overlay'].includes(ov)) {
                log('Resize: scrollBox lost overflow, clearing cache');
                cachedScrollBox = null;
                const fresh = findScrollBox();
                if (fresh && fresh !== scrollBox) {
                    scrollBox = fresh;
                    log('Resize: rebound to new scrollBox');
                }
            }
        } else if (cachedScrollBox) {
            log('Resize: scrollBox disconnected, clearing cache');
            cachedScrollBox = null;
        }

        // Recalculate hold target for new viewport dimensions
        if (holdId && scrollBox) {
            const msgs = document.querySelectorAll('user-query');
            if (msgs.length && scrollBox.isConnected) {
                const msg = msgs[msgs.length - 1];
                const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
                const newTarget = offset + msg.offsetHeight - scrollBox.clientHeight * VIEWPORT_RATIO;
                const max = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);

                if (newTarget > 0) {
                    lockedTarget = Math.min(Math.max(0, newTarget), max);
                    log(`Resize: recalculated hold ${Math.round(lockedTarget)}`);
                } else {
                    stopHold();
                    log('Resize: content fits viewport, hold released');
                }
            } else {
                stopHold();
                log('Resize: no message or scrollBox gone, hold released');
            }
        }
    }, 150);
}

window.addEventListener('resize', handleResize);

function setupScrollDetection() {
    // Remove previous listeners to prevent stacking on SPA navigation
    if (scrollHandler && scrollBox) scrollBox.removeEventListener('scroll', scrollHandler);
    if (scrollBox && wheelHandler) {
        scrollBox.removeEventListener('wheel', wheelHandler);
    }
    wheelHandler = () => stopHold();
    scrollBox.addEventListener('wheel', wheelHandler, { passive: true });
    lastTop = scrollBox.scrollTop;
    scrollHandler = () => {
        const cur = scrollBox.scrollTop;
        const delta = cur - lastTop;
        lastTop = cur;
        if (locked && performance.now() - lastProgrammaticScroll > 300 && delta < -3) {
            locked = false;
            stopHold();
            log('user scrolled up — hold released');
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
            stopHold();
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
    stopHold();
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