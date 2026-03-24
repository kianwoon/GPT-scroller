// Grok Scroll Fix
// 1. On send: position new user message 20% above bottom
// 2. Hold that position with interval while streaming
// 3. User scrolling up stops the hold

const VIEWPORT_RATIO = 0.80;
let scrollBox = null;
let cachedScrollBox = null;
let locked = false;
let lockedTarget = 0;
let holdId = null;
let lastProgrammaticScroll = 0; // timestamp of last extension-driven scroll
let logCount = 0;
let scrollHandler = null;

function log(...a) { console.log(`[GrokScrollFix ${logCount++}]`, ...a); }

// ── Find scroll container ─────────────────────────────────────────────────────
function findScrollBox() {
    // Return cached element if still valid and scrollable
    if (cachedScrollBox && cachedScrollBox.isConnected && cachedScrollBox.scrollHeight > cachedScrollBox.clientHeight + 10) {
        return cachedScrollBox;
    }
    const el = Array.from(document.querySelectorAll('.overflow-y-auto'))
        .filter(el => el.scrollHeight > el.clientHeight + 10)
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || null;
    if (el) cachedScrollBox = el;
    return el;
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

// ── Hold position at 100ms ────────────────────────────────────────────────────
function startHold(target) {
    stopHold();
    lockedTarget = target;
    locked = true;
    holdId = setInterval(() => {
        if (!scrollBox || !locked) return;
        if (Math.abs(scrollBox.scrollTop - lockedTarget) > 2) {
            scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
            scrollBox.scrollTop = lockedTarget;
            scrollBox.style.removeProperty('scroll-behavior');
            lastProgrammaticScroll = performance.now();
        }
    }, 100);
    log('hold started at', Math.round(target));
}

function stopHold() {
    if (holdId) { clearInterval(holdId); holdId = null; }
    locked = false;
    log('hold stopped');
}

// ── Position user message 20% above bottom ───────────────────────────────────
function positionAndLock() {
    if (!scrollBox) return;

    const turns = document.querySelectorAll('[id^="response-"]');
    if (!turns.length) { log('no turns found'); return; }
    const lastTurn = turns[turns.length - 1];
    const msg = lastTurn.querySelector('.message-bubble');
    if (!msg) { log('no message-bubble found'); return; }

    // Get content offset via getBoundingClientRect (reliable, no offsetTop chain)
    const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;

    // Gap-close: ensure previous AI response remains visible above the new message
    let minScroll = 0;
    const prevTurn = lastTurn.previousElementSibling;
    if (prevTurn) {
        const prevBubble = prevTurn.querySelector('.message-bubble');
        if (prevBubble) {
            const prevOffset = prevBubble.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
            minScroll = prevOffset - 8;
        }
    }

    const max = scrollBox.scrollHeight - scrollBox.clientHeight;
    const target = Math.min(Math.max(0, offset - scrollBox.clientHeight * VIEWPORT_RATIO), max);
    const clampedTarget = Math.max(target, minScroll);
    log('msgOffset:', Math.round(offset), 'target:', Math.round(target), 'minScroll:', Math.round(minScroll), 'clamped:', Math.round(clampedTarget), 'max:', Math.round(max));

    scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
    scrollBox.scrollTop = clampedTarget;
    scrollBox.style.removeProperty('scroll-behavior');
    lastProgrammaticScroll = performance.now();
    startHold(clampedTarget);
}

// ── Manual scroll detection ───────────────────────────────────────────────────
function setupScrollDetection() {
    if (!scrollBox) return;
    // Remove previous listener to prevent stacking on navigation
    if (scrollHandler) scrollBox.removeEventListener('scroll', scrollHandler);
    let lastTop = scrollBox.scrollTop;

    scrollHandler = () => {
        const cur = scrollBox.scrollTop;
        const delta = cur - lastTop;
        lastTop = cur;

        // Ignore scrolls within 100ms of a programmatic scroll
        if (!locked || performance.now() - lastProgrammaticScroll < 100) return;
        if (delta < -10) {
            stopHold();
            log('user scrolled up — released');
        }
    };
    scrollBox.addEventListener('scroll', scrollHandler, { passive: true });
}

// ── Send / navigation detection ───────────────────────────────────────────────
// Grok navigates to a new URL on send, so we detect URL change + new container
let lastUrl = location.href;
let sendDetected = false;

setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    sendDetected = true;
    cachedScrollBox = null; // invalidate cache on navigation
    log('URL changed — waiting for new scroll container');

    waitForScrollBox(el => {
        scrollBox = el;
        setupScrollDetection();
        log('new scrollBox bound, overflow:', el.scrollHeight - el.clientHeight);

        // Position immediately, then again after a short wait for content to render
        requestAnimationFrame(() => requestAnimationFrame(() => {
            positionAndLock();
            // Re-position once more after 300ms to catch any layout shift
            setTimeout(() => {
                if (locked) {
                    log('re-checking position after 300ms');
                    positionAndLock();
                }
            }, 300);
        }));
    });
}, 100); // Check URL every 100ms for faster response

// ── Init ──────────────────────────────────────────────────────────────────────
waitForScrollBox(el => {
    scrollBox = el;
    setupScrollDetection();
    log('init complete, overflow:', el.scrollHeight - el.clientHeight);
});
