"""
Utility module.
This module provides utility functions used across the coverage check scripts.
"""

import os
import sys
import re
import shlex
import subprocess
import traceback
from typing import List, Tuple, Dict, Any, Optional, Union

# List of allowed commands and their arguments
ALLOWED_COMMANDS = {
    'xvfb-run': ['-a'],
    'npm': ['run', 'test:coverage', 'ci', 'install', '--no-save', '@vitest/coverage-v8', 'check-types', 'lint', 'format', 'compile'],
    'cd': ['webview-ui'],
    'python': ['-m', 'coverage_check'],
    'git': ['fetch', 'checkout', 'origin'],
}

def is_safe_command(command: Union[str, List[str]]) -> bool:
    """
    Check if a command is safe to execute.
    
    Args:
        command: Command to check (string or list)
        
    Returns:
        True if command is safe, False otherwise
    """
    # Convert string command to list
    if isinstance(command, str):
        try:
            cmd_parts = shlex.split(command)
        except ValueError:
            return False
    else:
        cmd_parts = command

    if not cmd_parts:
        return False

    # Get base command
    base_cmd = os.path.basename(cmd_parts[0])
    
    # Check if command is in allowed list
    if base_cmd not in ALLOWED_COMMANDS:
        return False
        
    # For each argument, check for suspicious patterns
    for arg in cmd_parts[1:]:
        # Check for shell metacharacters
        if re.search(r'[;&|`$]', arg):
            return False
        # Check for path traversal
        if '..' in arg and not (base_cmd == 'npm' and arg.startswith('@')):
            return False
            
    return True

def log(message: str) -> None:
    """
    Write a message to stdout and flush.
    
    Args:
        message: The message to write
    """
    sys.stdout.write(f"{message}\n")
    sys.stdout.flush()

def file_exists(file_path: str) -> bool:
    """
    Check if a file exists.
    
    Args:
        file_path: Path to the file
        
    Returns:
        True if the file exists, False otherwise
    """
    return os.path.exists(file_path) and os.path.isfile(file_path)

def get_file_size(file_path: str) -> int:
    """
    Get the size of a file in bytes.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Size of the file in bytes, or 0 if the file doesn't exist
    """
    if file_exists(file_path):
        return os.path.getsize(file_path)
    return 0

def list_directory(dir_path: str) -> List[Tuple[str, Union[int, str]]]:
    """
    List the contents of a directory.
    
    Args:
        dir_path: Path to the directory
        
    Returns:
        List of (name, size) tuples for each file/directory in the directory
    """
    if not os.path.exists(dir_path) or not os.path.isdir(dir_path):
        return []
    
    contents = []
    for item in os.listdir(dir_path):
        item_path = os.path.join(dir_path, item)
        if os.path.isfile(item_path):
            contents.append((item, os.path.getsize(item_path)))
        else:
            contents.append((item, "DIR"))
    
    return contents

def read_file_content(file_path: str, default: str = "") -> str:
    """
    Read file content with error handling.
    
    Args:
        file_path: Path to the file
        default: Default value to return if file cannot be read
        
    Returns:
        File content or default value
    """
    if not file_exists(file_path):
        log(f"File does not exist: {file_path}")
        return default
    
    try:
        with open(file_path, 'r') as f:
            return f.read()
    except Exception as e:
        log(f"Error reading file {file_path}: {e}")
        return default

def write_file_content(file_path: str, content: str) -> bool:
    """
    Write content to file with error handling.
    
    Args:
        file_path: Path to the file
        content: Content to write
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'w') as f:
            f.write(content)
        return True
    except Exception as e:
        log(f"Error writing to file {file_path}: {e}")
        return False

def run_command(command: Union[str, List[str]], capture_output: bool = True) -> Tuple[int, str, str]:
    """
    Run a command and return the result.
    
    Args:
        command: Command to run (string or list)
        capture_output: Whether to capture stdout/stderr
        
    Returns:
        Tuple of (returncode, stdout, stderr)
    """
    if not is_safe_command(command):
        error_msg = f"Unsafe command detected: {command}"
        log(error_msg)
        return 1, "", error_msg
        
    log(f"Running command: {command}")
    try:
        # Convert string command to list
        if isinstance(command, str):
            cmd_list = shlex.split(command)
        else:
            cmd_list = command
            
        result = subprocess.run(
            cmd_list,
            shell=False,  # Never use shell=True for security
            capture_output=capture_output,
            text=True
        )
        log(f"Command exit code: {result.returncode}")
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        log(f"Error running command: {e}")
        log(traceback.format_exc())
        return 1, "", str(e)

def find_pattern(content: str, pattern: str, group: int = 0, 
                default: Optional[str] = None) -> Optional[str]:
    """
    Find a pattern in content and return the specified group.
    
    Args:
        content: Text content to search
        pattern: Regex pattern to search for
        group: Group number to return (default: 0 for entire match)
        default: Default value to return if pattern not found
        
    Returns:
        Matched text or default value
    """
    match = re.search(pattern, content, re.DOTALL)
    if match:
        return match.group(group)
    return default

def get_env_var(name: str, default: Optional[str] = None) -> Optional[str]:
    """
    Get environment variable with default value.
    
    Args:
        name: Environment variable name
        default: Default value if not set
        
    Returns:
        Environment variable value or default
    """
    return os.environ.get(name, default)

def format_exception(e: Exception) -> str:
    """
    Format an exception with traceback for logging.
    
    Args:
        e: Exception to format
        
    Returns:
        Formatted exception string
    """
    return f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
