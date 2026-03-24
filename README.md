# ChatGPT Scroll Fix

[![Release](https://img.shields.io/github/v/release/kianwoon/GPT-scroller?style=flat-square&color=blue)](https://github.com/kianwoon/GPT-scroller/releases) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)]() [![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=flat-square)]() [![No Dependencies](https://img.shields.io/badge/dependencies-0-green?style=flat-square)]() [![Browser](https://img.shields.io/badge/browser-Brave/Chrome-informational?style=flat-square)]()

A browser extension that fixes scroll behavior on AI chat sites. Positions your message 20% above the bottom of the viewport when you send it, instead of letting the site snap to the very bottom.

## Features

- Positions user messages at 80% viewport height (20% above the bottom edge)
- Locks scroll position during AI streaming to prevent auto-scroll-to-bottom
- Scroll up at any time to unlock and browse freely through the conversation
- Handles SPA navigation seamlessly (ChatGPT, Gemini) and full page loads (Grok)
- Zero dependencies -- vanilla JavaScript, Manifest V3
- Optimized for Brave browser; works in Chromium-based browsers

## Supported Sites

| Site | Script |
|---|---|
| ChatGPT (`chatgpt.com`) | `content.js` |
| Gemini (`gemini.google.com`) | `gemini.js` |
| Grok (`grok.com`) | `grok.js` |

## Installation

1. Go to the [latest release](https://github.com/kianwoon/GPT-scroller/releases/latest) and download `GPT-scroller-v3.8.zip`
2. Extract the zip file to a folder on your computer
3. Open Brave (or Chrome) and navigate to `brave://extensions` (or `chrome://extensions`)
4. Enable **Developer mode** — toggle in the top-right corner
5. Click **Load unpacked** and select the extracted folder

The extension will take effect immediately on [supported sites](#supported-sites).

## How It Works

Most AI chat interfaces auto-scroll to the absolute bottom of the page when you send a message or when the AI starts streaming its response. This forces your eyes to the bottom edge of the screen, which is awkward and wastes the lower 20% of your viewport.

This extension overrides that behavior. When you send a message, it calculates 80% of the viewport height and scrolls so your message sits at that position. During streaming, it repeatedly locks the scroll to prevent the site from overriding. If you scroll up intentionally, the lock disengages so you can read earlier parts of the conversation without fighting the page.

## Tech Stack

![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=flat-square) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white) ![Chrome Extensions](https://img.shields.io/badge/Chrome_Extensions_API-4285F4?style=flat-square&logo=googlechrome&logoColor=white)

- **Manifest V3** — modern extension standard
- **Vanilla JavaScript** — no build step, no framework, no dependencies
- **CSS** — positioning overrides, smooth scroll control, overflow-anchor management
- **MutationObserver API** — efficient DOM change detection for streaming and navigation
- **getBoundingClientRect** — reliable element positioning across complex DOM trees
