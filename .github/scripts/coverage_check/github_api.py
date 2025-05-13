"""
GitHub API module.
This module handles interactions with the GitHub API for posting comments to PRs.
"""

import os
import requests
from .util import log, file_exists

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
    from datetime import datetime
    
    # Convert string inputs to appropriate types
    try:
        base_ext_cov = float(base_ext_cov)
        pr_ext_cov = float(pr_ext_cov)
        # Handle ext_decreased as either string or boolean
        if isinstance(ext_decreased, str):
            ext_decreased = ext_decreased.lower() == 'true'
        else:
            ext_decreased = bool(ext_decreased)
        ext_diff = float(ext_diff)
        base_web_cov = float(base_web_cov)
        pr_web_cov = float(pr_web_cov)
        # Handle web_decreased as either string or boolean
        if isinstance(web_decreased, str):
            web_decreased = web_decreased.lower() == 'true'
        else:
            web_decreased = bool(web_decreased)
        web_diff = float(web_diff)
    except ValueError as e:
        log(f"Error converting input values: {e}")
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
    if not file_exists(comment_path):
        log(f"Error: Comment file {comment_path} does not exist")
        return
    
    with open(comment_path, 'r') as f:
        comment_body = f.read()
    
    if not token:
        token = os.environ.get('GITHUB_TOKEN')
        if not token:
            log("Error: GitHub token not provided")
            return
    
    # Find existing comment
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    # Get all comments
    comments_url = f'https://api.github.com/repos/{repo}/issues/{pr_number}/comments'
    log(f"Getting comments from: {comments_url}")
    response = requests.get(comments_url, headers=headers)
    
    if response.status_code != 200:
        log(f"Error getting comments: {response.status_code} - {response.text}")
        return
    
    comments = response.json()
    log(f"Found {len(comments)} existing comments")
    
    # Find comment with our identifier
    comment_id = None
    for comment in comments:
        if '<!-- COVERAGE_REPORT -->' in comment['body']:
            comment_id = comment['id']
            log(f"Found existing coverage report comment with ID: {comment_id}")
            break
    
    if comment_id:
        # Update existing comment
        update_url = f'https://api.github.com/repos/{repo}/issues/comments/{comment_id}'
        log(f"Updating existing comment at: {update_url}")
        response = requests.patch(update_url, headers=headers, json={'body': comment_body})
        
        if response.status_code == 200:
            log(f"Successfully updated existing comment: {comment_id}")
        else:
            log(f"Error updating comment: {response.status_code} - {response.text}")
    else:
        # Create new comment
        log(f"Creating new comment at: {comments_url}")
        response = requests.post(comments_url, headers=headers, json={'body': comment_body})
        
        if response.status_code == 201:
            log("Successfully created new comment")
        else:
            log(f"Error creating comment: {response.status_code} - {response.text}")

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
        log(f"::set-output name={name}::{value}")
    
    # Also print for human readability
    log(f"{name}: {value}")
