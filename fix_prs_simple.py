#!/usr/bin/env python3
"""
Script to fix all PRs by force-pushing clean branches to the original branch names.
This is simpler than creating new branches and updating PRs.
"""

import subprocess
import json

# Load fix commits from JSON
with open('.fix_commits.json', 'r') as f:
    pr_data = json.load(f)

print("=" * 60)
print("FIXING ALL PRs BY FORCE-PUSHING CLEAN BRANCHES")
print("=" * 60)

# First, ensure we have the latest upstream/main
print("\nStep 1: Fetching latest upstream/main...")
subprocess.run(['git', 'fetch', 'upstream', 'main'], check=True)
print("Done!\n")

# Process each PR
results = []

for i, pr_info in enumerate(pr_data, 1):
    pr = pr_info['pr']
    branch = pr_info['branch']
    fix_commit = pr_info['commit']
    remote = pr_info['remote']

    print(f"[{i}/{len(pr_data)}] Processing PR {pr}...")
    print(f"  Branch: {branch}")
    print(f"  Fix commit: {fix_commit[:8]}")

    try:
        # Step 1: Create a clean branch from upstream/main with just the fix
        temp_branch = f"{branch}-temp"

        # Create clean branch from upstream/main
        subprocess.run([
            'git', 'checkout', 'upstream/main', '-B', temp_branch
        ], check=True, capture_output=True)

        # Cherry-pick the fix commit
        result = subprocess.run([
            'git', 'cherry-pick', fix_commit
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f"  WARNING: Cherry-pick failed for {fix_commit[:8]}")
            subprocess.run(['git', 'cherry-pick', '--abort'], capture_output=True)
            results.append({'pr': pr, 'status': 'SKIP', 'reason': 'Cherry-pick conflict'})
            continue

        # Step 2: Force push to original branch
        print(f"  -> Force-pushing to {remote} {branch}...")
        subprocess.run([
            'git', 'push', '-f', remote, f'{temp_branch}:{branch}'
        ], check=True, capture_output=True)

        print(f"  DONE! PR {pr} fixed successfully")
        results.append({'pr': pr, 'status': 'SUCCESS', 'branch': branch})

    except Exception as e:
        print(f"  ERROR: {str(e)[:100]}")
        results.append({'pr': pr, 'status': 'ERROR', 'reason': str(e)[:100]})

    print()

# Summary
print("=" * 60)
print("SUMMARY")
print("=" * 60)
success = sum(1 for r in results if r['status'] == 'SUCCESS')
failed = sum(1 for r in results if r['status'] in ['ERROR', 'SKIP'])
print(f"Total PRs: {len(results)}")
print(f"Success: {success}")
print(f"Failed: {failed}")

if failed > 0:
    print("\nFailed PRs:")
    for r in results:
        if r['status'] in ['ERROR', 'SKIP']:
            print(f"  PR {r['pr']}: {r['status']} - {r.get('reason', 'Unknown')}")

# Save results
with open('.pr_fix_simple_results.json', 'w') as f:
    json.dump(results, f, indent=2)
print("\nResults saved to .pr_fix_simple_results.json")
print("\nAll PRs have been updated! The PRs now contain only the fix commit.")
