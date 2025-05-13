"""
Coverage extraction module.
This module handles extracting coverage percentages from coverage report files.
"""

import os
import re
import sys
import shlex
import subprocess
import traceback
from .util import log, file_exists, get_file_size, list_directory, is_safe_command, run_command

# Global verbose flag
verbose = False

def set_verbose(value):
    """Set the global verbose flag."""
    global verbose
    verbose = value

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
    
    # Always print file path for debugging
    log(f"Checking coverage file: {file_path}")
    
    # Check if file exists and get its size
    if not file_exists(file_path):
        sys.stdout.write(f"\n##[error]File {file_path} does not exist\n")
        sys.stdout.flush()
        log(f"Error: File {file_path} does not exist")
        
        # Check if the directory exists
        dir_path = os.path.dirname(file_path)
        if not os.path.exists(dir_path):
            sys.stdout.write(f"\n##[error]Directory {dir_path} does not exist\n")
            sys.stdout.flush()
            log(f"Error: Directory {dir_path} does not exist")
        else:
            # List directory contents for debugging
            log(f"Directory {dir_path} exists, listing contents:")
            try:
                dir_contents = list_directory(dir_path)
                for name, size in dir_contents:
                    log(f"  {name} - {size}")
                    sys.stdout.write(f"  {name} - {size}\n")
                sys.stdout.flush()
            except Exception as e:
                log(f"Error listing directory: {e}")
        
        return 0.0
    
    file_size = get_file_size(file_path)
    log(f"File size: {file_size} bytes")
    sys.stdout.write(f"\n##[info]Coverage file {file_path} exists, size: {file_size} bytes\n")
    sys.stdout.flush()
    
    if file_size == 0:
        sys.stdout.write(f"\n##[warning]File {file_path} is empty\n")
        sys.stdout.flush()
        log(f"Warning: File {file_path} is empty")
        return 0.0
    
    # List directory contents for debugging
    dir_path = os.path.dirname(file_path)
    log(f"Directory contents of {dir_path}:")
    try:
        dir_contents = list_directory(dir_path)
        for name, size in dir_contents:
            log(f"  {name} - {size}")
    except Exception as e:
        log(f"Error listing directory: {e}")
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Print debug information if verbose
    print_debug_output(content, coverage_type)
    
    # Extract coverage percentage based on coverage type
    if coverage_type == "extension":
        # Extract the percentage from the "Lines" row in the coverage summary
        # Pattern: Lines : xx.xx% ( xxxxxxx/xxxxxxx )
        lines_match = re.search(r'Lines\s*:\s*(\d+\.\d+)%', content)
        if lines_match:
            coverage_pct = float(lines_match.group(1))
            if verbose:
                sys.stdout.write(f"Pattern matched (Lines percentage): {coverage_pct}\n")
                sys.stdout.flush()
            return coverage_pct
        else:
            # No coverage data found, log full content for debugging
            log("No coverage data found. Full file content:")
            log("=== Full file content ===")
            log(content)
            log("=== End file content ===")
    else:  # webview
        # Extract the percentage from the "% Lines" column in the "All files" row
        # Pattern: All files | xx.xx | xx.xx | xx.xx | xx.xx |
        all_files_match = re.search(r'All files\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+\s+\|\s+(\d+\.\d+)', content)
        if all_files_match:
            coverage_pct = float(all_files_match.group(1))
            if verbose:
                sys.stdout.write(f"Pattern matched (All files % Lines): {coverage_pct}\n")
                sys.stdout.flush()
            return coverage_pct
        else:
            # No coverage data found, log full content for debugging
            log("No coverage data found. Full file content:")
            log("=== Full file content ===")
            log(content)
            log("=== End file content ===")
    
    # If no match found, return 0.0
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
        sys.stdout.write(f"Error: Invalid coverage values - base: {base_cov}, PR: {pr_cov}\n")
        sys.stdout.flush()
        return False, 0
    
    diff = pr_cov - base_cov
    decreased = diff < 0
    
    return decreased, abs(diff)

def run_coverage(command, output_file, coverage_type="extension"):
    """
    Run a coverage command and extract the coverage percentage.
    
    Args:
        command: Command to run
        output_file: File to save the output to
        coverage_type: Type of coverage report (extension or webview)
        
    Returns:
        Coverage percentage as a float
    
    Raises:
        SystemExit: If the output file is not created or is empty
    """
    
    try:
        # Run the command and capture output
        if not is_safe_command(command):
            error_msg = f"ERROR: Unsafe command detected: {command}"
            log(error_msg)
            sys.stdout.write(f"\n##[error]{error_msg}\n")
            sys.stdout.flush()
            sys.exit(1)

        # Run command using safe execution from util
        returncode, stdout, stderr = run_command(command)
        
        # Log command result
        log(f"Command exit code: {returncode}")
        log(f"Command stdout length: {len(stdout)} bytes")
        log(f"Command stderr length: {len(stderr)} bytes")
        
        # Save output to file
        log(f"Saving command output to {output_file}")
        with open(output_file, 'w') as f:
            f.write(stdout)
            if stderr:
                f.write("\n\n=== STDERR ===\n")
                f.write(stderr)
        
        # Verify file was created and has content
        if not file_exists(output_file):
            error_msg = f"ERROR: Output file {output_file} was not created"
            log(error_msg)
            sys.stdout.write(f"\n##[error]{error_msg}\n")
            sys.stdout.flush()
            sys.exit(1)  # Exit with error code to fail the workflow
            
        file_size = get_file_size(output_file)
        if file_size == 0:
            error_msg = f"ERROR: Output file {output_file} is empty"
            log(error_msg)
            sys.stdout.write(f"\n##[error]{error_msg}\n")
            sys.stdout.flush()
            sys.exit(1)  # Exit with error code to fail the workflow
            
        log(f"Output file size: {file_size} bytes")
        
        # Extract coverage percentage
        coverage_pct = extract_coverage(output_file, coverage_type)
        
        log(f"{coverage_type.capitalize()} coverage: {coverage_pct}%")
        return coverage_pct
    
    except Exception as e:
        error_msg = f"Error running coverage command: {e}"
        log(error_msg)
        sys.stdout.write(f"\n##[error]{error_msg}\n")
        sys.stdout.flush()
        # Print stack trace for debugging
        log(traceback.format_exc())
        sys.exit(1)  # Exit with error code to fail the workflow
