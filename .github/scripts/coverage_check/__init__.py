"""
Coverage utility package for GitHub Actions workflows.
This package handles extracting coverage percentages, comparing them, and generating PR comments.
"""

# Import external dependencies
import requests

# Import main function for CLI usage
from .__main__ import main

# Import functions from extraction module
from .extraction import extract_coverage, compare_coverage, run_coverage, set_verbose

# Import functions from github_api module
from .github_api import generate_comment, post_comment, set_github_output

# Import functions from workflow module
from .workflow import process_coverage_workflow
