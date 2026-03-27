#!/usr/bin/env python3
"""
Reusable Page Reconnaissance Script

Navigates to all screens defined in screen-inventory.md and captures:
- DOM structure (buttons, links, inputs, headings)
- Screenshots per page
- Accessibility tree snapshots
- Page load status

Output: aidlc-docs/test/webapp-testing/reconnaissance/ directory with per-screen JSON + screenshots

Usage:
  python3 test_reconnaissance.py [project_root] [--base-url URL] [--screens SCR-AUTH-01,SCR-APP-01]

Examples:
  python3 test_reconnaissance.py .
  python3 test_reconnaissance.py . --base-url http://localhost:3000
  python3 test_reconnaissance.py . --screens SCR-AUTH-01,SCR-AUTH-02
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


SCREEN_ROUTE_MAP = {
    'SCR-AUTH-01': '/login',
    'SCR-AUTH-02': '/pending',
    'SCR-AUTH-03': '/access',
    'SCR-APP-01': '/studio',
    'SCR-APP-02': '/playground',
    'SCR-APP-03': '/marketplace',
    'SCR-APP-04': '/search',
    'SCR-ADM-01': '/admin',
    'SCR-ADM-02': '/admin/users',
    'SCR-ADM-03': '/admin/usage',
    'SCR-ADM-04': '/admin/health',
}


def parse_screen_inventory(project_root: str) -> List[Dict]:
    """Parse screen-inventory.md for screen list"""
    inventory_file = Path(project_root) / "aidlc-docs/discovery/screen-design/screen-inventory.md"

    if not inventory_file.exists():
        print(f"Warning: screen-inventory.md not found, using default screen map")
        return [{'id': k, 'route': v, 'name': k} for k, v in SCREEN_ROUTE_MAP.items()]

    screens = []
    in_table = False

    with open(inventory_file, 'r', encoding='utf-8') as f:
        for line in f:
            if '| ID |' in line:
                in_table = True
                continue
            if in_table and line.startswith('|---'):
                continue
            if in_table and line.startswith('| '):
                parts = [p.strip() for p in line.split('|')[1:-1]]
                if len(parts) >= 3 and parts[0].startswith('SCR-'):
                    screens.append({
                        'id': parts[0],
                        'name': parts[1],
                        'route': parts[2],
                    })
            elif in_table and not line.startswith('|'):
                in_table = False

    return screens


def discover_page(page, url: str) -> Dict:
    """Discover UI elements on a single page"""
    result = {
        'url': url,
        'timestamp': datetime.now().isoformat(),
        'status': 'unknown',
        'title': '',
        'buttons': [],
        'links': [],
        'inputs': [],
        'headings': [],
        'images': [],
        'data_testids': [],
    }

    try:
        response = page.goto(url, wait_until='networkidle', timeout=15000)
        result['status'] = 'loaded'
        result['http_status'] = response.status if response else None
        result['title'] = page.title()
    except Exception as e:
        result['status'] = 'error'
        result['error'] = str(e)
        return result

    # Wait a bit for dynamic content
    page.wait_for_timeout(1000)

    # Discover buttons
    try:
        buttons = page.locator('button').all()
        for btn in buttons:
            try:
                if btn.is_visible():
                    result['buttons'].append({
                        'text': btn.inner_text().strip()[:100],
                        'disabled': btn.is_disabled(),
                        'testid': btn.get_attribute('data-testid') or '',
                    })
            except Exception:
                pass
    except Exception:
        pass

    # Discover links
    try:
        links = page.locator('a[href]').all()
        for link in links[:20]:
            try:
                if link.is_visible():
                    result['links'].append({
                        'text': link.inner_text().strip()[:100],
                        'href': link.get_attribute('href') or '',
                    })
            except Exception:
                pass
    except Exception:
        pass

    # Discover inputs
    try:
        inputs = page.locator('input, textarea, select').all()
        for inp in inputs:
            try:
                result['inputs'].append({
                    'type': inp.get_attribute('type') or 'text',
                    'name': inp.get_attribute('name') or inp.get_attribute('id') or '',
                    'placeholder': inp.get_attribute('placeholder') or '',
                    'visible': inp.is_visible(),
                })
            except Exception:
                pass
    except Exception:
        pass

    # Discover headings
    try:
        headings = page.locator('h1, h2, h3').all()
        for h in headings:
            try:
                if h.is_visible():
                    tag = h.evaluate('el => el.tagName')
                    result['headings'].append({
                        'tag': tag,
                        'text': h.inner_text().strip()[:200],
                    })
            except Exception:
                pass
    except Exception:
        pass

    # Discover data-testid elements
    try:
        testid_els = page.locator('[data-testid]').all()
        for el in testid_els[:30]:
            try:
                result['data_testids'].append(el.get_attribute('data-testid'))
            except Exception:
                pass
    except Exception:
        pass

    return result


def run_reconnaissance(
    project_root: str,
    base_url: str = 'http://localhost:3000',
    screen_filter: Optional[List[str]] = None,
) -> Dict:
    """Run reconnaissance on all screens, output to aidlc-docs/test/webapp-testing/reconnaissance/"""
    from playwright.sync_api import sync_playwright

    screens = parse_screen_inventory(project_root)

    if screen_filter:
        screens = [s for s in screens if s['id'] in screen_filter]

    output_dir = Path(project_root) / "aidlc-docs/test/webapp-testing/reconnaissance"
    screenshot_dir = output_dir / "screenshots"
    output_dir.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    results = {
        'timestamp': datetime.now().isoformat(),
        'base_url': base_url,
        'screens': {},
    }

    print(f"Reconnaissance: {len(screens)} screens at {base_url}")
    print(f"Output: {output_dir}")
    print(f"{'='*60}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()

        for screen in screens:
            screen_id = screen['id']
            route = SCREEN_ROUTE_MAP.get(screen_id, screen.get('route', '/'))
            url = f"{base_url}{route}"

            print(f"\n  [{screen_id}] {screen.get('name', '')} → {url}")

            # Discover page elements
            discovery = discover_page(page, url)
            results['screens'][screen_id] = discovery

            # Take screenshot
            try:
                screenshot_path = str(screenshot_dir / f"{screen_id.lower()}.png")
                page.screenshot(path=screenshot_path, full_page=True)
                discovery['screenshot'] = f"screenshots/{screen_id.lower()}.png"
                print(f"    Status: {discovery['status']} | "
                      f"Buttons: {len(discovery['buttons'])} | "
                      f"Links: {len(discovery['links'])} | "
                      f"Inputs: {len(discovery['inputs'])}")
            except Exception as e:
                print(f"    Screenshot failed: {e}")

            # Save per-screen JSON
            screen_json = output_dir / f"{screen_id.lower()}.json"
            with open(screen_json, 'w', encoding='utf-8') as f:
                json.dump(discovery, f, ensure_ascii=False, indent=2)

        browser.close()

    # Save summary
    summary_file = output_dir / "summary.json"
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # Generate markdown summary
    md_report = generate_recon_report(results)
    report_file = Path(project_root) / "aidlc-docs/test/webapp-testing/reconnaissance-report.md"
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(md_report)

    print(f"\n{'='*60}")
    print(f"Reconnaissance complete!")
    print(f"  Summary: {summary_file}")
    print(f"  Report: {report_file}")
    print(f"  Screenshots: {screenshot_dir}")

    return results


def generate_recon_report(results: Dict) -> str:
    """Generate markdown report from reconnaissance results"""
    report = f"""# Reconnaissance Report

