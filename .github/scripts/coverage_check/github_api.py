"""
GitHub API module.
This module handles interactions with the GitHub API for posting comments to PRs.
"""

import os
import sys
import requests

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
        sys.stdout.write(f"Error converting input values: {e}\n")
        sys.stdout.flush()
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
        sys.stdout.write(f"Error: Comment file {comment_path} does not exist\n")
        sys.stdout.flush()
        return
    
    with open(comment_path, 'r') as f:
        comment_body = f.read()
    
    if not token:
        token = os.environ.get('GITHUB_TOKEN')
        if not token:
            sys.stdout.write("Error: GitHub token not provided\n")
            sys.stdout.flush()
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
        sys.stdout.write(f"Error getting comments: {response.status_code} - {response.text}\n")
        sys.stdout.flush()
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
            sys.stdout.write(f"Updated existing comment: {comment_id}\n")
            sys.stdout.flush()
        else:
            sys.stdout.write(f"Error updating comment: {response.status_code} - {response.text}\n")
            sys.stdout.flush()
    else:
        # Create new comment
        response = requests.post(comments_url, headers=headers, json={'body': comment_body})
        
        if response.status_code == 201:
            sys.stdout.write("Created new comment\n")
            sys.stdout.flush()
        else:
            sys.stdout.write(f"Error creating comment: {response.status_code} - {response.text}\n")
            sys.stdout.flush()

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
        sys.stdout.write(f"::set-output name={name}::{value}\n")
        sys.stdout.flush()
    
    # Also print for human readability
    sys.stdout.write(f"{name}: {value}\n")
    sys.stdout.flush()
