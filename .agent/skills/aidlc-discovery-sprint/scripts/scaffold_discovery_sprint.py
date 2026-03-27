#!/usr/bin/env python3
"""Create a new discovery sprint folder from bundled templates."""

from __future__ import annotations

import argparse
from pathlib import Path


def normalize_sprint_dir(sprint_id: str) -> str:
    cleaned = sprint_id.strip().lower().replace(" ", "-")
    if cleaned.startswith("sprint-"):
        return cleaned
    return f"sprint-{cleaned}"


def load_template(path: Path) -> str:
    return path.read_text()


def render(template: str, replacements: dict[str, str]) -> str:
    output = template
    for key, value in replacements.items():
        output = output.replace(f"{{{{{key}}}}}", value)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaffold a discovery sprint folder.")
    parser.add_argument("--sprint-id", required=True, help="Example: 0, 1, alpha")
    parser.add_argument("--mode", required=True, choices=["sprint-0", "refinement", "validation"])
    parser.add_argument("--discovery-root", default="aidlc-docs/discovery", help="Discovery root path")
    parser.add_argument(
        "--templates-root",
        default=".agent/skills/aidlc-discovery-sprint/assets/templates",
        help="Template root path",
    )
    parser.add_argument("--screens", default="", help="Comma-separated target screens")
    args = parser.parse_args()

    sprint_dir = Path(args.discovery_root) / normalize_sprint_dir(args.sprint_id)
    templates_dir = Path(args.templates_root)
    sprint_dir.mkdir(parents=True, exist_ok=False)

    replacements = {
        "SPRINT_ID": normalize_sprint_dir(args.sprint_id),
        "SPRINT_MODE": args.mode,
        "TARGET_SCREENS": ", ".join(part.strip() for part in args.screens.split(",") if part.strip()) or "[TODO]",
    }

    files = {
        "sprint-brief.md": "sprint-brief.md",
        "sprint-review.md": "sprint-review.md",
        "inception-feedback.md": "inception-feedback-note.md",
    }

    for target_name, template_name in files.items():
        template = load_template(templates_dir / template_name)
        (sprint_dir / target_name).write_text(render(template, replacements))

    (sprint_dir / "playwright-summary.md").write_text(
        "# Playwright Summary\n\n- Status: [TODO]\n- Command: [TODO]\n- Notes: [TODO]\n"
    )
    (sprint_dir / "wireframes.md").write_text(
        "# Wireframes\n\n## Target Screens\n\n- {{TARGET_SCREENS}}\n".replace("{{TARGET_SCREENS}}", replacements["TARGET_SCREENS"])
    )

    print(sprint_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
