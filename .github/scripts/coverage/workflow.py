"""
Workflow module.
This module handles the main workflow logic for running coverage tests and processing results.
"""

import os
import sys
import re
import subprocess
import traceback

from .extraction import run_coverage, compare_coverage, extract_coverage
from .github_api import generate_comment, post_comment, set_github_output

def log(message):
    """Write a message to stdout and flush."""
    sys.stdout.write(f"{message}\n")
    sys.stdout.flush()

def checkout_branch(branch_name):
    """Checkout a branch for testing."""
    log(f"=== Checking out branch: {branch_name} ===")
    subprocess.run(f"git fetch origin {branch_name}", shell=True)
    subprocess.run(f"git checkout {branch_name}", shell=True)

def extract_extension_coverage_from_file(file_path):
    """Extract extension coverage from file when run_coverage returns 0."""
    if not os.path.exists(file_path):
        return 0.0
        
    log(f"Extension coverage is 0.0, trying to read from file directly: {file_path}")
    with open(file_path, 'r') as f:
        content = f.read()
        # Try to find the coverage summary section
        summary_match = re.search(r'=============================== Coverage summary ===============================\n(.*?)\n=+', content, re.DOTALL)
        if summary_match:
            # Try to extract the Lines percentage
            lines_match = re.search(r'Lines\s*:\s*(\d+\.\d+)%', summary_match.group(1))
            if lines_match:
                coverage = float(lines_match.group(1))
                log(f"Found extension coverage in file: {coverage}%")
                return coverage
    return 0.0

def extract_webview_coverage_from_file(file_path):
    """Extract webview coverage from file when run_coverage returns 0."""
    if not os.path.exists(file_path):
        return 0.0
        
    log(f"Webview coverage is 0.0, trying to read from file directly: {file_path}")
    with open(file_path, 'r') as f:
        content = f.read()
        # Try to find the coverage table
        table_match = re.search(r'All files\s+\|\s+(\d+\.\d+)', content)
        if table_match:
            coverage = float(table_match.group(1))
            log(f"Found webview coverage in file: {coverage}%")
            return coverage
    return 0.0

def run_extension_coverage(branch_name=None):
    """Run extension coverage tests and extract results."""
    prefix = 'base_' if branch_name else ''
    file_path = f"{prefix}extension_coverage.txt"
    
    # Run coverage tests
    ext_cov = run_coverage(
        f"xvfb-run -a npm run test:coverage", 
        file_path, 
        "extension"
    )
    
    # If coverage is 0.0, try to extract from file directly
    if ext_cov == 0.0:
        ext_cov = extract_extension_coverage_from_file(file_path)
        
    return ext_cov

def run_webview_coverage(branch_name=None):
    """Run webview coverage tests and extract results."""
    prefix = 'base_' if branch_name else ''
    file_path = f"{prefix}webview_coverage.txt"
    
    # Run coverage tests
    web_cov = run_coverage(
        f"cd webview-ui && npm run test:coverage", 
        file_path, 
        "webview"
    )
    
    # If coverage is 0.0, try to extract from file directly
    if web_cov == 0.0:
        web_cov = extract_webview_coverage_from_file(file_path)
        
    return web_cov

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
        checkout_branch(branch_name)
    
    # Run coverage tests
    log(f"=== Running coverage tests{' for ' + branch_name if branch_name else ''} ===")
    
    # Run extension and webview coverage
    ext_cov = run_extension_coverage(branch_name)
    web_cov = run_webview_coverage(branch_name)
    
    return ext_cov, web_cov

def find_potential_coverage_files():
    """Find potential coverage files in the current directory and webview-ui."""
    # Find files in current directory
    for file in os.listdir('.'):
        if 'coverage' in file.lower() and os.path.isfile(file):
            log(f"Found potential coverage file: {file}")
    
    # Find files in webview-ui directory
    if os.path.exists('webview-ui'):
        for file in os.listdir('webview-ui'):
            if 'coverage' in file.lower() and os.path.isfile(os.path.join('webview-ui', file)):
                log(f"Found potential webview coverage file: webview-ui/{file}")

def generate_warnings(base_ext_cov, pr_ext_cov, ext_decreased, ext_diff, 
                     base_web_cov, pr_web_cov, web_decreased, web_diff):
    """Generate warnings for coverage decreases."""
    if not (ext_decreased or web_decreased):
        return []
        
    warnings = [
        "Test coverage has decreased in this PR",
        f"Extension coverage: {base_ext_cov}% -> {pr_ext_cov}% (Diff: {ext_diff}%)",
        f"Webview coverage: {base_web_cov}% -> {pr_web_cov}% (Diff: {web_diff}%)"
    ]
    
    # Additional warning for significant decrease (more than 1%)
    if ext_decreased and ext_diff > 1.0:
        warnings.append(f"Extension coverage decreased by more than 1% ({ext_diff}%). Consider adding tests to cover your changes.")
    
    if web_decreased and web_diff > 1.0:
        warnings.append(f"Webview coverage decreased by more than 1% ({web_diff}%). Consider adding tests to cover your changes.")
        
    return warnings

