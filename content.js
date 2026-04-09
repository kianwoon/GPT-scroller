// Guard against re-injection by background service worker
if (window.__chatpinLoaded_chatgpt) throw new Error('[ChatPin] Already loaded');
window.__chatpinLoaded_chatgpt = true;

// ChatPin
// Behavior:
// 1. User sends message → place it 30% above bottom of viewport
// 2. AI starts streaming → shift one extra 30% upward, once only
// 3. After that → no auto-scroll until next send

let scrollBox = null;
let cachedScrollBox = null;
let awaitingSendPosition = false;
let streamingShiftApplied = false;
let currentCycleLocked = false;
let stopObserver = null;
let userMsgObserver = null;
let inputAttachObserver = null;
let scrollBoxObserver = null;
let holdId = null;
let lockedTarget = 0;
let lastProgrammaticScroll = 0;
let scrollHandler = null;
let wheelHandler = null;
let lastScrollTop = 0;
let resizeTimeout = null;

const SEND_GAP_PX = 120; // unused, kept for reference
const WAIT_FOR_MSG_MS = 6000;

// ── Logging ───────────────────────────────────────────────────────────────────
let logCount = 0;
function log(...args) {
  console.log(`[ScrollFix ${logCount++}][${new Date().toLocaleTimeString()}]`, ...args);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getLastUserMessage() {
  const msgs = document.querySelectorAll('[data-message-author-role="user"]');
  return msgs.length ? msgs[msgs.length - 1] : null;
}

function getUserMessageCount() {
  return document.querySelectorAll('[data-message-author-role="user"]').length;
}

function isStreamingUIVisible() {
  return !!(
    document.querySelector('button[data-testid="stop-button"]') ||
    document.querySelector('button[aria-label="Stop streaming"]')
  );
}

function findSendButton() {
  return (
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send prompt"]') ||
    document.querySelector('form button[type="submit"]')
  );
}

// ── Find scroll container ─────────────────────────────────────────────────────
function findScrollBox() {
  // Return cached result if still valid
  if (cachedScrollBox && cachedScrollBox.isConnected) {
    const preferred = document.querySelector('div[class*="@w-sm\\/main:"]');
    if (preferred && preferred === cachedScrollBox) {
      return cachedScrollBox;
    }
  }
  // Preferred selector: accept even without overflow — it will scroll once content arrives.
  // The +10 threshold caused findScrollBox to return null after navigation when the
  // conversation was empty/short, breaking all subsequent send flows.
  const preferred = document.querySelector('div[class*="@w-sm\\/main:"]');
  if (preferred) {
    const ov = window.getComputedStyle(preferred).overflowY;
    if (['auto', 'scroll', 'overlay'].includes(ov)) {
      cachedScrollBox = preferred;
      return preferred;
    }
  }
  // Fallback: check cached element
  if (cachedScrollBox && cachedScrollBox.isConnected) {
    return cachedScrollBox;
  }
  // Full scan: largest scrollable DIV (accept any overflowY style, even with 0 overflow)
  let best = null, bestOverflow = -1;
  for (const el of document.querySelectorAll('div')) {
    const ov = window.getComputedStyle(el).overflowY;
    if (!['auto', 'scroll', 'overlay'].includes(ov)) continue;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow > bestOverflow) { best = el; bestOverflow = overflow; }
  }
  if (best) cachedScrollBox = best;
  return best || null;
}

// Watch for scrollBox to appear in DOM (handles late render + navigation)
function waitForScrollBox(callback, attempt = 1) {
  // Try immediately first
  const found = findScrollBox();
  if (found) { callback(found); return; }

  if (scrollBoxObserver) scrollBoxObserver.disconnect();

  scrollBoxObserver = new MutationObserver(() => {
    const el = findScrollBox();
    if (el) {
      clearTimeout(timer);
      scrollBoxObserver.disconnect();
      scrollBoxObserver = null;
      log('scrollBox appeared in DOM');
      callback(el);
    }
  });
  scrollBoxObserver.observe(document.body, { childList: true, subtree: true });
  const timer = setTimeout(() => {
    scrollBoxObserver.disconnect();
    scrollBoxObserver = null;
    if (attempt < 3) {
      log(`scrollBox not found, retry ${attempt}/3...`);
      waitForScrollBox(callback, attempt + 1);
    } else {
      log('scrollBox not found after 3 attempts');
    }
  }, 10000);
  log('Waiting for scrollBox to appear...');
}

