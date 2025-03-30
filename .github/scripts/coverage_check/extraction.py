"""
Coverage extraction module.
This module handles extracting coverage percentages from coverage report files.
"""

import os
import re
import sys
import subprocess
import traceback
from .util import log, file_exists, get_file_size, list_directory

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
        log(f"Error: File {file_path} does not exist")
        return 0.0
    
    file_size = get_file_size(file_path)
    log(f"File size: {file_size} bytes")
    
    if file_size == 0:
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
    
    # Print file content preview for debugging
    preview_length = min(500, len(content))
    log(f"File content preview (first {preview_length} chars):")
    log(f"{content[:preview_length]}...")
    
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
    """
    
    try:
        # Run the command and capture output
        # For complex commands that require shell features like pipes or redirects,
        # we need to use shell=True, but we ensure the commands are constructed internally
        # and not directly from user input
        if isinstance(command, list):
            # If command is already a list, use it directly with shell=False
            log(f"Running command (as list): {command}")
            result = subprocess.run(command, shell=False, capture_output=True, text=True)
        else:
            # For string commands, use shell=True but log a warning in verbose mode
            log(f"Running command (as string): {command}")
            if verbose:
                log(f"Warning: Running command with shell=True: {command}")
            result = subprocess.run(command, shell=True, capture_output=True, text=True)
        
        # Log command result
        log(f"Command exit code: {result.returncode}")
        log(f"Command stdout length: {len(result.stdout)} bytes")
        log(f"Command stderr length: {len(result.stderr)} bytes")
        
        # Save output to file
        log(f"Saving command output to {output_file}")
        with open(output_file, 'w') as f:
            f.write(result.stdout)
            if result.stderr:
                f.write("\n\n=== STDERR ===\n")
                f.write(result.stderr)
        
        # Verify file was created and has content
        if not file_exists(output_file):
            log(f"ERROR: Output file {output_file} was not created")
            return 0.0
            
        file_size = get_file_size(output_file)
        if file_size == 0:
            log(f"WARNING: Output file {output_file} is empty")
            return 0.0
            
        log(f"Output file size: {file_size} bytes")
        
        # Extract coverage percentage
        coverage_pct = extract_coverage(output_file, coverage_type)
        
        log(f"{coverage_type.capitalize()} coverage: {coverage_pct}%")
        return coverage_pct
    
    except Exception as e:
        log(f"Error running coverage command: {e}")
        # Print stack trace for debugging
        log(traceback.format_exc())
        return 0
