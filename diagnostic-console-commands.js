// ── DEV TOOL ONLY ─────────────────────────────────────────────────────────────
// This file is NOT included in the extension (not listed in manifest.json).
// Run these commands manually in the browser DevTools console on ChatGPT
// to diagnose scroll container issues.
// ─────────────────────────────────────────────────────────────────────────────

// 1. Check if selector finds anything
const scrollBox = document.querySelector('div[class*="react-scroll-to-bottom"] > div');
console.log("Selector found element:", scrollBox);

// 2. List all divs with scroll in class name
const scrollDivs = document.querySelectorAll('div[class*="scroll"]');
console.log("All scroll-related divs:", scrollDivs.length);
scrollDivs.forEach((div, i) => {
  console.log(`Div ${i}:`, div.className);
});

// 3. Find actual scrollable container (with overflow)
const allDivs = document.querySelectorAll('div');
let scrollContainers = [];
allDivs.forEach(div => {
  const style = getComputedStyle(div);
  if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
    scrollContainers.push(div);
  }
});
console.log("Scrollable containers found:", scrollContainers.length);
scrollContainers.forEach((container, i) => {
  console.log(`Container ${i}:`, container.className, "Height:", container.scrollHeight);
});

// 4. Check for column-reverse in message container
const messages = document.querySelectorAll('[data-message-author-role]');
if (messages.length > 0) {
  const parent = messages[0].parentElement;
  const parentStyle = getComputedStyle(parent);
  console.log("Message container styles:");
  console.log("  flex-direction:", parentStyle.flexDirection);
  console.log("  display:", parentStyle.display);
  console.log("  direction:", parentStyle.direction);
  console.log("  transform:", parentStyle.transform);
}

// 5. Test manual scroll
if (scrollBox) {
  console.log("Testing scroll to bottom...");
  scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: 'smooth' });
  setTimeout(() => {
    console.log("ScrollTop after:", scrollBox.scrollTop);
    console.log("ScrollHeight:", scrollBox.scrollHeight);
  }, 500);
}
