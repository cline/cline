"""
Coverage extraction module.
This module handles extracting coverage percentages from coverage report files.
"""

import os
import re
import sys
import subprocess

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
    if not os.path.exists(file_path):
        sys.stdout.write(f"Error: File {file_path} does not exist\n")
        sys.stdout.flush()
        return 0.0
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Print debug information if verbose
    print_debug_output(content, coverage_type)
    
    # Extract coverage percentage based on coverage type
    if coverage_type == "extension":
        # Look for the coverage summary section and extract the Lines percentage
        summary_match = re.search(r'=============================== Coverage summary ===============================\n(.*?)\n=+', content, re.DOTALL)
        if summary_match:
            lines_match = re.search(r'Lines\s*:\s*(\d+\.\d+)%', summary_match.group(1))
            if lines_match:
                coverage_pct = float(lines_match.group(1))
                if verbose:
                    sys.stdout.write(f"Pattern matched (Lines percentage): {coverage_pct}\n")
                    sys.stdout.flush()
                return coverage_pct
    else:  # webview
        # Look for the "All files" row and extract the "% Lines" value
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
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        
        # Save output to file
        with open(output_file, 'w') as f:
            f.write(result.stdout)
            if result.stderr:
                f.write("\n\n=== STDERR ===\n")
                f.write(result.stderr)
        
        # Extract coverage percentage
        coverage_pct = extract_coverage(output_file, coverage_type)
        
        sys.stdout.write(f"{coverage_type.capitalize()} coverage: {coverage_pct}%\n")
        sys.stdout.flush()
        return coverage_pct
    
    except Exception as e:
        sys.stdout.write(f"Error running coverage command: {e}\n")
        sys.stdout.flush()
        return 0