// ── Core scroll ───────────────────────────────────────────────────────────────
function setScrollTop(target, reason = '') {
  if (!scrollBox) return;
  const max = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
  const clamped = Math.min(Math.max(0, target), max);
  scrollBox.style.setProperty('scroll-behavior', 'auto', 'important');
  scrollBox.scrollTop = clamped;
  scrollBox.style.removeProperty('scroll-behavior');
  log(`setScrollTop → ${Math.round(clamped)} (target:${Math.round(target)} max:${Math.round(max)}) [${reason}]`);
}

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
    }
  }, 100);
  log('hold started at', Math.round(target));
}

function stopHold() {
  if (holdId) { clearInterval(holdId); holdId = null; }
  log('hold stopped');
}

// ── Positioning ───────────────────────────────────────────────────────────────
function getMsgContentOffset(msg) {
  const msgRect = msg.getBoundingClientRect();
  const boxRect = scrollBox.getBoundingClientRect();
  return msgRect.top - boxRect.top + scrollBox.scrollTop;
}

function positionAfterSend() {
  if (!scrollBox) { log('positionAfterSend: NO scrollBox'); return; }
  if (currentCycleLocked) { log('positionAfterSend: blocked by currentCycleLocked'); return; }
  if (!scrollBox.isConnected) { log('positionAfterSend: scrollBox disconnected'); return; }

  const msg = getLastUserMessage();
  if (!msg) { log('positionAfterSend: no msg found'); return; }

  const msgContentOffset = getMsgContentOffset(msg);

  // Gap-close: find previous AI response to prevent gap between it and new message
  let minScroll = 0;
  // Try direct sibling first, then walk up to parent container
  let prevResponse = msg.previousElementSibling;
  if (!prevResponse) {
    const parentContainer = msg.parentElement?.previousElementSibling;
    prevResponse = parentContainer?.querySelector('[data-message-author-role="assistant"]');
  }
  if (prevResponse) {
    const prevOffset = getMsgContentOffset(prevResponse);
    minScroll = prevOffset - 8; // 8px padding from viewport top
  }

  // Desired: new message bottom at 70% viewport (30% above input box)
  const target = msgContentOffset + msg.offsetHeight - scrollBox.clientHeight * 0.70;

  // If target < 0, content fits in viewport — don't scroll or hold.
  // Let the natural layout handle it. The hold will start when the
  // next message is sent and content overflows.
  if (target < 0) {
    log('Content fits in viewport, waiting for next message');
    return;
  }

  // Don't scroll higher than needed — close the gap between previous response and new message
  const finalTarget = Math.max(target, minScroll);

  log(`positionAfterSend: msgOffset=${Math.round(msgContentOffset)} target=${Math.round(target)} minScroll=${Math.round(minScroll)} final=${Math.round(finalTarget)}`);
  setScrollTop(finalTarget, 'after-send');
  startHold(finalTarget);
}

function positionWhenStreamingStarts() {
  // No additional shift needed — positionAfterSend handles placement correctly.
  // Just lock the cycle so nothing else moves the scroll.
  if (currentCycleLocked || streamingShiftApplied) return;
  streamingShiftApplied = true;
  currentCycleLocked = true;
  log('Cycle locked on streaming start');
}

// ── Streaming detector ────────────────────────────────────────────────────────
function setupStopObserver() {
  if (stopObserver) stopObserver.disconnect();
  let wasStreaming = false;

  stopObserver = new MutationObserver(() => {
    const streaming = isStreamingUIVisible();
    if (streaming && !wasStreaming) {
      wasStreaming = true;
      log('Streaming started');
      if (!awaitingSendPosition) positionWhenStreamingStarts();
      else log('Deferring streaming shift — send position not applied yet');
    }
    if (!streaming && wasStreaming) {
      wasStreaming = false;
      stopHold();
      log('Streaming ended');
    }
  });

  stopObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
  log('Stop observer ready');
}

