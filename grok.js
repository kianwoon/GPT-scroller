// Guard against re-injection by background service worker
if (window.__chatpinLoaded_grok) throw new Error('[ChatPin] Already loaded');
window.__chatpinLoaded_grok = true;

// ChatPin — Grok
// 1. On send: position new user message 30% above bottom
// 2. Hold that position with interval while streaming
// 3. User scrolling up stops the hold

let VIEWPORT_RATIO = 0.70;

// ── Pin Height from Storage ─────────────────────────────────────────────
function applyPinHeight(percent) {
  VIEWPORT_RATIO = 1 - percent / 100;
  // Immediately reposition with new ratio
  if (scrollBox && scrollBox.isConnected) {
    const turns = document.querySelectorAll('[id^="response-"]');
    if (turns.length) {
      const lastTurn = turns[turns.length - 1];
      const msg = lastTurn.querySelector('.message-bubble');
      if (msg) {
        const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
        const target = offset + msg.offsetHeight - scrollBox.clientHeight * VIEWPORT_RATIO;
        const max = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
        if (target > 0) {
          const clamped = Math.min(Math.max(0, target), max);
          lockedTarget = clamped;
          scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
          scrollBox.scrollTop = clamped;
          scrollBox.style.removeProperty('scroll-behavior');
          lastProgrammaticScroll = performance.now();
          if (!holdId) startHold(clamped);
          log(`applyPinHeight: repositioned to ${Math.round(clamped)} (${percent}%)`);
        }
      }
    }
  }
}
chrome.storage.local.get('pinHeight', (r) => {
  applyPinHeight(r.pinHeight ?? 30);
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'chatpin-height-update') applyPinHeight(msg.pinHeight);
});
let scrollBox = null;
let cachedScrollBox = null;
let locked = false;
let lockedTarget = 0;
let holdId = null;
let lastProgrammaticScroll = 0; // timestamp of last extension-driven scroll
let logCount = 0;
let scrollHandler = null;
let wheelHandler = null;
let resizeTimeout = null;

function log(...a) { console.log(`[GrokScrollFix ${logCount++}]`, ...a); }

// ── Find scroll container ─────────────────────────────────────────────────────
function findScrollBox() {
    // Return cached element if still valid and styled as scrollable
    if (cachedScrollBox && cachedScrollBox.isConnected) {
        const ov = window.getComputedStyle(cachedScrollBox).overflowY;
        if (['auto', 'scroll', 'overlay'].includes(ov)) return cachedScrollBox;
    }
    // Accept even without overflow — it will scroll once content arrives
    const el = Array.from(document.querySelectorAll('.overflow-y-auto'))
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || null;
    if (el) cachedScrollBox = el;
    return el;
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

// ── Hold position at 100ms ────────────────────────────────────────────────────
function startHold(target) {
    stopHold();
    lockedTarget = target;
    locked = true;
    holdId = setInterval(() => {
        if (!scrollBox || !locked) return;
        // Always recalculate target with fresh viewport dimensions
        const turns = document.querySelectorAll('[id^="response-"]');
        if (turns.length) {
            const lastTurn = turns[turns.length - 1];
            const msg = lastTurn.querySelector('.message-bubble');
            if (msg) {
                const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
                const freshTarget = offset + msg.offsetHeight - scrollBox.clientHeight * VIEWPORT_RATIO;
                const max = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
                if (freshTarget > 0) {
                    lockedTarget = Math.min(Math.max(0, freshTarget), max);
                }
            }
        }
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
    log('hold stopped');
}

// ── Position user message 30% above bottom ──────────────────────────────────
function positionAndLock() {
    if (!scrollBox) return;

    const turns = document.querySelectorAll('[id^="response-"]');
    if (!turns.length) { log('no turns found'); return; }
    const lastTurn = turns[turns.length - 1];
    const msg = lastTurn.querySelector('.message-bubble');
    if (!msg) { log('no message-bubble found'); return; }

    // Get content offset via getBoundingClientRect (reliable, no offsetTop chain)
    const offset = msg.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;

    // Gap-close: find previous turn's message bubble to prevent gap
    let minScroll = 0;
    // Use turns NodeList instead of previousElementSibling (more robust — Grok turns aren't always siblings)
    const prevTurn = turns.length > 1 ? turns[turns.length - 2] : null;
    if (prevTurn) {
        const prevBubble = prevTurn.querySelector('.message-bubble');
        if (prevBubble) {
            const prevOffset = prevBubble.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top + scrollBox.scrollTop;
            minScroll = prevOffset - 8;
        }
    }

    // If raw target < 0, content fits in viewport — don't scroll or hold.
    // Let the natural layout handle it.
    const rawTarget = offset + msg.offsetHeight - scrollBox.clientHeight * VIEWPORT_RATIO;
    if (rawTarget < 0) {
        log('content fits viewport, waiting for response');
        return;
    }

    const max = scrollBox.scrollHeight - scrollBox.clientHeight;
    const target = Math.min(rawTarget, max);
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
    // Remove previous listeners to prevent stacking on navigation
    if (scrollHandler) scrollBox.removeEventListener('scroll', scrollHandler);
    if (scrollBox && wheelHandler) {
        scrollBox.removeEventListener('wheel', wheelHandler);
    }
    wheelHandler = () => stopHold();
    scrollBox.addEventListener('wheel', wheelHandler, { passive: true });
    let lastTop = scrollBox.scrollTop;

    scrollHandler = () => {
        const cur = scrollBox.scrollTop;
        const delta = cur - lastTop;
        lastTop = cur;

        // Ignore scrolls within 100ms of a programmatic scroll
        if (!locked || performance.now() - lastProgrammaticScroll < 100) return;
        if (delta < -3) {
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

// ── Window resize handling ────────────────────────────────────────────────────
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
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

        if (holdId && scrollBox) {
            const turns = document.querySelectorAll('[id^="response-"]');
            if (turns.length && scrollBox.isConnected) {
                const lastTurn = turns[turns.length - 1];
                const msg = lastTurn.querySelector('.message-bubble');
                if (msg) {
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
                }
            } else {
                stopHold();
                log('Resize: no message or scrollBox gone, hold released');
            }
        }
    }, 150);
}

window.addEventListener('resize', handleResize);

// ── Init ──────────────────────────────────────────────────────────────────────
waitForScrollBox(el => {
    scrollBox = el;
    setupScrollDetection();
    log('init complete, overflow:', el.scrollHeight - el.clientHeight);
});
