#!/usr/bin/env python3
"""
Wireframe Test Buttons Manager

This script adds/removes test buttons to login page for wireframe testing.
Test buttons allow testers to navigate to unimplemented flows.
"""
import re
import sys
from pathlib import Path
from typing import List, Dict

TEST_BUTTONS_CONFIG = [
    {
        'id': 'test-access',
        'label': 'Test: Access Page',
        'description': 'Navigate to /access (Shared Token Flow)',
        'route': '/access',
        'flow': 'access-control-flow: Flow 4'
    },
    {
        'id': 'test-pending',
        'label': 'Test: Pending Page',
        'description': 'Navigate to /pending (Approval Wait)',
        'route': '/pending',
        'flow': 'access-control-flow: Flow 3'
    },
    {
        'id': 'test-admin',
        'label': 'Test: Admin Dashboard',
        'description': 'Navigate to /admin (Admin Dashboard)',
        'route': '/admin',
        'flow': 'admin-pairing-flow: Flow 1'
    },
    {
        'id': 'test-pairing',
        'label': 'Test: Pairing Page',
        'description': 'Navigate to /admin/users (Pairing Management)',
        'route': '/admin/users',
        'flow': 'admin-pairing-flow: Flow 2'
    },
]

BUTTONS_COMPONENT = '''
// ============================================
// TEST BUTTONS - Wireframe Testing Only
// Remove in production
// ============================================
function TestButtons() {
  const buttons = [
    { id: 'test-access', label: 'Test: Access Page', route: '/access' },
    { id: 'test-pending', label: 'Test: Pending Page', route: '/pending' },
    { id: 'test-admin', label: 'Test: Admin Dashboard', route: '/admin' },
    { id: 'test-pairing', label: 'Test: Pairing Page', route: '/admin/users' },
  ];

  return (
    <div className="mt-4 p-4 border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
      <div className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
        🔧 Wireframe Test Buttons (Remove in production)
      </div>
      <div className="flex flex-wrap gap-2">
        {buttons.map((btn) => (
          <a
            key={btn.id}
            href={btn.route}
            className="px-3 py-1 text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/60 transition-colors"
          >
            {btn.label}
          </a>
        ))}
      </div>
    </div>
  );
}
// ============================================
'''


def add_test_buttons(login_file: str) -> None:
    """Add test buttons to login page"""
    with open(login_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if already added
    if 'TEST BUTTONS' in content:
        print("Test buttons already added.")
        return

    # Add TestButtons component before main component
    content = content.replace(
        'function LoginContent() {',
        BUTTONS_COMPONENT + '\nfunction LoginContent() {'
    )

    # Add TestButtons component render
    content = content.replace(
        '</Card>',
        '</Card>\n      <TestButtons />'
    )

    with open(login_file, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Added test buttons to: {login_file}")


def remove_test_buttons(login_file: str) -> None:
    """Remove test buttons from login page"""
    with open(login_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove TestButtons component
    content = re.sub(
        r'\n// =+.*?TEST BUTTONS.*?// =+.*?'
        r'function TestButtons\(\).*?'
        r'// =+',
        '',
        content,
        flags=re.DOTALL
    )

    # Remove TestButtons render
    content = content.replace('\n      <TestButtons />', '')

    with open(login_file, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Removed test buttons from: {login_file}")


def generate_test_button_config() -> str:
    """Generate test button configuration as JSON"""
    import json
    return json.dumps(TEST_BUTTONS_CONFIG, indent=2)


def main():
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python wireframe_buttons.py add <login_page.tsx>")
        print("  python wireframe_buttons.py remove <login_page.tsx>")
        print("  python wireframe_buttons.py config")
        sys.exit(1)

    action = sys.argv[1]
    login_file = sys.argv[2] if len(sys.argv) > 2 else ""

    if action == "add":
        if not login_file:
            print("Error: Please specify login page file")
            sys.exit(1)
        add_test_buttons(login_file)

    elif action == "remove":
        if not login_file:
            print("Error: Please specify login page file")
            sys.exit(1)
        remove_test_buttons(login_file)

    elif action == "config":
        print(generate_test_button_config())

    else:
        print(f"Unknown action: {action}")
        sys.exit(1)


if __name__ == "__main__":
    main()