// ── Send flow ─────────────────────────────────────────────────────────────────
function beginSendFlow(reason) {
  // Only invalidate cache if the cached element is no longer in the DOM
  if (cachedScrollBox && !cachedScrollBox.isConnected) cachedScrollBox = null;
  const fresh = findScrollBox();
  if (fresh) scrollBox = fresh;
  if (!scrollBox) { log('No scrollBox, aborting send flow'); return; }

  const countBefore = getUserMessageCount();
  streamingShiftApplied = false;
  currentCycleLocked = false;
  awaitingSendPosition = true;

  log(`Send [${reason}] | msgs before: ${countBefore} | scrollBox connected: ${scrollBox.isConnected} | box.overflow: ${scrollBox.scrollHeight - scrollBox.clientHeight}`);

  const startedAt = Date.now();

  function poll() {
    // Re-bind scrollBox if it changed (ChatGPT sometimes re-mounts it on send)
    if (cachedScrollBox && !cachedScrollBox.isConnected) cachedScrollBox = null;
    const fresh = findScrollBox();
    if (fresh && fresh !== scrollBox) {
      scrollBox = fresh;
      log('scrollBox rebound during poll');
    }

    if (getUserMessageCount() > countBefore) {
      log(`New user message detected (count: ${getUserMessageCount()} > ${countBefore}), positioning after layout`);
      awaitingSendPosition = false;
      // Use rAF to ensure the message element has been laid out with correct dimensions
      requestAnimationFrame(() => {
        positionAfterSend();
        if (isStreamingUIVisible()) positionWhenStreamingStarts();
      });
      return;
    }

    if (Date.now() - startedAt < WAIT_FOR_MSG_MS) {
      setTimeout(poll, 80);
    } else {
      log('Timed out waiting for user message');
      awaitingSendPosition = false;
    }
  }

  setTimeout(poll, 80);
}

// ── Input listener ────────────────────────────────────────────────────────────
function setupInputListener() {
  // ChatGPT uses a contenteditable div (#prompt-textarea, class=ProseMirror), NOT a real textarea.
  // keydown Enter on contenteditable doesn't bubble the same way — we must also listen
  // for the message appearing in the DOM as a fallback trigger.
  // Strategy: detect new user messages via MutationObserver (most reliable for React apps)
  // AND listen to the Send button click as a secondary trigger.
  let userMsgObserver = null;

  const attach = () => {
    const btn = findSendButton();
    if (btn && !btn.hasAttribute('data-sf-click')) {
      btn.setAttribute('data-sf-click', 'true');
      btn.addEventListener('click', () => beginSendFlow('SendButton'), true);
      log('Send button listener attached');
    }

    // Watch for new user messages in the DOM — this catches both Enter and button click
    // because ChatGPT always adds [data-message-author-role="user"] to the DOM when a
    // user message is submitted, regardless of input method.
    if (!userMsgObserver) {
      let knownMsgCount = getUserMessageCount();
      userMsgObserver = new MutationObserver(() => {
        const count = getUserMessageCount();
        if (count > knownMsgCount) {
          knownMsgCount = count;
          beginSendFlow('MsgAppeared');
        }
      });
      userMsgObserver.observe(document.body, { childList: true, subtree: true });
      log('User message observer attached');
    }

    const promptDiv = document.querySelector('#prompt-textarea');
    if (promptDiv && !promptDiv.hasAttribute('data-sf-key')) {
      promptDiv.setAttribute('data-sf-key', 'true');
      // keydown on contenteditable as secondary trigger (best-effort).
      // The MutationObserver (userMsgObserver) is the primary trigger — it detects
      // when [data-message-author-role="user"] appears in the DOM, which is the
      // most reliable signal regardless of input method.
      promptDiv.addEventListener('keydown', (e) => {
        if (e.isComposing || e.key !== 'Enter' || e.shiftKey) return;
        beginSendFlow('Enter');
      }, true);
      log('Prompt contenteditable listener attached');
    }
  };

  attach();
  // Keep inputAttachObserver running to handle React re-renders of the prompt div.
  // It will call attach() again, but attach() guards against duplicate listeners
  // via data-sf-key / data-sf-click attributes.
  if (!inputAttachObserver) {
    inputAttachObserver = new MutationObserver(attach);
    inputAttachObserver.observe(document.body, { childList: true, subtree: true });
  }
}