**Generated:** {results['timestamp']}
**Base URL:** {results['base_url']}
**Screens Tested:** {len(results['screens'])}

---

## Screen Summary

| Screen ID | Status | Buttons | Links | Inputs | Headings |
|-----------|--------|---------|-------|--------|----------|
"""

    for screen_id, data in sorted(results['screens'].items()):
        status = data.get('status', '?')
        report += (f"| {screen_id} | {status} | "
                   f"{len(data.get('buttons', []))} | "
                   f"{len(data.get('links', []))} | "
                   f"{len(data.get('inputs', []))} | "
                   f"{len(data.get('headings', []))} |\n")

    report += "\n---\n\n## Per-Screen Details\n"

    for screen_id, data in sorted(results['screens'].items()):
        report += f"\n### {screen_id}\n\n"
        report += f"- **URL:** {data.get('url', '')}\n"
        report += f"- **Status:** {data.get('status', '?')}\n"
        report += f"- **Title:** {data.get('title', '')}\n"

        if data.get('screenshot'):
            report += f"- **Screenshot:** `reconnaissance/{data['screenshot']}`\n"

        if data.get('buttons'):
            report += "\n**Buttons:**\n"
            for btn in data['buttons']:
                disabled = " (disabled)" if btn.get('disabled') else ""
                report += f"- `{btn['text']}`{disabled}\n"

        if data.get('headings'):
            report += "\n**Headings:**\n"
            for h in data['headings']:
                report += f"- {h['tag']}: {h['text']}\n"

        if data.get('inputs'):
            report += "\n**Inputs:**\n"
            for inp in data['inputs']:
                report += f"- `{inp.get('name', '')}` ({inp.get('type', 'text')})\n"

        if data.get('links'):
            report += "\n**Links:**\n"
            for link in data['links'][:10]:
                report += f"- [{link['text'][:40]}]({link['href']})\n"

    return report


def main():
    parser = argparse.ArgumentParser(description='Page Reconnaissance')
    parser.add_argument('project_root', nargs='?', default=os.getcwd())
    parser.add_argument('--base-url', default='http://localhost:3000',
                        help='Base URL of the running app')
    parser.add_argument('--screens', default=None,
                        help='Comma-separated screen IDs to test (e.g. SCR-AUTH-01,SCR-APP-01)')
    args = parser.parse_args()

    screen_filter = args.screens.split(',') if args.screens else None

    run_reconnaissance(
        project_root=args.project_root,
        base_url=args.base_url,
        screen_filter=screen_filter,
    )


if __name__ == "__main__":
    main()
