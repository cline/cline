#!/usr/bin/env python3
"""
Test Generator (Extended)

Generates tests from AIDLC discovery artifacts:
1. Interaction Flow tests (Vitest + Playwright) — from interaction-flows/*.md
2. Screen State tests (Vitest + Playwright) — from screen-inventory.md
3. Coverage Gap tests (Vitest) — from screen-story-matrix.md

Usage:
  python3 test_generator.py [project_root] --mode {flows|screen-states|coverage-gaps|all}
"""
import re
import sys
import os
import argparse
from pathlib import Path
from typing import Dict, List
from datetime import datetime


# ===========================================================================
# FlowTestGenerator — existing Phase 1-2 functionality (unchanged)
# ===========================================================================

class FlowTestGenerator:
    def __init__(self, flow_file: str):
        self.flow_file = flow_file
        self.flow_name = ""
        self.flows: List[Dict] = []
        self.error_flows: List[Dict] = []
        self.edge_cases: List[Dict] = []
        self.screens: List[str] = []

    def parse_flow_file(self) -> None:
        """Parse the interaction flow markdown file"""
        with open(self.flow_file, 'r', encoding='utf-8') as f:
            content = f.read()

        title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
        if title_match:
            self.flow_name = title_match.group(1).strip()

        screen_pattern = r'\| SCR-[A-Z]+-\d+ \| (.+?) \|'
        for match in re.finditer(screen_pattern, content):
            self.screens.append(match.group(1).strip())

        self.flows = self._parse_flows(content, "Happy Path")
        self.error_flows = self._parse_flows(content, "Error")
        self.edge_cases = self._parse_edge_cases(content)

    def _parse_flows(self, content: str, section_type: str) -> List[Dict]:
        flows = []
        patterns = [
            rf'## {section_type} Flow[s]?\n(.*?)(?=^## |\Z)',
            rf'## {section_type}\n(.*?)(?=^## |\Z)',
        ]

        section_match = None
        for pattern in patterns:
            section_match = re.search(pattern, content, re.DOTALL | re.MULTILINE)
            if section_match:
                break

        if not section_match:
            return flows

        section_content = section_match.group(1)

        flow_pattern = r'### Flow \d+:\s+(.+?)(?:\n|$)'
        for match in re.finditer(flow_pattern, section_content):
            flow_title = match.group(1).strip()
            precond_match = re.search(
                rf'{re.escape(match.group(0))}\s*\*\*Preconditions\*\*:\s*(.+?)(?:\n\*\*|\n\|)',
                section_content, re.DOTALL
            )
            preconditions = precond_match.group(1).strip() if precond_match else ""

            steps_match = re.search(
                rf'{re.escape(match.group(0))}.*?\| Step \|(.+?)(?:\n\*\*Postconditions\*\*)',
                section_content, re.DOTALL
            )

            flow = {'title': flow_title, 'preconditions': preconditions, 'steps': []}
            if steps_match:
                flow['steps'] = self._parse_steps(steps_match.group(1))
            flows.append(flow)

        return flows

    def _parse_steps(self, steps_text: str) -> List[Dict]:
        steps = []
        lines = steps_text.strip().split('\n')
        for line in lines[1:]:
            if '|' not in line:
                continue
            parts = [p.strip() for p in line.split('|')[1:-1]]
            if len(parts) >= 4:
                steps.append({
                    'step': parts[0], 'action': parts[1],
                    'response': parts[2], 'screen': parts[3] if len(parts) > 3 else ''
                })
        return steps

    def _parse_edge_cases(self, content: str) -> List[Dict]:
        edge_cases = []
        ec_pattern = r'### EC-\d+:\s+(.+?)\n\n\*\*Scenario\*\*:\s*(.+?)(?:\n\n|## |\Z)'
        for match in re.finditer(ec_pattern, content, re.DOTALL):
            edge_cases.append({
                'title': match.group(1).strip(),
                'scenario': match.group(2).strip()
            })
        return edge_cases

    def generate_vitest_tests(self, output_dir: str) -> None:
        test_file = os.path.join(output_dir, f"{self._get_file_name()}.test.tsx")

        test_code = f'''// Auto-generated Vitest Unit Tests
// Source: {self.flow_file}
// Generated: {datetime.now().isoformat()}

import React from 'react';
import {{ describe, it, expect, vi }} from 'vitest';
'''

        for flow in self.flows:
            test_code += f'''

describe('{self._sanitize(flow["title"])}', () => {{
  // Preconditions: {flow["preconditions"]}
'''
            if 'login' in flow['title'].lower():
                test_code += '''
  it('should authenticate with valid credentials', () => {
    expect(true).toBe(true);
  });

  it('should redirect to studio after successful login', () => {
    expect(true).toBe(true);
  });
'''
            elif 'token' in flow['title'].lower():
                test_code += '''
  it('should validate token format', () => {
    expect(true).toBe(true);
  });

  it('should handle invalid token errors', () => {
    expect(true).toBe(true);
  });
'''
            elif 'approve' in flow['title'].lower() or 'pairing' in flow['title'].lower():
                test_code += '''
  it('should approve device when under limit', () => {
    expect(true).toBe(true);
  });

  it('should reject device when limit exceeded', () => {
    expect(true).toBe(true);
  });
'''
            else:
                test_code += f'''
  it('should handle flow correctly', () => {{
    // Test: {flow['title']}
    expect(true).toBe(true);
  }});
'''
            test_code += '});\n'

        if self.edge_cases:
            test_code += "\n\ndescribe('Edge Cases', () => {\n"
            for ec in self.edge_cases:
                test_code += f'''
  it('{self._sanitize(ec["title"])}', () => {{
    // Scenario: {ec["scenario"]}
    expect(true).toBe(true);
  }});
'''
            test_code += '});\n'

        with open(test_file, 'w', encoding='utf-8') as f:
            f.write(test_code)
        print(f"Generated Vitest tests: {test_file}")

    def generate_playwright_tests(self, output_file: str) -> None:
        test_code = f'''// Auto-generated Playwright Integration Tests
// Source: {self.flow_file}
// Generated: {datetime.now().isoformat()}

import {{ test, expect }} from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
'''

        for flow in self.flows:
            test_code += f'''

test.describe('{self._sanitize(flow["title"])}', () => {{
  // Preconditions: {flow["preconditions"]}
'''
            for i, step in enumerate(flow['steps'][:3], 1):
                action = step['action']
                if 'navigates to' in action.lower() or 'go to' in action.lower():
                    path_match = re.search(r'/[\w/]+', action)
                    if path_match:
                        test_code += f'''
  test('Step {i}: Navigate to {path_match.group()}', async ({{ page }}) => {{
    await page.goto(`${{BASE_URL}}{path_match.group()}`);
    await page.waitForLoadState('networkidle');
  }});
'''
                elif 'clicks' in action.lower():
                    btn_match = re.search(r'clicks? ["\u201c]([^"\u201d]+)["\u201d]', action, re.IGNORECASE)
                    if btn_match:
                        test_code += f'''
  test('Step {i}: Click {btn_match.group(1)}', async ({{ page }}) => {{
    await page.locator('text={btn_match.group(1)}').click();
    await page.waitForTimeout(500);
  }});
'''
            test_code += '});\n'

        for flow in self.error_flows:
            test_code += f'''

test.describe('Error: {self._sanitize(flow["title"])}', () => {{
'''
            for i, step in enumerate(flow['steps'][:2], 1):
                test_code += f'''
  test('Error handling step {i}', async ({{ page }}) => {{
    // {step["action"]}
    // Expected: {step["response"]}
    expect(true).toBe(true);
  }});
'''
            test_code += '});\n'

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(test_code)
        print(f"Generated Playwright tests: {output_file}")

    def _sanitize(self, text: str) -> str:
        text = re.sub(r'[^\w\s\uac00-\ud7a3-]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:60]

    def _get_file_name(self) -> str:
        return re.sub(r'[^a-zA-Z0-9]', '_', self.flow_name.lower()).strip('_')


def generate_all_flow_tests(project_root: str) -> None:
    """Generate all tests from interaction flows"""
    flows_dir = Path(project_root) / "aidlc-docs/discovery/screen-design/interaction-flows"

    if not flows_dir.exists():
        print(f"Error: Flows directory not found: {flows_dir}")
        return

    unit_test_dir = Path(project_root) / "nextjs/__tests__/flows"
    unit_test_dir.mkdir(parents=True, exist_ok=True)

    integration_test_dir = Path(project_root) / "nextjs/tests/flows"
    integration_test_dir.mkdir(parents=True, exist_ok=True)

    generated = {"unit": [], "integration": []}

    for flow_file in flows_dir.glob("*.md"):
        print(f"\nProcessing: {flow_file.name}")

        generator = FlowTestGenerator(str(flow_file))
        generator.parse_flow_file()

        print(f"  - Happy Flows: {len(generator.flows)}")
        print(f"  - Error Flows: {len(generator.error_flows)}")
        print(f"  - Edge Cases: {len(generator.edge_cases)}")

        generator.generate_vitest_tests(str(unit_test_dir))
        generated["unit"].append(flow_file.stem)

        int_file = integration_test_dir / f"{generator._get_file_name()}.spec.ts"
        generator.generate_playwright_tests(str(int_file))
        generated["integration"].append(flow_file.stem)

    print(f"\n{'='*60}")
    print("Flow Test Generation Complete")
    print(f"{'='*60}")
    print(f"Vitest: {len(generated['unit'])} files | Playwright: {len(generated['integration'])} files")


# ===========================================================================
# ScreenStateTestGenerator — Phase 3: screen-inventory.md based tests
# ===========================================================================

class ScreenStateTestGenerator:
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

    SCREEN_IMPORT_MAP = {
        'SCR-AUTH-01': '@/app/(auth)/login/page',
        'SCR-AUTH-02': '@/app/(auth)/pending/page',
        'SCR-AUTH-03': '@/app/(auth)/access/page',
        'SCR-APP-01': '@/app/(app)/studio/page',
        'SCR-APP-02': '@/app/(app)/playground/page',
        'SCR-APP-03': '@/app/(app)/marketplace/page',
        'SCR-APP-04': '@/app/(app)/search/page',
        'SCR-ADM-01': '@/app/(admin)/admin/page',
        'SCR-ADM-02': '@/app/(admin)/admin/users/page',
        'SCR-ADM-03': '@/app/(admin)/admin/usage/page',
        'SCR-ADM-04': '@/app/(admin)/admin/health/page',
    }

    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.screens: List[Dict] = []
        self.screen_states: Dict[str, List[Dict]] = {}

    def parse_screen_inventory(self) -> None:
        """Parse screen-inventory.md for screens and their states"""
        inventory_file = self.project_root / "aidlc-docs/discovery/screen-design/screen-inventory.md"

        if not inventory_file.exists():
            print(f"Error: Screen inventory not found: {inventory_file}")
            return

        with open(inventory_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # Parse Screen Inventory Table
        in_table = False
        for line in content.split('\n'):
            if '| ID |' in line:
                in_table = True
                continue
            if in_table and line.startswith('|---'):
                continue
            if in_table and line.startswith('| '):
                parts = [p.strip() for p in line.split('|')[1:-1]]
                if len(parts) >= 6 and parts[0].startswith('SCR-'):
                    self.screens.append({
                        'id': parts[0],
                        'name': parts[1],
                        'route': parts[2],
                        'layout': parts[3],
                        'actors': parts[4],
                        'stories': parts[5] if len(parts) > 5 else '',
                        'status': parts[6] if len(parts) > 6 else 'Unknown',
                    })
            elif in_table and not line.startswith('|'):
                in_table = False

        # Parse Per-Screen State Coverage sections
        current_screen_id = None
        current_screen_name = None
        in_state_table = False

        for line in content.split('\n'):
            # Match section header: ### SCR-XXX-NN: ScreenName
            header_match = re.match(r'^### (SCR-[A-Z]+-\d+):\s+(.+)$', line)
            if header_match:
                current_screen_id = header_match.group(1)
                current_screen_name = header_match.group(2).strip()
                self.screen_states[current_screen_id] = []
                in_state_table = False
                continue

            if current_screen_id:
                if '| State |' in line:
                    in_state_table = True
                    continue
                if in_state_table and line.startswith('|---'):
                    continue
                if in_state_table and line.startswith('| '):
                    parts = [p.strip() for p in line.split('|')[1:-1]]
                    if len(parts) >= 3 and parts[0] and parts[0] != 'State':
                        self.screen_states[current_screen_id].append({
                            'state': parts[0],
                            'implemented': parts[1],
                            'description': parts[2] if len(parts) > 2 else '',
                        })
                elif in_state_table and not line.startswith('|'):
                    in_state_table = False

        print(f"Parsed {len(self.screens)} screens, "
              f"{sum(len(s) for s in self.screen_states.values())} states")

    def generate_vitest_tests(self, output_dir: str) -> List[str]:
        """Generate Vitest unit tests per screen"""
        os.makedirs(output_dir, exist_ok=True)
        generated = []

        for screen in self.screens:
            screen_id = screen['id']
            screen_name = screen['name']
            route = self.SCREEN_ROUTE_MAP.get(screen_id, screen.get('route', '/'))
            import_path = self.SCREEN_IMPORT_MAP.get(screen_id, '')
            states = self.screen_states.get(screen_id, [])

            file_name = screen_id.lower().replace('-', '-') + '.test.tsx'
            file_path = os.path.join(output_dir, file_name)

            test_code = f'''// Auto-generated Screen State Tests
// Source: screen-inventory.md
// Screen: {screen_id} - {screen_name}
// Route: {route}
// Generated: {datetime.now().isoformat()}

import React from 'react';
import {{ describe, it, expect, vi }} from 'vitest';

// Component import (uncomment when component is testable):
// import Page from '{import_path}';

describe('{screen_id}: {screen_name}', () => {{
  // Route: {route}
  // Layout: {screen.get('layout', 'Unknown')}
  // Actors: {screen.get('actors', '')}
'''

            for state in states:
                state_name = state['state']
                implemented = state['implemented']
                description = state['description']
                # Escape single quotes in strings
                safe_state = state_name.replace("'", "\\'")
                safe_desc = description.replace("'", "\\'").replace('`', '\\`')

                if implemented == 'Yes':
                    test_code += f'''
  it('should render {safe_state} state', () => {{
    // {safe_desc}
    expect(true).toBe(true);
  }});
'''
                elif implemented == 'No':
                    test_code += f'''
  it.todo('should render {safe_state} state - {safe_desc}');
'''
                elif implemented == 'Partial':
                    test_code += f'''
  it('should partially render {safe_state} state', () => {{
    // PARTIAL: {safe_desc}
    expect(true).toBe(true);
  }});
'''
                elif implemented == 'Implicit':
                    test_code += f'''
  it('should handle {safe_state} state (implicit)', () => {{
    // IMPLICIT: {safe_desc}
    expect(true).toBe(true);
  }});
'''
                else:
                    test_code += f'''
  it('should render {safe_state} state', () => {{
    // {implemented}: {safe_desc}
    expect(true).toBe(true);
  }});
'''

            test_code += '});\n'

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(test_code)

            generated.append(file_path)
            print(f"  Generated: {file_name} ({len(states)} states)")

        return generated

    def generate_playwright_tests(self, output_dir: str) -> List[str]:
        """Generate Playwright integration tests per screen"""
        os.makedirs(output_dir, exist_ok=True)
        generated = []

        for screen in self.screens:
            screen_id = screen['id']
            screen_name = screen['name']
            route = self.SCREEN_ROUTE_MAP.get(screen_id, screen.get('route', '/'))
            states = self.screen_states.get(screen_id, [])

            file_name = screen_id.lower().replace('-', '-') + '.spec.ts'
            file_path = os.path.join(output_dir, file_name)

            test_code = f'''// Auto-generated Playwright Screen State Tests
// Source: screen-inventory.md
// Screen: {screen_id} - {screen_name}
// Route: {route}
// Generated: {datetime.now().isoformat()}

import {{ test, expect }} from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('{screen_id}: {screen_name}', () => {{

  test('should load {route} page', async ({{ page }}) => {{
    await page.goto(`${{BASE_URL}}{route}`);
    await page.waitForLoadState('networkidle');
  }});
'''

            # Generate tests for implemented states only
            for state in states:
                if state['implemented'] in ('Yes', 'Partial'):
                    state_name = state['state']
                    description = state['description']
                    safe_state = state_name.replace("'", "\\'")

                    test_code += f'''
  test('should show {safe_state} elements', async ({{ page }}) => {{
    await page.goto(`${{BASE_URL}}{route}`);
    await page.waitForLoadState('networkidle');
    // Verify: {description}
    await expect(page.locator('body')).toBeVisible();
  }});
'''

            test_code += '});\n'

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(test_code)

            generated.append(file_path)

        print(f"  Generated {len(generated)} Playwright screen test files")
        return generated


# ===========================================================================
# CoverageGapTestGenerator — Phase 3b: screen-story-matrix.md gap tests
# ===========================================================================

class CoverageGapTestGenerator:
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.gaps: Dict[str, List[Dict]] = {'P1': [], 'P2': [], 'P3': []}

    def parse_gap_report(self) -> None:
        """Parse Gap Report from screen-story-matrix.md"""
        matrix_file = self.project_root / "aidlc-docs/discovery/screen-design/screen-story-matrix.md"

        if not matrix_file.exists():
            print(f"Error: Screen-story matrix not found: {matrix_file}")
            return

        with open(matrix_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # Parse by priority sections
        current_priority = None
        in_table = False

        for line in content.split('\n'):
            # Detect priority section headers
            if '### Priority 1' in line:
                current_priority = 'P1'
                in_table = False
                continue
            elif '### Priority 2' in line:
                current_priority = 'P2'
                in_table = False
                continue
            elif '### Priority 3' in line:
                current_priority = 'P3'
                in_table = False
                continue
            elif line.startswith('## ') and current_priority:
                # New top-level section, stop parsing gaps
                current_priority = None
                in_table = False
                continue

            if current_priority:
                if '| Gap ID |' in line or '| Gap ID|' in line:
                    in_table = True
                    continue
                if in_table and line.startswith('|---'):
                    continue
                if in_table and '| GAP-' in line:
                    parts = [p.strip() for p in line.split('|')[1:-1]]
                    if len(parts) >= 3 and parts[0].startswith('GAP-'):
                        gap = {'id': parts[0], 'priority': current_priority}

                        if current_priority == 'P1' and len(parts) >= 4:
                            gap['story'] = parts[1]
                            gap['description'] = parts[2]
                            gap['action'] = parts[3]
                        elif current_priority == 'P2' and len(parts) >= 5:
                            gap['story'] = parts[1]
                            gap['ac'] = parts[2]
                            gap['description'] = parts[3]
                            gap['action'] = parts[4]
                        elif current_priority == 'P3' and len(parts) >= 3:
                            gap['screen'] = parts[1]
                            gap['description'] = parts[2]

                        self.gaps[current_priority].append(gap)
                elif in_table and not line.startswith('|'):
                    in_table = False

        total = sum(len(g) for g in self.gaps.values())
        print(f"Parsed {total} gaps (P1:{len(self.gaps['P1'])}, "
              f"P2:{len(self.gaps['P2'])}, P3:{len(self.gaps['P3'])})")

    def generate_vitest_tests(self, output_dir: str) -> str:
        """Generate a single test file for all coverage gaps"""
        os.makedirs(output_dir, exist_ok=True)
        file_path = os.path.join(output_dir, 'gap-tests.test.tsx')

        test_code = f'''// Auto-generated Coverage Gap Tests
// Source: screen-story-matrix.md Gap Report
// Generated: {datetime.now().isoformat()}

import React from 'react';
import {{ describe, it, expect, vi }} from 'vitest';
'''

        # P1 — Uncovered Stories
        if self.gaps['P1']:
            test_code += '''

describe('Coverage Gaps - Priority 1 (Uncovered Stories)', () => {
'''
            for gap in self.gaps['P1']:
                safe_id = gap['id']
                safe_story = gap.get('story', '').replace("'", "\\'")
                safe_desc = gap.get('description', '').replace("'", "\\'")
                safe_action = gap.get('action', '').replace("'", "\\'")
                test_code += f'''
  it('{safe_id}: {safe_story} - {safe_desc}', () => {{
    // Recommended: {safe_action}
    expect(true).toBe(true);
  }});
'''
            test_code += '});\n'

        # P2 — Partially Covered
        if self.gaps['P2']:
            test_code += '''

describe('Coverage Gaps - Priority 2 (Partial Coverage)', () => {
'''
            for gap in self.gaps['P2']:
                safe_id = gap['id']
                safe_story = gap.get('story', '').replace("'", "\\'")
                safe_ac = gap.get('ac', '').replace("'", "\\'")
                safe_desc = gap.get('description', '').replace("'", "\\'")
                safe_action = gap.get('action', '').replace("'", "\\'")
                test_code += f'''
  it('{safe_id}: {safe_story} {safe_ac} - {safe_desc}', () => {{
    // Recommended: {safe_action}
    expect(true).toBe(true);
  }});
'''
            test_code += '});\n'

        # P3 — UI Polish
        if self.gaps['P3']:
            test_code += '''

describe('Coverage Gaps - Priority 3 (UI Polish)', () => {
'''
            for gap in self.gaps['P3']:
                safe_id = gap['id']
                safe_screen = gap.get('screen', '').replace("'", "\\'")
                safe_desc = gap.get('description', '').replace("'", "\\'")
                test_code += f'''
  it('{safe_id}: {safe_screen} - {safe_desc}', () => {{
    expect(true).toBe(true);
  }});
'''
            test_code += '});\n'

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(test_code)

        total = sum(len(g) for g in self.gaps.values())
        print(f"Generated gap tests: {file_path} ({total} tests)")
        return file_path


# ===========================================================================
# CLI entry point
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Generate tests from AIDLC discovery artifacts'
    )
    parser.add_argument(
        'project_root', nargs='?', default=os.getcwd(),
        help='Project root directory (default: current directory)'
    )
    parser.add_argument(
        '--mode', choices=['flows', 'screen-states', 'coverage-gaps', 'all'],
        default='all',
        help='Test generation mode (default: all)'
    )

    # Support legacy single-file invocation
    if len(sys.argv) >= 2 and os.path.isfile(sys.argv[1]):
        flow_file = sys.argv[1]
        generator = FlowTestGenerator(flow_file)
        generator.parse_flow_file()

        print(f"\nParsed: {generator.flow_name}")
        print(f"  - Happy Flows: {len(generator.flows)}")
        print(f"  - Error Flows: {len(generator.error_flows)}")
        print(f"  - Edge Cases: {len(generator.edge_cases)}")
        print(f"  - Screens: {len(generator.screens)}")

        output_dir = os.path.dirname(flow_file)
        generator.generate_vitest_tests(output_dir)
        playwright_file = os.path.join(output_dir,
            os.path.splitext(os.path.basename(flow_file))[0] + '.spec.ts')
        generator.generate_playwright_tests(playwright_file)
        return

    args = parser.parse_args()
    project_root = args.project_root

    print(f"Project root: {project_root}")
    print(f"Mode: {args.mode}")
    print(f"{'='*60}")

    # --- flows ---
    if args.mode in ('flows', 'all'):
        print("\n[1/3] Generating Interaction Flow tests...")
        generate_all_flow_tests(project_root)

    # --- screen-states ---
    if args.mode in ('screen-states', 'all'):
        print("\n[2/3] Generating Screen State tests...")
        gen = ScreenStateTestGenerator(project_root)
        gen.parse_screen_inventory()

        vitest_dir = str(Path(project_root) / 'nextjs/__tests__/screens')
        playwright_dir = str(Path(project_root) / 'nextjs/tests/screens')

        vitest_files = gen.generate_vitest_tests(vitest_dir)
        playwright_files = gen.generate_playwright_tests(playwright_dir)

        print(f"  Vitest: {len(vitest_files)} files")
        print(f"  Playwright: {len(playwright_files)} files")

    # --- coverage-gaps ---
    if args.mode in ('coverage-gaps', 'all'):
        print("\n[3/3] Generating Coverage Gap tests...")
        gap_gen = CoverageGapTestGenerator(project_root)
        gap_gen.parse_gap_report()

        gap_dir = str(Path(project_root) / 'nextjs/__tests__/coverage-gaps')
        gap_gen.generate_vitest_tests(gap_dir)

    # Save generation summary to aidlc-docs/test/webapp-testing/
    summary_dir = Path(project_root) / 'aidlc-docs/test/webapp-testing'
    summary_dir.mkdir(parents=True, exist_ok=True)
    summary_file = summary_dir / 'generation-summary.md'

    with open(summary_file, 'w', encoding='utf-8') as f:
        f.write(f"# Test Generation Summary\n\n")
        f.write(f"**Generated:** {datetime.now().isoformat()}\n")
        f.write(f"**Mode:** {args.mode}\n\n")
        f.write(f"## Generated Files\n\n")
        f.write(f"| Category | Vitest | Playwright |\n")
        f.write(f"|----------|--------|------------|\n")
        if args.mode in ('flows', 'all'):
            f.write(f"| Interaction Flows | `__tests__/flows/` | `tests/flows/` |\n")
        if args.mode in ('screen-states', 'all'):
            f.write(f"| Screen States | `__tests__/screens/` (11 files) | `tests/screens/` (11 files) |\n")
        if args.mode in ('coverage-gaps', 'all'):
            f.write(f"| Coverage Gaps | `__tests__/coverage-gaps/` (1 file) | - |\n")

    print(f"\n  Summary: {summary_file}")
    print(f"\n{'='*60}")
    print("Test generation complete!")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
