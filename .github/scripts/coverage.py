#!/usr/bin/env python3
"""
Coverage utility script for GitHub Actions workflows.
This script handles extracting coverage percentages, comparing them, and generating PR comments.

Usage:
  python coverage.py extract-coverage <file_path> [--type=extension|webview]
  python coverage.py compare-coverage <base_cov> <pr_cov>
  python coverage.py generate-comment <base_ext_cov> <pr_ext_cov> <ext_decreased> <ext_diff> <base_web_cov> <pr_web_cov> <web_decreased> <web_diff>
  python coverage.py post-comment <comment_path> <pr_number> <repo> [--token=<github_token>]
  python coverage.py run-coverage <command> <output_file> [--type=extension|webview]
"""

import sys
import os
import re
import json
import argparse
import subprocess
from datetime import datetime
import requests


# Global verbose flag
verbose = False

def set_verbose(value):
    """Set the global verbose flag."""
    global verbose
    verbose = value

def try_pattern(pattern, content, description="", flags=0):
    """
    Try to match a pattern in the content and extract coverage percentage.
    
    Args:
        pattern: Regular expression pattern to match
        content: Content to search in
        description: Description of the pattern for debugging
        flags: Regular expression flags
        
    Returns:
        Coverage percentage as a float if pattern matches, None otherwise
    """
    match = re.search(pattern, content, flags)
    if match:
        coverage_pct = float(match.group(1))
        if verbose:
            if description:
                print(f"Pattern matched ({description}): {coverage_pct}")
            else:
                print(f"Pattern matched: {coverage_pct}")
        return coverage_pct
    return None


def print_debug_output(content, coverage_type):
    """
    Print debug information about the coverage output.
    
    Args:
        content: The content of the coverage file
        coverage_type: Type of coverage report (extension or webview)
    """
    if not verbose:
        return

    # Extract and print only the coverage summary section
    if coverage_type == "extension":
        # Look for the coverage summary section
        summary_match = re.search(r'=============================== Coverage summary ===============================\n(.*?)\n=+', content, re.DOTALL)
        if summary_match:
            sys.stdout.write("\n##[group]EXTENSION COVERAGE SUMMARY\n")
            sys.stdout.write("=============================== Coverage summary ===============================\n")
            sys.stdout.write(summary_match.group(1) + "\n")
            sys.stdout.write("================================================================================\n")
            sys.stdout.write("##[endgroup]\n")
            sys.stdout.flush()
        else:
            sys.stdout.write("\n##[warning]No coverage summary found in extension coverage file\n")
            sys.stdout.flush()
    else:  # webview
        # Look for the coverage table - specifically the "All files" row
        table_match = re.search(r'% Coverage report from v8.*?-+\|.*?\n.*?\n(All files.*?)(?:\n[^\n]*\|)', content, re.DOTALL)
        if table_match:
            sys.stdout.write("\n##[group]WEBVIEW COVERAGE SUMMARY\n")
            sys.stdout.write("% Coverage report from v8\n")
            sys.stdout.write("-------------------|---------|----------|---------|---------|-------------------\n")
            sys.stdout.write("File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s \n")
            sys.stdout.write("-------------------|---------|----------|---------|---------|-------------------\n")
            sys.stdout.write(table_match.group(1) + "\n")
            sys.stdout.write("-------------------|---------|----------|---------|---------|-------------------\n")
            sys.stdout.write("##[endgroup]\n")
            sys.stdout.flush()
        else:
            sys.stdout.write("\n##[warning]No coverage table found in webview coverage file\n")
            sys.stdout.flush()


