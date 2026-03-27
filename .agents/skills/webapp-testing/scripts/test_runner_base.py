#!/usr/bin/env python3
"""
Reusable Test Runner Base

Provides structured test execution with result logging, console error capture,
and report generation. Projects import this module to build their own test suites.

Usage as module:
    from test_runner_base import TestRunner

    runner = TestRunner(base_url="http://localhost:3000", project_root=".")
    runner.start()

    # Run tests
    runner.log_test("Login page loads", "PASS")
    runner.log_test("Theme toggle works", "FAIL", "Button not found")

    runner.finish()

Usage as CLI:
    python3 test_runner_base.py [--base-url URL] [--project-root PATH] [--output-dir PATH]
"""
import json
import sys
import os
from datetime import datetime
from pathlib import Path
from typing import Optional


class TestRunner:
    """Structured test runner with result logging and report generation."""

    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        project_root: str = ".",
        suite_name: str = "Integration Test",
        output_dir: Optional[str] = None,
    ):
        self.base_url = base_url
        self.project_root = Path(project_root)
        self.suite_name = suite_name
        self.results = {"passed": 0, "failed": 0, "skipped": 0, "tests": []}
        self.start_time = None
        self.console_errors = []

        # Output directory defaults to aidlc-docs/test/webapp-testing/results/
        if output_dir:
            self.output_dir = Path(output_dir)
        else:
            self.output_dir = self.project_root / "aidlc-docs/test/webapp-testing/results"

    def start(self):
        """Start the test run"""
        self.start_time = datetime.now()
        self.output_dir.mkdir(parents=True, exist_ok=True)

        print("=" * 60)
        print(f"{self.suite_name}")
        print(f"Base URL: {self.base_url}")
        print(f"Started: {self.start_time.isoformat()}")
        print("=" * 60)

    def log_test(self, name: str, status: str, details: str = ""):
        """Log a single test result.

        Args:
            name: Test name/description
            status: "PASS", "FAIL", or "SKIP"
            details: Optional details about the result
        """
        self.results["tests"].append({
            "name": name,
            "status": status,
            "details": details,
            "timestamp": datetime.now().isoformat(),
        })

        if status == "PASS":
            self.results["passed"] += 1
            icon = "+"
        elif status == "FAIL":
            self.results["failed"] += 1
            icon = "x"
        else:
            self.results["skipped"] += 1
            icon = "-"

        print(f"  [{icon}] {name}")
        if details:
            print(f"      {details}")

    def capture_console_errors(self, page):
        """Attach console error listener to a Playwright page.

        Call this after creating a page but before navigating.
        """
        def on_console(msg):
            if msg.type == 'error':
                self.console_errors.append({
                    'text': msg.text,
                    'url': page.url,
                    'timestamp': datetime.now().isoformat(),
                })

        page.on('console', on_console)

    def section(self, name: str):
        """Print a test section header"""
        print(f"\n[{name}]")

    def finish(self) -> dict:
        """Finish the test run, save results and report."""
        end_time = datetime.now()
        duration = (end_time - self.start_time).total_seconds() if self.start_time else 0

        total = self.results['passed'] + self.results['failed'] + self.results['skipped']

        # Print summary
        print(f"\n{'='*60}")
        print("Test Summary")
        print(f"{'='*60}")
        print(f"  Total:   {total}")
        print(f"  Passed:  {self.results['passed']}")
        print(f"  Failed:  {self.results['failed']}")
        print(f"  Skipped: {self.results['skipped']}")
        print(f"  Duration: {duration:.1f}s")
        if self.console_errors:
            print(f"  Console Errors: {len(self.console_errors)}")
        print(f"{'='*60}")

        # Build result data
        result_data = {
            "suite": self.suite_name,
            "timestamp": end_time.isoformat(),
            "duration_seconds": round(duration, 1),
            "total": total,
            "passed": self.results['passed'],
            "failed": self.results['failed'],
            "skipped": self.results['skipped'],
            "tests": self.results['tests'],
            "console_errors": self.console_errors,
        }

        # Save JSON results
        json_path = self.output_dir / "test-results.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(result_data, f, ensure_ascii=False, indent=2)

        # Save Markdown report
        md_path = self.output_dir / "test-results.md"
        self._write_markdown_report(result_data, md_path)

        print(f"\n  Results: {json_path}")
        print(f"  Report:  {md_path}")

        return result_data

    def _write_markdown_report(self, data: dict, path: Path):
        """Generate markdown test report"""
        report = f"""# Test Results: {data['suite']}

**Timestamp:** {data['timestamp']}
**Duration:** {data['duration_seconds']}s

## Summary

| Metric | Count |
|--------|-------|
| Total | {data['total']} |
| Passed | {data['passed']} |
| Failed | {data['failed']} |
| Skipped | {data['skipped']} |

## Test Cases

| # | Test | Status | Details |
|---|------|--------|---------|
"""
        for i, test in enumerate(data['tests'], 1):
            status = test['status']
            icon = "PASS" if status == "PASS" else "FAIL" if status == "FAIL" else "SKIP"
            details = test.get('details', '').replace('|', '\\|')[:80]
            report += f"| {i} | {test['name']} | {icon} | {details} |\n"

        if data.get('console_errors'):
            report += f"\n## Console Errors ({len(data['console_errors'])})\n\n"
            for err in data['console_errors'][:10]:
                report += f"- `{err['text'][:100]}` on `{err['url']}`\n"

        with open(path, 'w', encoding='utf-8') as f:
            f.write(report)

    @property
    def has_failures(self) -> bool:
        return self.results['failed'] > 0


def main():
    """Demo: run a simple test to verify the runner works"""
    import argparse

    parser = argparse.ArgumentParser(description='Test Runner Base')
    parser.add_argument('--base-url', default='http://localhost:3000')
    parser.add_argument('--project-root', default=os.getcwd())
    parser.add_argument('--output-dir', default=None)
    args = parser.parse_args()

    runner = TestRunner(
        base_url=args.base_url,
        project_root=args.project_root,
        suite_name="Self-Test",
        output_dir=args.output_dir,
    )
    runner.start()
    runner.section("Verify Runner")
    runner.log_test("TestRunner initializes", "PASS")
    runner.log_test("log_test works", "PASS")
    runner.log_test("Section headers work", "PASS")
    result = runner.finish()

    if runner.has_failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
