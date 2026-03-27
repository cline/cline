"""
capture_screenshots.py
======================
Reusable Playwright screenshot capture script for AIDLC Discovery sprints.

Usage
-----
1. Start the Next.js production server first:
       cd <nextjs-dir>
       npx next build
       PORT=3002 npx next start -H 0.0.0.0

2. Edit CONFIGURATION section below (BASE, SCREENSHOT_DIR, pages).

3. Run:
       python3 capture_screenshots.py

Why production server? See references/helper-skills.md § Next.js Playwright Capture Guide.

Key rules
---------
- Always use http://127.0.0.1:PORT, never http://localhost:PORT
  (macOS may resolve localhost to IPv6 ::1, breaking IPv4 Chromium connections)
- Always use wait_until='domcontentloaded', never 'networkidle'
  (Next.js client fetch() calls prevent network idle state)
- Always add page.wait_for_timeout(3000) after goto to let React render
- Use sync_playwright (not npx playwright test) to avoid config interference
"""

from playwright.sync_api import sync_playwright
import os
import time

# ── CONFIGURATION ─────────────────────────────────────────────────────────────

BASE = "http://127.0.0.1:3002"

# Absolute path to the screenshots directory
SCREENSHOT_DIR = "/path/to/aidlc-docs/discovery/sprint-N/screenshots"

# (name, route) pairs — name becomes the PNG filename
pages = [
    ("studio",           "/studio"),
    ("playground",       "/playground"),
    ("search",           "/search"),
    ("marketplace",      "/marketplace"),
    ("admin-dashboard",  "/admin"),
    ("admin-users",      "/admin/users"),
    ("admin-usage",      "/admin/usage"),
    ("admin-health",     "/admin/health"),
    ("login",            "/login"),
]

VIEWPORT = {"width": 1440, "height": 900}
GOTO_TIMEOUT_MS = 60_000
SETTLE_WAIT_MS  = 3_000
BETWEEN_PAGES_S = 1

# ── CAPTURE ───────────────────────────────────────────────────────────────────

os.makedirs(SCREENSHOT_DIR, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for name, path in pages:
        try:
            context = browser.new_context(viewport=VIEWPORT)
            page = context.new_page()

            response = page.goto(
                f"{BASE}{path}",
                wait_until="domcontentloaded",
                timeout=GOTO_TIMEOUT_MS,
            )
            status = response.status if response else "no-response"
            print(f"{name}: status={status}")

            page.wait_for_timeout(SETTLE_WAIT_MS)

            out = os.path.join(SCREENSHOT_DIR, f"{name}.png")
            page.screenshot(path=out, full_page=True)
            print(f"  -> saved {name}.png")

            context.close()
            time.sleep(BETWEEN_PAGES_S)

        except Exception as e:
            print(f"  FAILED {name}: {e}")

    browser.close()

print("\nDone. All screenshots saved to:", SCREENSHOT_DIR)