def extract_coverage(file_path, coverage_type="extension"):
    """
    Extract coverage percentage from a coverage report file.
    
    Args:
        file_path: Path to the coverage report file
        coverage_type: Type of coverage report (extension or webview)
        
    Returns:
        Coverage percentage as a float
    """
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} does not exist")
        return 0.0
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Print debug information if verbose
    print_debug_output(content, coverage_type)
    
    # Define patterns based on coverage type
    if coverage_type == "extension":
        patterns = [
            (r'Lines[^0-9]*([0-9.]+)%', "Lines percentage", 0),
            (r'Coverage summary.*?Lines.*?([0-9.]+)%', "Coverage summary Lines", re.DOTALL),
            (r'=======.*?Lines.*?([0-9.]+)%', "Separator Lines", re.DOTALL),
            (r'All files.*?([0-9.]+).*?%', "All files percentage", 0),
            (r'Statements.*?([0-9.]+).*?%', "Statements percentage", 0),
            (r'Lines.*?([0-9.]+).*?%', "Lines percentage simple", 0),
            (r'Functions.*?([0-9.]+).*?%', "Functions percentage", 0),
            (r'Branches.*?([0-9.]+).*?%', "Branches percentage", 0),
            (r'(\d+\.\d+)%', "Generic percentage", 0)
        ]
    else:  # webview
        patterns = [
            (r'All files\s+\|\s+(\d+\.\d+)', "All files table", 0),
            (r'% Coverage report.*?All files.*?([0-9.]+)%', "Coverage report All files", re.DOTALL),
            (r'Coverage summary.*?All files.*?([0-9.]+)%', "Coverage summary All files", re.DOTALL),
            (r'src/utils\s+\|\s+(\d+\.\d+)', "src/utils table", 0),
            (r'src\s+\|\s+(\d+\.\d+)', "src table", 0),
            (r'All files.*?([0-9.]+).*?%', "All files percentage", 0),
            (r'[^\|]+\|\s+(\d+\.\d+)', "Generic table row", 0),
            (r'(\d+\.\d+)\s+\|\s+\d+(?:\.\d+)?\s+\|\s+\d+(?:\.\d+)?\s+\|\s+\d+(?:\.\d+)?\s+\|.*?\n-+\|', "Complex table row", 0),
            (r'\|\s*(\d+(?:\.\d+)?)\s*\|', "Simple table cell", 0),
            (r'Statements.*?([0-9.]+).*?%', "Statements percentage", 0),
            (r'Lines.*?([0-9.]+).*?%', "Lines percentage", 0),
            (r'Functions.*?([0-9.]+).*?%', "Functions percentage", 0),
            (r'Branches.*?([0-9.]+).*?%', "Branches percentage", 0),
            (r'(\d+\.\d+)%', "Generic percentage", 0)
        ]
    
    # Try each pattern in order
    for pattern_info in patterns:
        pattern = pattern_info[0]
        description = pattern_info[1]
        flags = pattern_info[2]
        
        result = try_pattern(pattern, content, description, flags)
        if result is not None:
            return result
    
    return 0.0


def compare_coverage(base_cov, pr_cov):
    """
    Compare coverage percentages between base and PR branches.
    
    Args:
        base_cov: Base branch coverage percentage
        pr_cov: PR branch coverage percentage
        
    Returns:
        Tuple of (decreased, diff)
    """
    try:
        base_cov = float(base_cov)
        pr_cov = float(pr_cov)
    except ValueError:
        print(f"Error: Invalid coverage values - base: {base_cov}, PR: {pr_cov}")
        return False, 0
    
    diff = pr_cov - base_cov
    decreased = diff < 0
    
    return decreased, abs(diff)


def generate_comment(base_ext_cov, pr_ext_cov, ext_decreased, ext_diff, 
                    base_web_cov, pr_web_cov, web_decreased, web_diff):
    """
    Generate a PR comment with coverage comparison.
    
    Args:
        base_ext_cov: Base branch extension coverage
        pr_ext_cov: PR branch extension coverage
        ext_decreased: Whether extension coverage decreased
        ext_diff: Extension coverage difference
        base_web_cov: Base branch webview coverage
        pr_web_cov: PR branch webview coverage
        web_decreased: Whether webview coverage decreased
        web_diff: Webview coverage difference
        
    Returns:
        Comment text
    """
    # Convert string inputs to appropriate types
    try:
        base_ext_cov = float(base_ext_cov)
        pr_ext_cov = float(pr_ext_cov)
        ext_decreased = ext_decreased.lower() == 'true'
        ext_diff = float(ext_diff)
        base_web_cov = float(base_web_cov)
        pr_web_cov = float(pr_web_cov)
        web_decreased = web_decreased.lower() == 'true'
        web_diff = float(web_diff)
    except ValueError as e:
        print(f"Error converting input values: {e}")
        return ""
    
    # Add a unique identifier to find this comment later
    comment = '<!-- COVERAGE_REPORT -->\n'
    comment += '## Coverage Report\n\n'

    # Extension coverage
    comment += '### Extension Coverage\n\n'
    comment += f'Base branch: {base_ext_cov:.0f}%\n\n'
    comment += f'PR branch: {pr_ext_cov:.0f}%\n\n'

    if ext_decreased:
        comment += f'⚠️ **Warning: Coverage decreased by {ext_diff:.2f}%**\n\n'
        comment += 'Consider adding tests to cover your changes.\n\n'
    else:
        comment += '✅ Coverage increased or remained the same\n\n'

    # Webview coverage
    comment += '### Webview Coverage\n\n'
    comment += f'Base branch: {base_web_cov:.0f}%\n\n'
    comment += f'PR branch: {pr_web_cov:.0f}%\n\n'

    if web_decreased:
        comment += f'⚠️ **Warning: Coverage decreased by {web_diff:.2f}%**\n\n'
        comment += 'Consider adding tests to cover your changes.\n\n'
    else:
        comment += '✅ Coverage increased or remained the same\n\n'

    # Overall assessment
    comment += '### Overall Assessment\n\n'
    if ext_decreased or web_decreased:
        comment += '⚠️ **Test coverage has decreased in this PR**\n\n'
        comment += 'Please consider adding tests to maintain or improve coverage.\n\n'
    else:
        comment += '✅ **Test coverage has been maintained or improved**\n\n'

    # Add timestamp
    comment += f'\n\n<sub>Last updated: {datetime.now().isoformat()}</sub>'
    
    return comment


