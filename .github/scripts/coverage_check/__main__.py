"""
Main module.
This module provides the CLI interface for the coverage utility script.
"""

import sys
import argparse

from .extraction import extract_coverage, compare_coverage, run_coverage, set_verbose
from .github_api import generate_comment, post_comment, set_github_output
from .workflow import process_coverage_workflow
from .util import log

def setup_verbose_mode(args):
    """
    Set up verbose mode based on command line arguments.
    
    Args:
        args: Parsed command line arguments
    """
    if getattr(args, 'verbose', False):
        set_verbose(True)
        log("Verbose mode enabled")

def main():
    # Create parent parser with common arguments
    parent_parser = argparse.ArgumentParser(add_help=False)
    parent_parser.add_argument('-v', '--verbose', action='store_true', help='Enable verbose output')

    # Create main parser that inherits common arguments
    parser = argparse.ArgumentParser(description='Coverage utility script for GitHub Actions workflows', parents=[parent_parser])
    subparsers = parser.add_subparsers(dest='command', help='Command to run')
    
    # extract-coverage command - used directly in workflow
    extract_parser = subparsers.add_parser('extract-coverage', help='Extract coverage percentage from a file', parents=[parent_parser])
    extract_parser.add_argument('file_path', help='Path to the coverage report file')
    extract_parser.add_argument('--type', choices=['extension', 'webview'], default='extension',
                               help='Type of coverage report')
    extract_parser.add_argument('--github-output', action='store_true', help='Output in GitHub Actions format')
    
    # compare-coverage command - used by process-workflow
    compare_parser = subparsers.add_parser('compare-coverage', help='Compare coverage percentages', parents=[parent_parser])
    compare_parser.add_argument('base_cov', help='Base branch coverage percentage')
    compare_parser.add_argument('pr_cov', help='PR branch coverage percentage')
    compare_parser.add_argument('--output-prefix', default='', help='Prefix for GitHub Actions output variables')
    compare_parser.add_argument('--github-output', action='store_true', help='Output in GitHub Actions format')
    
    # generate-comment command - used by process-workflow
    comment_parser = subparsers.add_parser('generate-comment', help='Generate PR comment with coverage comparison', parents=[parent_parser])
    comment_parser.add_argument('base_ext_cov', help='Base branch extension coverage')
    comment_parser.add_argument('pr_ext_cov', help='PR branch extension coverage')
    comment_parser.add_argument('ext_decreased', help='Whether extension coverage decreased (true/false)')
    comment_parser.add_argument('ext_diff', help='Extension coverage difference')
    comment_parser.add_argument('base_web_cov', help='Base branch webview coverage')
    comment_parser.add_argument('pr_web_cov', help='PR branch webview coverage')
    comment_parser.add_argument('web_decreased', help='Whether webview coverage decreased (true/false)')
    comment_parser.add_argument('web_diff', help='Webview coverage difference')
    
    # post-comment command - used by process-workflow
    post_parser = subparsers.add_parser('post-comment', help='Post a comment to a GitHub PR', parents=[parent_parser])
    post_parser.add_argument('comment_path', help='Path to the file containing the comment text')
    post_parser.add_argument('pr_number', help='PR number')
    post_parser.add_argument('repo', help='Repository in the format "owner/repo"')
    post_parser.add_argument('--token', help='GitHub token')
    
    # run-coverage command - used by process-workflow
    run_parser = subparsers.add_parser('run-coverage', help='Run a coverage command and extract the coverage percentage', parents=[parent_parser])
    run_parser.add_argument('coverage_cmd', help='Command to run')
    run_parser.add_argument('output_file', help='File to save the output to')
    run_parser.add_argument('--type', choices=['extension', 'webview'], default='extension',
                           help='Type of coverage report')
    run_parser.add_argument('--github-output', action='store_true', help='Output in GitHub Actions format')
    
    # process-workflow command - used directly in workflow
    workflow_parser = subparsers.add_parser('process-workflow', help='Process the entire coverage workflow', parents=[parent_parser])
    workflow_parser.add_argument('--base-branch', required=True, help='Base branch name')
    workflow_parser.add_argument('--pr-number', help='PR number')
    workflow_parser.add_argument('--repo', help='Repository in the format "owner/repo"')
    workflow_parser.add_argument('--token', help='GitHub token')
    
    # set-github-output command - used by process-workflow
    output_parser = subparsers.add_parser('set-github-output', help='Set GitHub Actions output variable', parents=[parent_parser])
    output_parser.add_argument('name', help='Output variable name')
    output_parser.add_argument('value', help='Output variable value')
    
    args = parser.parse_args()
    
    # Set up verbose mode
    setup_verbose_mode(args)
    
    if args.command == 'extract-coverage':
        log(f"Extracting coverage from file: {args.file_path} (type: {args.type})")
        coverage_pct = extract_coverage(args.file_path, args.type)
        if args.github_output:
            set_github_output(f"{args.type}_coverage", coverage_pct)
        else:
            log(f"Coverage: {coverage_pct}%")
        
    elif args.command == 'compare-coverage':
        log(f"Comparing coverage: base={args.base_cov}%, PR={args.pr_cov}%")
        decreased, diff = compare_coverage(args.base_cov, args.pr_cov)
        if args.github_output:
            prefix = args.output_prefix
            set_github_output(f"{prefix}decreased", str(decreased).lower())
            set_github_output(f"{prefix}diff", diff)
            log(f"Coverage difference: {diff}%")
            log(f"Coverage decreased: {decreased}")
        else:
            log(f"decreased={str(decreased).lower()}")
            log(f"diff={diff}")
        
    elif args.command == 'generate-comment':
        log("Generating coverage comparison comment")
        comment = generate_comment(
            args.base_ext_cov, args.pr_ext_cov, args.ext_decreased, args.ext_diff,
            args.base_web_cov, args.pr_web_cov, args.web_decreased, args.web_diff
        )
        # Output the comment to stdout
        log(comment)
        
    elif args.command == 'post-comment':
        log(f"Posting comment from {args.comment_path} to PR #{args.pr_number} in {args.repo}")
        post_comment(args.comment_path, args.pr_number, args.repo, args.token)
        
    elif args.command == 'run-coverage':
        log(f"Running coverage command: {args.coverage_cmd}")
        log(f"Output file: {args.output_file}")
        log(f"Coverage type: {args.type}")
        coverage_pct = run_coverage(args.coverage_cmd, args.output_file, args.type)
        if args.github_output:
            set_github_output(f"{args.type}_coverage", coverage_pct)
        else:
            log(f"Coverage: {coverage_pct}%")
        
    elif args.command == 'process-workflow':
        log("Processing coverage workflow")
        log(f"Base branch: {args.base_branch}")
        if args.pr_number:
            log(f"PR number: {args.pr_number}")
        if args.repo:
            log(f"Repository: {args.repo}")
        process_coverage_workflow(args)
        
    elif args.command == 'set-github-output':
        log(f"Setting GitHub output: {args.name}={args.value}")
        set_github_output(args.name, args.value)
    
    else:
        log("No command specified")
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
