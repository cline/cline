"""
Workflow module.
This module handles the main workflow logic for running coverage tests and processing results.
"""

import os
import re
import sys
import subprocess
import traceback

from .extraction import run_coverage, compare_coverage, extract_coverage
from .github_api import generate_comment, post_comment, set_github_output
from .util import log, file_exists, get_file_size, list_directory, run_command

def is_valid_branch_name(branch_name: str) -> bool:
    """
    Validate a git branch name.
    
    Args:
        branch_name: Branch name to validate
        
    Returns:
        True if valid, False otherwise
    """
    # Check for common branch name patterns
    if not re.match(r'^[a-zA-Z0-9_\-./]+$', branch_name):
        return False
    
    # Check for path traversal
    if '..' in branch_name:
        return False
        
    # Check for shell metacharacters
    if re.search(r'[;&|`$]', branch_name):
        return False
        
    return True

def checkout_branch(branch_name: str) -> None:
    """
    Checkout a branch for testing.
    
    Args:
        branch_name: Branch name to checkout
        
    Raises:
        RuntimeError: If branch checkout fails
        ValueError: If branch name is invalid
    """
    if not is_valid_branch_name(branch_name):
        raise ValueError(f"Invalid branch name: {branch_name}")
        
    log(f"=== Checking out branch: {branch_name} ===")
    
    # Fetch the branch
    returncode, stdout, stderr = run_command(['git', 'fetch', 'origin', branch_name])
    if returncode != 0:
        log(f"ERROR: Failed to fetch branch {branch_name}")
        log(f"Error details: {stderr}")
        raise RuntimeError(f"Git fetch failed: {stderr}")
    
    # Checkout the branch
    returncode, stdout, stderr = run_command(['git', 'checkout', branch_name])
    if returncode != 0:
        log(f"ERROR: Failed to checkout branch {branch_name}")
        log(f"Error details: {stderr}")
        raise RuntimeError(f"Git checkout failed: {stderr}")
    
    log(f"Successfully checked out branch: {branch_name}")

def extract_extension_coverage_from_file(file_path):
    """Extract extension coverage from file when run_coverage returns 0."""
    if not file_exists(file_path):
        log(f"File {file_path} does not exist, cannot extract extension coverage")
        return 0.0
    
    file_size = get_file_size(file_path)
    if file_size == 0:
        log(f"File {file_path} is empty, cannot extract extension coverage")
        return 0.0
        
    log(f"Extension coverage is 0.0, trying to read from file directly: {file_path} (size: {file_size} bytes)")
    with open(file_path, 'r') as f:
        content = f.read()
        # Extract the percentage from the "Lines" row in the coverage summary
        # Pattern: Lines : xx.xx% ( xxxxxxx/xxxxxxx )
        lines_match = re.search(r'Lines\s*:\s*(\d+\.\d+)%', content)
        if lines_match:
            coverage = float(lines_match.group(1))
            log(f"Found extension coverage in file: {coverage}%")
            return coverage
    return 0.0

def extract_webview_coverage_from_file(file_path):
    """Extract webview coverage from file when run_coverage returns 0."""
    if not file_exists(file_path):
        log(f"File {file_path} does not exist, cannot extract webview coverage")
        return 0.0
    
    file_size = get_file_size(file_path)
    if file_size == 0:
        log(f"File {file_path} is empty, cannot extract webview coverage")
        return 0.0
        
    log(f"Webview coverage is 0.0, trying to read from file directly: {file_path} (size: {file_size} bytes)")
    with open(file_path, 'r') as f:
        content = f.read()
        # Extract the percentage from the "% Lines" column in the "All files" row
        # Pattern: All files | xx.xx | xx.xx | xx.xx | xx.xx |
        all_files_match = re.search(r'All files\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+\s+\|\s+(\d+\.\d+)', content)
        if all_files_match:
            coverage = float(all_files_match.group(1))
            log(f"Found webview coverage in file: {coverage}%")
            return coverage
    return 0.0