def post_comment(comment_path, pr_number, repo, token=None):
    """
    Post a comment to a GitHub PR.
    
    Args:
        comment_path: Path to the file containing the comment text
        pr_number: PR number
        repo: Repository in the format "owner/repo"
        token: GitHub token
    """
    if not os.path.exists(comment_path):
        print(f"Error: Comment file {comment_path} does not exist")
        return
    
    with open(comment_path, 'r') as f:
        comment_body = f.read()
    
    if not token:
        token = os.environ.get('GITHUB_TOKEN')
        if not token:
            print("Error: GitHub token not provided")
            return
    
    # Find existing comment
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    # Get all comments
    comments_url = f'https://api.github.com/repos/{repo}/issues/{pr_number}/comments'
    response = requests.get(comments_url, headers=headers)
    
    if response.status_code != 200:
        print(f"Error getting comments: {response.status_code} - {response.text}")
        return
    
    comments = response.json()
    
    # Find comment with our identifier
    comment_id = None
    for comment in comments:
        if '<!-- COVERAGE_REPORT -->' in comment['body']:
            comment_id = comment['id']
            break
    
    if comment_id:
        # Update existing comment
        update_url = f'https://api.github.com/repos/{repo}/issues/comments/{comment_id}'
        response = requests.patch(update_url, headers=headers, json={'body': comment_body})
        
        if response.status_code == 200:
            print(f"Updated existing comment: {comment_id}")
        else:
            print(f"Error updating comment: {response.status_code} - {response.text}")
    else:
        # Create new comment
        response = requests.post(comments_url, headers=headers, json={'body': comment_body})
        
        if response.status_code == 201:
            print("Created new comment")
        else:
            print(f"Error creating comment: {response.status_code} - {response.text}")


def run_coverage(command, output_file, coverage_type="extension"):
    """
    Run a coverage command and extract the coverage percentage.
    
    Args:
        command: Command to run
        output_file: File to save the output to
        coverage_type: Type of coverage report (extension or webview)
        
    Returns:
        Coverage percentage as a float
    """
    try:
        # Run the command and capture output
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        
        # Save output to file
        with open(output_file, 'w') as f:
            f.write(result.stdout)
            if result.stderr:
                f.write("\n\n=== STDERR ===\n")
                f.write(result.stderr)
        
        # Extract coverage percentage
        coverage_pct = extract_coverage(output_file, coverage_type)
        
        print(f"{coverage_type.capitalize()} coverage: {coverage_pct}%")
        return coverage_pct
    
    except Exception as e:
        print(f"Error running coverage command: {e}")
        return 0


def run_branch_coverage(branch_name=None):
    """
    Run coverage tests for a branch.
    
    Args:
        branch_name: Name of the branch to checkout before running tests (optional)
        
    Returns:
        Tuple of (extension_coverage, webview_coverage)
    """
    # Checkout branch if specified
    if branch_name:
        print(f"=== Checking out branch: {branch_name} ===")
        subprocess.run(f"git fetch origin {branch_name}", shell=True)
        subprocess.run(f"git checkout {branch_name}", shell=True)
    
    # Run coverage tests
    print(f"=== Running coverage tests{' for ' + branch_name if branch_name else ''} ===")
    
    # Extension coverage
    ext_cov = run_coverage(
        f"xvfb-run -a npm run test:coverage", 
        f"{'base_' if branch_name else ''}extension_coverage.txt", 
        "extension"
    )
    
    # Webview coverage
    web_cov = run_coverage(
        f"cd webview-ui && npm run test:coverage", 
        f"{'base_' if branch_name else ''}webview_coverage.txt", 
        "webview"
    )
    
    return ext_cov, web_cov

