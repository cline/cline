import os
import re
import subprocess

def run_git_command(command):
    try:
        result = subprocess.getoutput(command)
        print(f"Git Command: {command}")
        print(f"Git Output: {result}")
        return result
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {e}")
        print(f"stderr: {e.stderr}")
        return None

def parse_merge_commit(line):
    # Parse merge commit messages like:
    # "355dc82 Merge pull request #71 from RooVetGit/better-error-handling"
    pattern = r"([a-f0-9]+)\s+Merge pull request #(\d+) from (.+)"
    match = re.match(pattern, line)
    if match:
        sha, pr_number, branch = match.groups()
        return {
            'sha': sha,
            'pr_number': pr_number,
            'branch': branch
        }
    return None

def get_version_refs():
    # Get the merge commits with full message
    command = 'git log --merges --pretty=oneline -n 3'
    result = run_git_command(command)
    
    if result:
        commits = result.split('\n')
        if len(commits) >= 3:
            # Parse HEAD~1 (PR to generate notes for)
            head_info = parse_merge_commit(commits[1])
            # Parse HEAD~2 (previous PR to compare against)
            base_info = parse_merge_commit(commits[2])
            
            if head_info and base_info:
                # Set output for GitHub Actions
                with open(os.environ['GITHUB_OUTPUT'], 'a') as gha_outputs:
                    gha_outputs.write(f"head_ref={head_info['sha']}\n")
                    gha_outputs.write(f"base_ref={base_info['sha']}")
                
                print(f"Head ref (PR #{head_info['pr_number']}): {head_info['sha']}")
                print(f"Base ref (PR #{base_info['pr_number']}): {base_info['sha']}")
                return head_info, base_info
    
    print("Could not find or parse sufficient merge history")
    return None, None

if __name__ == "__main__":
    head_info, base_info = get_version_refs()