def output_warnings(warnings):
    """Output warnings to GitHub step summary and console."""
    if not warnings:
        return
        
    # Get the GitHub step summary file path from environment variable
    github_step_summary = os.environ.get('GITHUB_STEP_SUMMARY')
    
    # Write to GitHub step summary if available
    if github_step_summary:
        with open(github_step_summary, 'a') as f:
            f.write("## Coverage Warnings\n\n")
            for warning in warnings:
                f.write(f"⚠️ {warning}\n\n")
    
    # Also output to console with ::warning:: syntax for backward compatibility
    for warning in warnings:
        log(f"::warning::{warning}")

def output_github_results(pr_ext_cov, pr_web_cov, base_ext_cov, base_web_cov, 
                         ext_decreased, ext_diff, web_decreased, web_diff):
    """Output results for GitHub Actions."""
    set_github_output("pr_extension_coverage", pr_ext_cov)
    set_github_output("pr_webview_coverage", pr_web_cov)
    set_github_output("base_extension_coverage", base_ext_cov)
    set_github_output("base_webview_coverage", base_web_cov)
    set_github_output("extension_decreased", str(ext_decreased).lower())
    set_github_output("extension_diff", ext_diff)
    set_github_output("webview_decreased", str(web_decreased).lower())
    set_github_output("webview_diff", web_diff)

def process_coverage_workflow(args):
    """
    Process the entire coverage workflow.
    
    Args:
        args: Command line arguments
    """
    try:
        # Check if we're running in GitHub Actions
        is_github_actions = 'GITHUB_ACTIONS' in os.environ
        if is_github_actions:
            log("Running in GitHub Actions environment")
        
        # Run PR branch coverage
        log("=== Running PR branch coverage ===")
        pr_ext_cov, pr_web_cov = run_branch_coverage()
        
        # Verify PR coverage values
        if pr_ext_cov == 0.0:
            log("WARNING: PR extension coverage is 0.0, this may indicate an issue with the coverage report")
            find_potential_coverage_files()
        
        if pr_web_cov == 0.0:
            log("WARNING: PR webview coverage is 0.0, this may indicate an issue with the coverage report")
            find_potential_coverage_files()
        
        # Run base branch coverage
        log(f"=== Running base branch coverage for {args.base_branch} ===")
        base_ext_cov, base_web_cov = run_branch_coverage(args.base_branch)
        
        # Verify base coverage values
        if base_ext_cov == 0.0:
            log("WARNING: Base extension coverage is 0.0, this may indicate an issue with the coverage report")
        
        if base_web_cov == 0.0:
            log("WARNING: Base webview coverage is 0.0, this may indicate an issue with the coverage report")
        
        # Compare coverage
        log("=== Comparing extension coverage ===")
        ext_decreased, ext_diff = compare_coverage(base_ext_cov, pr_ext_cov)
        
        log("=== Comparing webview coverage ===")
        web_decreased, web_diff = compare_coverage(base_web_cov, pr_web_cov)
        
        # Print summary of coverage values
        log("\n=== Coverage Summary ===")
        log(f"PR extension coverage: {pr_ext_cov}%")
        log(f"Base extension coverage: {base_ext_cov}%")
        log(f"Extension coverage change: {'+' if not ext_decreased else '-'}{ext_diff}%")
        log(f"PR webview coverage: {pr_web_cov}%")
        log(f"Base webview coverage: {base_web_cov}%")
        log(f"Webview coverage change: {'+' if not web_decreased else '-'}{web_diff}%")
        
        # Generate and output warnings
        warnings = generate_warnings(
            base_ext_cov, pr_ext_cov, ext_decreased, ext_diff,
            base_web_cov, pr_web_cov, web_decreased, web_diff
        )
        output_warnings(warnings)
        
        # Generate comment
        log("=== Generating comment ===")
        comment = generate_comment(
            base_ext_cov, pr_ext_cov, str(ext_decreased).lower(), ext_diff,
            base_web_cov, pr_web_cov, str(web_decreased).lower(), web_diff
        )
        
        # Save comment to file
        with open("coverage_comment.md", "w") as f:
            f.write(comment)
        
        # Post comment if PR number is provided
        if args.pr_number:
            log(f"=== Posting comment to PR #{args.pr_number} ===")
            post_comment("coverage_comment.md", args.pr_number, args.repo, args.token)
        
        # Output results for GitHub Actions
        output_github_results(
            pr_ext_cov, pr_web_cov, base_ext_cov, base_web_cov,
            ext_decreased, ext_diff, web_decreased, web_diff
        )
        
    except Exception as e:
        log(f"ERROR in process_coverage_workflow: {e}")
        traceback.print_exc()
        # Continue with default values if an error occurs
        pr_ext_cov = pr_ext_cov if 'pr_ext_cov' in locals() else 0.0
        pr_web_cov = pr_web_cov if 'pr_web_cov' in locals() else 0.0
        base_ext_cov = base_ext_cov if 'base_ext_cov' in locals() else 0.0
        base_web_cov = base_web_cov if 'base_web_cov' in locals() else 0.0
        ext_decreased = ext_decreased if 'ext_decreased' in locals() else False
        ext_diff = ext_diff if 'ext_diff' in locals() else 0.0
        web_decreased = web_decreased if 'web_decreased' in locals() else False
        web_diff = web_diff if 'web_diff' in locals() else 0.0
        
        # Try to output results even if there was an error
        try:
            output_github_results(
                pr_ext_cov, pr_web_cov, base_ext_cov, base_web_cov,
                ext_decreased, ext_diff, web_decreased, web_diff
            )
        except Exception as e2:
            log(f"ERROR outputting GitHub results: {e2}")