def process_coverage_workflow(args):
    """
    Process the entire coverage workflow.
    
    Args:
        args: Command line arguments
    """
    # Run PR branch coverage
    pr_ext_cov, pr_web_cov = run_branch_coverage()
    
    # Run base branch coverage
    base_ext_cov, base_web_cov = run_branch_coverage(args.base_branch)
    
    # Compare coverage
    print("=== Comparing extension coverage ===")
    ext_decreased, ext_diff = compare_coverage(base_ext_cov, pr_ext_cov)
    
    print("=== Comparing webview coverage ===")
    web_decreased, web_diff = compare_coverage(base_web_cov, pr_web_cov)
    
    # Check for significant coverage decrease and output warnings
    if ext_decreased or web_decreased:
        # Get the GitHub step summary file path from environment variable
        github_step_summary = os.environ.get('GITHUB_STEP_SUMMARY')
        
        # Write warnings to GitHub Actions logs
        warnings = [
            "Test coverage has decreased in this PR",
            f"Extension coverage: {base_ext_cov}% -> {pr_ext_cov}% (Diff: {ext_diff}%)",
            f"Webview coverage: {base_web_cov}% -> {pr_web_cov}% (Diff: {web_diff}%)"
        ]
        
        # Additional warning for significant decrease (more than 1%)
        if ext_diff > 1.0:
            warnings.append(f"Extension coverage decreased by more than 1% ({ext_diff}%). Consider adding tests to cover your changes.")
        
        if web_diff > 1.0:
            warnings.append(f"Webview coverage decreased by more than 1% ({web_diff}%). Consider adding tests to cover your changes.")
        
        # Write to GitHub step summary if available
        if github_step_summary:
            with open(github_step_summary, 'a') as f:
                f.write("## Coverage Warnings\n\n")
                for warning in warnings:
                    f.write(f"⚠️ {warning}\n\n")
        
        # Also output to console with ::warning:: syntax for backward compatibility
        for warning in warnings:
            print(f"::warning::{warning}")
    
    # Generate comment
    print("=== Generating comment ===")
    comment = generate_comment(
        base_ext_cov, pr_ext_cov, str(ext_decreased).lower(), ext_diff,
        base_web_cov, pr_web_cov, str(web_decreased).lower(), web_diff
    )
    
    # Save comment to file
    with open("coverage_comment.md", "w") as f:
        f.write(comment)
    
    # Post comment if PR number is provided
    if args.pr_number:
        print(f"=== Posting comment to PR #{args.pr_number} ===")
        post_comment("coverage_comment.md", args.pr_number, args.repo, args.token)
    
    # Output results for GitHub Actions
    set_github_output("pr_extension_coverage", pr_ext_cov)
    set_github_output("pr_webview_coverage", pr_web_cov)
    set_github_output("base_extension_coverage", base_ext_cov)
    set_github_output("base_webview_coverage", base_web_cov)
    set_github_output("extension_decreased", str(ext_decreased).lower())
    set_github_output("extension_diff", ext_diff)
    set_github_output("webview_decreased", str(web_decreased).lower())
    set_github_output("webview_diff", web_diff)


def set_github_output(name, value):
    """
    Set GitHub Actions output variable.
    
    Args:
        name: Output variable name
        value: Output variable value
    """
    # Write to the GitHub output file if available
    if 'GITHUB_OUTPUT' in os.environ:
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.write(f"{name}={value}\n")
    else:
        # Fallback to the deprecated method for backward compatibility
        print(f"::set-output name={name}::{value}")
    
    # Also print for human readability
    print(f"{name}: {value}")


