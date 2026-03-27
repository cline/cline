#!/usr/bin/env python3
"""
Layer1 Integrity Validator

Compares Layer1 files against upstream baseline to ensure immutability.
Exits with code 1 if any Layer1 file has been modified.

Usage:
    python validate_layer1_integrity.py [--upstream-path PATH] [--output PATH]

Arguments:
    --upstream-path: Path to upstream clone (default: resource/aidlc-workflows/)
    --output: Path to write report (default: aidlc-docs/meta-knowledge/layer1-integrity-report.md)
"""

import argparse
import hashlib
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple

# Layer1 files to validate
LAYER1_FILES = [
    ".agents/steering/aws-aidlc-rules/core-workflow.md",  # Replaces AGENTS.md for Kiro IDE
    ".agents/.aidlc-rule-details/common/ascii-diagram-standards.md",
    ".agents/.aidlc-rule-details/common/content-validation.md",
    ".agents/.aidlc-rule-details/common/depth-levels.md",
    ".agents/.aidlc-rule-details/common/error-handling.md",
    ".agents/.aidlc-rule-details/common/overconfidence-prevention.md",
    ".agents/.aidlc-rule-details/common/process-overview.md",
    ".agents/.aidlc-rule-details/common/question-format-guide.md",
    ".agents/.aidlc-rule-details/common/session-continuity.md",
    ".agents/.aidlc-rule-details/common/terminology.md",
    ".agents/.aidlc-rule-details/common/welcome-message.md",
    ".agents/.aidlc-rule-details/common/workflow-changes.md",
    ".agents/.aidlc-rule-details/construction/build-and-test.md",
    ".agents/.aidlc-rule-details/construction/code-generation.md",
    ".agents/.aidlc-rule-details/construction/functional-design.md",
    ".agents/.aidlc-rule-details/construction/infrastructure-design.md",
    ".agents/.aidlc-rule-details/construction/nfr-design.md",
    ".agents/.aidlc-rule-details/construction/nfr-requirements.md",
    ".agents/.aidlc-rule-details/extensions/security/baseline/security-baseline.md",
    ".agents/.aidlc-rule-details/extensions/security/baseline/security-baseline.opt-in.md",
    ".agents/.aidlc-rule-details/inception/application-design.md",
    ".agents/.aidlc-rule-details/inception/requirements-analysis.md",
    ".agents/.aidlc-rule-details/inception/reverse-engineering.md",
    ".agents/.aidlc-rule-details/inception/units-generation.md",
    ".agents/.aidlc-rule-details/inception/user-stories.md",
    ".agents/.aidlc-rule-details/inception/workflow-planning.md",
    ".agents/.aidlc-rule-details/inception/workspace-detection.md",
    ".agents/.aidlc-rule-details/operations/operations.md",
]

# Upstream file mappings (project path -> upstream path)
UPSTREAM_MAPPINGS = {
    ".agents/steering/aws-aidlc-rules/core-workflow.md": "core-workflow.md",
}


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def validate_layer1(
    project_root: Path, upstream_root: Path
) -> Tuple[List[str], List[str], List[str]]:
    """
    Validate Layer1 files against upstream.

    Returns:
        (intact_files, modified_files, missing_files)
    """
    intact = []
    modified = []
    missing = []

    for project_file in LAYER1_FILES:
        project_path = project_root / project_file
        upstream_file = UPSTREAM_MAPPINGS.get(project_file, project_file)
        upstream_path = upstream_root / upstream_file

        # Handle .aidlc-rule-details -> upstream root mapping
        if upstream_file.startswith(".agents/.aidlc-rule-details/"):
            upstream_path = upstream_root / upstream_file.replace(
                ".agents/.aidlc-rule-details/", ""
            )

        if not project_path.exists():
            missing.append(project_file)
            continue

        if not upstream_path.exists():
            # Upstream file doesn't exist - treat as modified (project added it)
            modified.append(f"{project_file} (not in upstream)")
            continue

        project_hash = compute_file_hash(project_path)
        upstream_hash = compute_file_hash(upstream_path)

        if project_hash == upstream_hash:
            intact.append(project_file)
        else:
            modified.append(project_file)

    return intact, modified, missing


def generate_report(
    intact: List[str],
    modified: List[str],
    missing: List[str],
    upstream_root: Path,
    output_path: Path,
) -> None:
    """Generate markdown integrity report."""
    timestamp = datetime.now().isoformat()
    status = "✅ INTACT" if not modified and not missing else "❌ MODIFIED"

    report = f"""# Layer1 Integrity Report

**Generated**: {timestamp}
**Status**: {status}
**Upstream**: {upstream_root.resolve()}

---

## Summary

- **Intact**: {len(intact)} files
- **Modified**: {len(modified)} files
- **Missing**: {len(missing)} files

---

## Intact Files ({len(intact)})

"""

    for file in intact:
        report += f"- ✅ `{file}`\n"

    if modified:
        report += f"\n---\n\n## ❌ Modified Files ({len(modified)})\n\n"
        for file in modified:
            report += f"- ❌ `{file}`\n"

    if missing:
        report += f"\n---\n\n## ⚠️ Missing Files ({len(missing)})\n\n"
        for file in missing:
            report += f"- ⚠️ `{file}`\n"

    report += """
---

## Interpretation

**✅ INTACT**: Layer1 is synchronized with upstream. No action needed.

**❌ MODIFIED**: Layer1 has been modified. This violates the Layer1/Layer2 separation principle.
- Review changes and move customizations to Layer2 (skills, supplemental artifacts)
- Restore Layer1 files from upstream
- Document any intentional divergence in aidlc-docs/meta-knowledge/aidlc-divergence-report.md

**⚠️ MISSING**: Expected Layer1 files are missing.
- Restore from upstream
- Verify project structure is correct

---

## Next Steps

If Layer1 is modified:
1. Review `git diff` for each modified file
2. Extract any project-specific logic and move to Layer2 skills
3. Restore Layer1 files: `cp resource/aidlc-workflows/<file> <project-file>`
4. Re-run this validation to confirm restoration
5. Update aidlc-docs/meta-knowledge/aidlc-divergence-report.md if needed

If Layer1 is intact:
- No action needed
- Continue development in Layer2
"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report)
    print(f"Report written to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Validate Layer1 integrity")
    parser.add_argument(
        "--upstream-path",
        type=Path,
        default=Path("resource/aidlc-workflows"),
        help="Path to upstream clone",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("aidlc-docs/meta-knowledge/layer1-integrity-report.md"),
        help="Path to write report",
    )
    args = parser.parse_args()

    project_root = Path.cwd()
    upstream_root = args.upstream_path

    if not upstream_root.exists():
        print(f"❌ Upstream path not found: {upstream_root}", file=sys.stderr)
        print(
            "   Clone upstream: git clone https://github.com/awslabs/aidlc-workflows resource/aidlc-workflows",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Validating Layer1 against upstream: {upstream_root}")
    intact, modified, missing = validate_layer1(project_root, upstream_root)

    generate_report(intact, modified, missing, upstream_root, args.output)

    print(f"\nResults:")
    print(f"  ✅ Intact:   {len(intact)}")
    print(f"  ❌ Modified: {len(modified)}")
    print(f"  ⚠️  Missing:  {len(missing)}")

    if modified or missing:
        print("\n❌ Layer1 integrity check FAILED")
        print("   Review the report for details")
        sys.exit(1)
    else:
        print("\n✅ Layer1 integrity check PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