def run_extension_coverage(branch_name=None):
    """Run extension coverage tests and extract results."""
    prefix = 'base_' if branch_name else ''
    file_path = f"{prefix}extension_coverage.txt"
    
    # Run coverage tests
    ext_cov = run_coverage(
        ["xvfb-run", "-a", "npm", "run", "test:coverage"], 
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
    
    # Save current directory
    original_dir = os.getcwd()
    
    try:
        # Change to webview-ui directory
        os.chdir('webview-ui')
        
        # Install coverage dependency
        returncode, stdout, stderr = run_command(["npm", "install", "--no-save", "@vitest/coverage-v8"])
        if returncode != 0:
            log(f"Failed to install coverage dependency: {stderr}")
            return 0.0
        
        # Run coverage tests from webview-ui directory
        web_cov = run_coverage(
            ["npm", "run", "test:coverage"],
            os.path.join('..', file_path),
            "webview"
        )
    finally:
        # Always change back to original directory
        os.chdir(original_dir)
    
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
    log("Searching for potential coverage files...")
    
    # Find files in current directory
    current_dir_files = list_directory('.')
    for name, size in current_dir_files:
        if 'coverage' in name.lower() and size != "DIR":
            log(f"Found potential coverage file: {name} (size: {size} bytes)")
    
    # Find files in webview-ui directory
    if os.path.exists('webview-ui') and os.path.isdir('webview-ui'):
        webview_files = list_directory('webview-ui')
        for name, size in webview_files:
            if 'coverage' in name.lower() and size != "DIR":
                log(f"Found potential webview coverage file: webview-ui/{name} (size: {size} bytes)")
    else:
        log("webview-ui directory not found")

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

def extract_pr_coverage_from_artifacts():
    """
    Extract PR branch coverage from artifact files.
    
    Returns:
        Tuple of (extension_coverage, webview_coverage)
        
    Raises:
        SystemExit: If the coverage files don't exist
    """
    log("=== Extracting PR branch coverage from artifacts ===")
    
    # Check if the coverage files exist
    ext_file_path = "extension_coverage.txt"
    web_file_path = "webview-ui/webview_coverage.txt"
    
    # Extract extension coverage
    log(f"Extracting extension coverage from {ext_file_path}")
    if not file_exists(ext_file_path):
        error_msg = f"ERROR: PR extension coverage file {ext_file_path} not found"
        log(error_msg)
        
        # List directory contents for debugging
        log("Current directory contents:")
        try:
            dir_contents = list_directory('.')
            for name, size in dir_contents:
                log(f"  {name} - {size}\n")
        except Exception as e:
            log(f"Error listing directory: {e}")
        
        sys.exit(1)  # Exit with error code to fail the workflow
    
    ext_cov = extract_extension_coverage_from_file(ext_file_path)
    log(f"PR extension coverage from artifact: {ext_cov}%")
    
    # Extract webview coverage
    log(f"Extracting webview coverage from {web_file_path}")
    if not file_exists(web_file_path):
        error_msg = f"ERROR: PR webview coverage file {web_file_path} not found"
        log(error_msg)
        
        # Check if the webview-ui directory exists
        if not os.path.exists('webview-ui'):
            log("ERROR: webview-ui directory not found")
        else:
            # List webview-ui directory contents for debugging
            log("webview-ui directory contents:")
            try:
                dir_contents = list_directory('webview-ui')
                for name, size in dir_contents:
                    log(f"  {name} - {size}")
            except Exception as e:
                log(f"Error listing directory: {e}")
        
        sys.exit(1)  # Exit with error code to fail the workflow
    
    web_cov = extract_webview_coverage_from_file(web_file_path)
    log(f"PR webview coverage from artifact: {web_cov}%")
    
    return ext_cov, web_cov

def process_coverage_workflow(args):
    """
    Process the entire coverage workflow.
    
    Args:
        args: Command line arguments
    """
    # Initialize all variables at the start
    pr_ext_cov = 0.0
    pr_web_cov = 0.0
    base_ext_cov = 0.0
    base_web_cov = 0.0
    ext_decreased = False
    ext_diff = 0.0
    web_decreased = False
    web_diff = 0.0
    
    try:
        # Validate branch name
        if not is_valid_branch_name(args.base_branch):
            raise ValueError(f"Invalid base branch name: {args.base_branch}")
        
        # Check if we're running in GitHub Actions
        is_github_actions = 'GITHUB_ACTIONS' in os.environ
        if is_github_actions:
            log("Running in GitHub Actions environment")
        
        # Extract PR branch coverage from artifacts (from test job)
        pr_ext_cov, pr_web_cov = extract_pr_coverage_from_artifacts()
        
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
        
        # Try to output results even if there was an error
        try:
            output_github_results(
                pr_ext_cov, pr_web_cov, base_ext_cov, base_web_cov,
                ext_decreased, ext_diff, web_decreased, web_diff
            )
        except Exception as e2:
            log(f"ERROR outputting GitHub results: {e2}")