// ── Handle ChatGPT navigation (SPA route changes) ─────────────────────────────
// ChatGPT is a SPA — navigating to a new chat replaces the scroll container.
// We watch for URL changes and re-bind when that happens.
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    log('Navigation detected, rebinding scrollBox...');
    stopHold();
    scrollBox = null;
    cachedScrollBox = null;
    stopObserver?.disconnect();
    stopObserver = null;
    // Note: intentionally NOT clearing prompt div data-sf-key marker here.
    // If React reuses the same textarea element, clearing the marker causes
    // setupInputListener to attach a DUPLICATE listener. The marker is only
    // cleared when the element is actually replaced (new element = no marker).
    waitForScrollBox((el) => {
      scrollBox = el;
      // User scroll detection — release hold when user scrolls up
      if (scrollBox && scrollHandler) {
        scrollBox.removeEventListener('scroll', scrollHandler);
      }
      lastScrollTop = scrollBox.scrollTop;
      scrollHandler = () => {
        const cur = scrollBox.scrollTop;
        const delta = cur - lastScrollTop;
        lastScrollTop = cur;
        if (holdId && performance.now() - lastProgrammaticScroll > 100 && delta < -3) {
          stopHold();
          log('user scrolled up — hold released');
        }
      };
      // Wheel event fires before scroll — immediately release hold
      if (scrollBox && wheelHandler) {
        scrollBox.removeEventListener('wheel', wheelHandler);
      }
      wheelHandler = () => stopHold();
      scrollBox.addEventListener('wheel', wheelHandler, { passive: true });
      scrollBox.addEventListener('scroll', scrollHandler, { passive: true });
      setupStopObserver();
      setupInputListener();
      log('Rebound after navigation, scrollBox overflow:', el.scrollHeight - el.clientHeight);
    });
  }
}, 500);

// ── Window resize handling ────────────────────────────────────────────────────
// When the viewport resizes, scrollBox.clientHeight and element positions change.
// If a hold is active, lockedTarget becomes stale — recalculate from the last user
// message's current position and the new viewport dimensions.
function handleResize() {
  // Debounce — layout reflows can fire many resize events in quick succession
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Invalidate scrollBox cache — resize may cause ChatGPT to re-render
    // with different overflow styles, breaking our cached reference.
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

    // If a hold is active, recalculate the target for the new viewport size.
    // This keeps the last user message at the same visual position (70% from top).
    if (holdId && scrollBox) {
      const msg = getLastUserMessage();
      if (msg && scrollBox.isConnected) {
        const msgContentOffset = getMsgContentOffset(msg);
        const newTarget = msgContentOffset + msg.offsetHeight - scrollBox.clientHeight * 0.70;
        const max = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);

        // Same guard as positionAfterSend: don't hold if content fits viewport
        if (newTarget > 0) {
          const clamped = Math.min(Math.max(0, newTarget), max);
          lockedTarget = clamped;
          log(`Resize: recalculated hold ${Math.round(clamped)} (was ${Math.round(lockedTarget)})`);
        } else {
          // Content now fits in viewport after resize — release hold
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

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  waitForScrollBox((el) => {
    scrollBox = el;
    // User scroll detection — release hold when user scrolls up
    if (scrollBox && scrollHandler) {
      scrollBox.removeEventListener('scroll', scrollHandler);
    }
    lastScrollTop = scrollBox.scrollTop;
    scrollHandler = () => {
      if (!scrollBox) return;
      const cur = scrollBox.scrollTop;
      const delta = cur - lastScrollTop;
      lastScrollTop = cur;
      if (holdId && performance.now() - lastProgrammaticScroll > 100 && delta < -3) {
        stopHold();
        log('user scrolled up — hold released');
      }
    };
    // Wheel event fires before scroll — immediately release hold
    if (scrollBox && wheelHandler) {
      scrollBox.removeEventListener('wheel', wheelHandler);
    }
    wheelHandler = () => { if (scrollBox) stopHold(); };
    scrollBox.addEventListener('wheel', wheelHandler, { passive: true });
    scrollBox.addEventListener('scroll', scrollHandler, { passive: true });
    setupStopObserver();
    setupInputListener();
    log('Init complete, scrollBox overflow:', el.scrollHeight - el.clientHeight);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}