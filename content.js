// ChatPin
// Behavior:
// 1. User sends message → place it 20% above bottom of viewport
// 2. AI starts streaming → shift one extra 20% upward, once only
// 3. After that → no auto-scroll until next send

let scrollBox = null;
let cachedScrollBox = null;
let awaitingSendPosition = false;
let streamingShiftApplied = false;
let currentCycleLocked = false;
let stopObserver = null;
let inputAttachObserver = null;
let scrollBoxObserver = null;
let holdId = null;
let lockedTarget = 0;
let lastProgrammaticScroll = 0;
let scrollHandler = null;
let lastScrollTop = 0;

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
  // Confirmed selector from diagnostics
  const preferred = document.querySelector('div[class*="@w-sm\\/main:"]');
  if (preferred && preferred.scrollHeight > preferred.clientHeight + 10) {
    cachedScrollBox = preferred;
    return preferred;
  }
  // Fallback: largest scrollable DIV (only if no cache exists)
  if (cachedScrollBox && cachedScrollBox.isConnected) {
    return cachedScrollBox;
  }
  let best = null, bestOverflow = 0;
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
function waitForScrollBox(callback) {
  // Try immediately first
  const found = findScrollBox();
  if (found) { callback(found); return; }

  if (scrollBoxObserver) scrollBoxObserver.disconnect();

  scrollBoxObserver = new MutationObserver(() => {
    const el = findScrollBox();
    if (el) {
      scrollBoxObserver.disconnect();
      scrollBoxObserver = null;
      log('scrollBox appeared in DOM');
      callback(el);
    }
  });
  scrollBoxObserver.observe(document.body, { childList: true, subtree: true });
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
  if (!scrollBox || currentCycleLocked) return;

  const msg = getLastUserMessage();
  if (!msg) { log('positionAfterSend: no msg found'); return; }

  const msgContentOffset = getMsgContentOffset(msg);

  // Find previous AI response to prevent gap between it and new message
  let minScroll = 0;
  const prevResponse = msg.previousElementSibling;
  if (prevResponse) {
    const prevOffset = getMsgContentOffset(prevResponse);
    minScroll = prevOffset - 8; // 8px padding from viewport top
  }

  // Desired: new message top at 80% viewport (20% above input box)
  const target = msgContentOffset - scrollBox.clientHeight * 0.80;
  // Don't scroll higher than needed — close the gap
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
  // Re-bind scrollBox in case ChatGPT re-rendered it (e.g. after navigation)
  const fresh = findScrollBox();
  if (fresh) scrollBox = fresh;
  if (!scrollBox) { log('No scrollBox, aborting send flow'); return; }

  const countBefore = getUserMessageCount();
  streamingShiftApplied = false;
  currentCycleLocked = false;
  awaitingSendPosition = true;

  log(`Send [${reason}] | msgs before: ${countBefore}`);

  const startedAt = Date.now();

  function poll() {
    // Re-bind scrollBox if it changed (ChatGPT sometimes re-mounts it on send)
    const fresh = findScrollBox();
    if (fresh && fresh !== scrollBox) {
      scrollBox = fresh;
      log('scrollBox rebound during poll');
    }

    if (getUserMessageCount() > countBefore) {
      log('New user message detected, positioning immediately');
      awaitingSendPosition = false;
      positionAfterSend();
      if (isStreamingUIVisible()) positionWhenStreamingStarts();
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
  const attach = () => {
    const textarea =
      document.querySelector('#prompt-textarea') ||
      document.querySelector('textarea');

    let textareaAttached = false;
    let btnAttached = false;

    if (textarea && !textarea.hasAttribute('data-sf-key')) {
      textarea.setAttribute('data-sf-key', 'true');
      textarea.addEventListener('keydown', (e) => {
        if (e.isComposing || e.key !== 'Enter' || e.shiftKey) return;
        beginSendFlow('Enter');
      }, true);
      textareaAttached = true;
      log('Textarea listener attached');
    } else if (textarea && textarea.hasAttribute('data-sf-key')) {
      textareaAttached = true;
    }

    const btn = findSendButton();
    if (btn && !btn.hasAttribute('data-sf-click')) {
      btn.setAttribute('data-sf-click', 'true');
      btn.addEventListener('click', () => beginSendFlow('SendButton'), true);
      btnAttached = true;
      log('Send button listener attached');
    } else if (btn && btn.hasAttribute('data-sf-click')) {
      btnAttached = true;
    }

    // Disconnect observer once both listeners are successfully attached
    if (textareaAttached && btnAttached && inputAttachObserver) {
      inputAttachObserver.disconnect();
      inputAttachObserver = null;
      log('inputAttachObserver disconnected — both listeners attached');
    }
  };

  attach();
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
    // Clear textarea marker so setupInputListener re-attaches after navigation
    const oldTextarea = document.querySelector('textarea[data-sf-key]');
    if (oldTextarea) oldTextarea.removeAttribute('data-sf-key');
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
        if (holdId && performance.now() - lastProgrammaticScroll > 100 && delta < -10) {
          stopHold();
          log('user scrolled up — hold released');
        }
      };
      scrollBox.addEventListener('scroll', scrollHandler, { passive: true });
      setupStopObserver();
      setupInputListener();
      log('Rebound after navigation, scrollBox overflow:', el.scrollHeight - el.clientHeight);
    });
  }
}, 500);

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
      const cur = scrollBox.scrollTop;
      const delta = cur - lastScrollTop;
      lastScrollTop = cur;
      if (holdId && performance.now() - lastProgrammaticScroll > 100 && delta < -10) {
        stopHold();
        log('user scrolled up — hold released');
      }
    };
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