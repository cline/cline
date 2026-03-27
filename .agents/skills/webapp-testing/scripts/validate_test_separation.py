#!/usr/bin/env python3
"""
Validate that test code is properly separated from production code.

Usage:
    python3 validate_test_separation.py <project_root>
    python3 validate_test_separation.py .

Exit codes:
    0 - No contamination detected
    1 - Production contamination found
"""
import os
import sys
from pathlib import Path
from typing import Dict, List

def validate_test_separation(project_root: str) -> Dict:
    """Validate test separation architecture."""
    results = {
        'tests_dir_exists': False,
        'next_config_excludes_tests': False,
        'test_api_exists': False,
        'playwright_setup_exists': False,
        'production_contamination': []
    }
    
    root = Path(project_root).resolve()
    
    # Check tests/ directory
    tests_dir = root / 'nextjs' / 'tests'
    results['tests_dir_exists'] = tests_dir.exists()
    
    # Check Next.js config
    next_config = root / 'nextjs' / 'next.config.js'
    if next_config.exists():
        content = next_config.read_text()
        # Check for both webpack exclusion and rewrites
        has_webpack_exclusion = 'tests/' in content and 'ignore-loader' in content
        has_rewrites = '/api/test' in content or 'rewrites' in content
        results['next_config_excludes_tests'] = has_webpack_exclusion or has_rewrites
    
    # Check test API
    test_api = tests_dir / 'test-api' / 'auth' / 'route.ts'
    results['test_api_exists'] = test_api.exists()
    
    # Check Playwright setup
    playwright_setup = tests_dir / 'playwright' / 'global-setup.ts'
    results['playwright_setup_exists'] = playwright_setup.exists()
    
    # Scan app/ for test contamination
    app_dir = root / 'nextjs' / 'app'
    if app_dir.exists():
        contamination_patterns = [
            'TEST-ONLY',
            'loginWithDemo',
            'Try Demo',
            'MOCK_',
            'test-only',
            'x-test-mode',
            'TEST_MODE'
        ]
        
        for file in app_dir.rglob('*.tsx'):
            try:
                content = file.read_text()
                for pattern in contamination_patterns:
                    if pattern in content:
                        results['production_contamination'].append({
                            'file': str(file.relative_to(root)),
                            'pattern': pattern
                        })
                        break  # Only report once per file
            except Exception as e:
                print(f"Warning: Could not read {file}: {e}", file=sys.stderr)
        
        # Also check TypeScript files
        for file in app_dir.rglob('*.ts'):
            # Skip .d.ts files
            if file.name.endswith('.d.ts'):
                continue
            try:
                content = file.read_text()
                for pattern in contamination_patterns:
                    if pattern in content:
                        results['production_contamination'].append({
                            'file': str(file.relative_to(root)),
                            'pattern': pattern
                        })
                        break
            except Exception as e:
                print(f"Warning: Could not read {file}: {e}", file=sys.stderr)
    
    return results

def print_results(results: Dict) -> int:
    """Print validation results and return exit code."""
    print("=" * 60)
    print("Test Separation Validation Results")
    print("=" * 60)
    print()
    
    # Check infrastructure
    print("Infrastructure Checks:")
    print(f"  ✅ Tests directory exists: {results['tests_dir_exists']}" if results['tests_dir_exists'] 
          else f"  ❌ Tests directory exists: {results['tests_dir_exists']}")
    print(f"  ✅ Next.js config excludes tests: {results['next_config_excludes_tests']}" if results['next_config_excludes_tests']
          else f"  ⚠️  Next.js config excludes tests: {results['next_config_excludes_tests']}")
    print(f"  ✅ Test API exists: {results['test_api_exists']}" if results['test_api_exists']
          else f"  ⚠️  Test API exists: {results['test_api_exists']}")
    print(f"  ✅ Playwright setup exists: {results['playwright_setup_exists']}" if results['playwright_setup_exists']
          else f"  ⚠️  Playwright setup exists: {results['playwright_setup_exists']}")
    print()
    
    # Check contamination
    if results['production_contamination']:
        print(f"❌ Production contamination found in {len(results['production_contamination'])} file(s):")
        print()
        for item in results['production_contamination']:
            print(f"  File: {item['file']}")
            print(f"  Pattern: {item['pattern']}")
            print()
        print("=" * 60)
        print("Action Required:")
        print("  1. Move test code from app/ to tests/ directory")
        print("  2. Remove demo buttons from production UI")
        print("  3. Remove mock APIs from production routes")
        print("  4. Remove TEST-ONLY tags from production code")
        print("=" * 60)
        return 1
    else:
        print("✅ No production contamination detected")
        print()
        
        # Check if infrastructure is complete
        if not results['tests_dir_exists']:
            print("⚠️  Warning: tests/ directory does not exist")
            print("   Run: mkdir -p nextjs/tests/{fixtures,test-api,playwright}")
        if not results['next_config_excludes_tests']:
            print("⚠️  Warning: Next.js config may not exclude tests/ from production")
            print("   See: .agents/skills/webapp-testing/references/test-separation-architecture.md")
        if not results['test_api_exists']:
            print("⚠️  Warning: Test API does not exist")
            print("   Create: nextjs/tests/test-api/auth/route.ts")
        if not results['playwright_setup_exists']:
            print("⚠️  Warning: Playwright setup does not exist")
            print("   Create: nextjs/tests/playwright/global-setup.ts")
        
        print("=" * 60)
        return 0

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 validate_test_separation.py <project_root>")
        print("Example: python3 validate_test_separation.py .")
        sys.exit(1)
    
    project_root = sys.argv[1]
    
    if not os.path.exists(project_root):
        print(f"Error: Project root '{project_root}' does not exist")
        sys.exit(1)
    
    results = validate_test_separation(project_root)
    exit_code = print_results(results)
    sys.exit(exit_code)

if __name__ == '__main__':
    main()
