# ChatPin

[![Release](https://img.shields.io/github/v/release/kianwoon/GPT-scroller?style=flat-square&color=blue)](https://github.com/kianwoon/GPT-scroller/releases) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)]() [![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=flat-square)]() [![No Dependencies](https://img.shields.io/badge/dependencies-0-green?style=flat-square)]() [![Browser](https://img.shields.io/badge/browser-Brave/Chrome-informational?style=flat-square)]()

When you use AI chatbots daily for work and personal tasks, every time you send a new message it jumps to the top of the page, pushing your previous context off-screen. The AI response you were reading disappears, and you have to scroll back up to find where you left off. This happens dozens of times a day and becomes a constant source of friction.

This extension fixes that. When you send a new message, it positions it at 20% above the input box, keeping the tail of the previous AI response visible above it. It also blocks auto-scroll during AI streaming, so you can read your context without the page jumping around on you. No more losing context. No more scrolling up after every send.

## Features

- Positions user messages at 80% viewport height (20% above the bottom edge)
- Locks scroll position during AI streaming to prevent auto-scroll-to-bottom
- Scroll up at any time to unlock and browse freely through the conversation
- Blocks auto-scroll during AI streaming — read your context without the page jumping around
- Handles SPA navigation seamlessly (ChatGPT, Gemini) and full page loads (Grok)
- Zero dependencies -- vanilla JavaScript, Manifest V3
- Optimized for Brave browser; works in Chromium-based browsers

## The Problem

- ChatGPT, Gemini, and Grok all jump to the top of the page when you send a message, pushing your previous context off-screen
- Your previous context disappears, forcing manual scroll-up every time to find what you were reading
- This friction repeats dozens of times per day across multiple AI tools
- It breaks your reading flow and kills productivity

## The Solution

- New messages anchor at 20% above the input box — always visible, always in context
- Auto-scroll during streaming is blocked — your reading position stays put while the AI responds
- Scroll up at any time to unlock and browse freely; the lock re-engages once you're back near the bottom
- No gap, no lost context, no manual scrolling
- Works across ChatGPT, Gemini, and Grok — one extension for all your AI tools

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

## Tech Stack

![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=flat-square) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white) ![Chrome Extensions](https://img.shields.io/badge/Chrome_Extensions_API-4285F4?style=flat-square&logo=googlechrome&logoColor=white)

- **Manifest V3** — modern extension standard
- **Vanilla JavaScript** — no build step, no framework, no dependencies
- **CSS** — positioning overrides, smooth scroll control, overflow-anchor management
- **MutationObserver API** — efficient DOM change detection for streaming and navigation
- **getBoundingClientRect** — reliable element positioning across complex DOM trees