def main():
    parser = argparse.ArgumentParser(description='Coverage utility script for GitHub Actions workflows')
    parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    subparsers = parser.add_subparsers(dest='command', help='Command to run')
    
    # extract-coverage command
    extract_parser = subparsers.add_parser('extract-coverage', help='Extract coverage percentage from a file')
    extract_parser.add_argument('file_path', help='Path to the coverage report file')
    extract_parser.add_argument('--type', choices=['extension', 'webview'], default='extension',
                               help='Type of coverage report')
    extract_parser.add_argument('--github-output', action='store_true', help='Output in GitHub Actions format')
    extract_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    # compare-coverage command
    compare_parser = subparsers.add_parser('compare-coverage', help='Compare coverage percentages')
    compare_parser.add_argument('base_cov', help='Base branch coverage percentage')
    compare_parser.add_argument('pr_cov', help='PR branch coverage percentage')
    compare_parser.add_argument('--output-prefix', default='', help='Prefix for GitHub Actions output variables')
    compare_parser.add_argument('--github-output', action='store_true', help='Output in GitHub Actions format')
    compare_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    # generate-comment command
    comment_parser = subparsers.add_parser('generate-comment', help='Generate PR comment with coverage comparison')
    comment_parser.add_argument('base_ext_cov', help='Base branch extension coverage')
    comment_parser.add_argument('pr_ext_cov', help='PR branch extension coverage')
    comment_parser.add_argument('ext_decreased', help='Whether extension coverage decreased (true/false)')
    comment_parser.add_argument('ext_diff', help='Extension coverage difference')
    comment_parser.add_argument('base_web_cov', help='Base branch webview coverage')
    comment_parser.add_argument('pr_web_cov', help='PR branch webview coverage')
    comment_parser.add_argument('web_decreased', help='Whether webview coverage decreased (true/false)')
    comment_parser.add_argument('web_diff', help='Webview coverage difference')
    comment_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    # post-comment command
    post_parser = subparsers.add_parser('post-comment', help='Post a comment to a GitHub PR')
    post_parser.add_argument('comment_path', help='Path to the file containing the comment text')
    post_parser.add_argument('pr_number', help='PR number')
    post_parser.add_argument('repo', help='Repository in the format "owner/repo"')
    post_parser.add_argument('--token', help='GitHub token')
    post_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    # run-coverage command
    run_parser = subparsers.add_parser('run-coverage', help='Run a coverage command and extract the coverage percentage')
    run_parser.add_argument('command', help='Command to run')
    run_parser.add_argument('output_file', help='File to save the output to')
    run_parser.add_argument('--type', choices=['extension', 'webview'], default='extension',
                           help='Type of coverage report')
    run_parser.add_argument('--github-output', action='store_true', help='Output in GitHub Actions format')
    run_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    # process-workflow command
    workflow_parser = subparsers.add_parser('process-workflow', help='Process the entire coverage workflow')
    workflow_parser.add_argument('--base-branch', required=True, help='Base branch name')
    workflow_parser.add_argument('--pr-number', help='PR number')
    workflow_parser.add_argument('--repo', help='Repository in the format "owner/repo"')
    workflow_parser.add_argument('--token', help='GitHub token')
    workflow_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    # set-github-output command
    output_parser = subparsers.add_parser('set-github-output', help='Set GitHub Actions output variable')
    output_parser.add_argument('name', help='Output variable name')
    output_parser.add_argument('value', help='Output variable value')
    output_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    # Set verbose flag - check both the main parser and subparser arguments
    if hasattr(args, 'verbose') and args.verbose:
        set_verbose(True)
        print("Verbose mode enabled")
    
    if args.command == 'extract-coverage':
        coverage_pct = extract_coverage(args.file_path, args.type)
        if args.github_output:
            set_github_output(f"{args.type}_coverage", coverage_pct)
        else:
            print(coverage_pct)
        
    elif args.command == 'compare-coverage':
        decreased, diff = compare_coverage(args.base_cov, args.pr_cov)
        if args.github_output:
            prefix = args.output_prefix
            set_github_output(f"{prefix}decreased", str(decreased).lower())
            set_github_output(f"{prefix}diff", diff)
            print(f"Coverage difference: {diff}%")
            print(f"Coverage decreased: {decreased}")
        else:
            print(f"decreased={str(decreased).lower()}")
            print(f"diff={diff}")
        
    elif args.command == 'generate-comment':
        comment = generate_comment(
            args.base_ext_cov, args.pr_ext_cov, args.ext_decreased, args.ext_diff,
            args.base_web_cov, args.pr_web_cov, args.web_decreased, args.web_diff
        )
        # Output the comment to stdout
        print(comment)
        
    elif args.command == 'post-comment':
        post_comment(args.comment_path, args.pr_number, args.repo, args.token)
        
    elif args.command == 'run-coverage':
        coverage_pct = run_coverage(args.command, args.output_file, args.type)
        if args.github_output:
            set_github_output(f"{args.type}_coverage", coverage_pct)
        else:
            print(coverage_pct)
        
    elif args.command == 'process-workflow':
        process_coverage_workflow(args)
        
    elif args.command == 'set-github-output':
        set_github_output(args.name, args.value)
    
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
