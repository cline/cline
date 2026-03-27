#!/usr/bin/env python3
"""Scaffold a meta-knowledge review note from a template."""

from __future__ import annotations

import argparse
from pathlib import Path


def normalize_review_id(review_id: str) -> str:
    return review_id.strip().lower().replace(" ", "-")


def render(template: str, replacements: dict[str, str]) -> str:
    output = template
    for key, value in replacements.items():
        output = output.replace(f"{{{{{key}}}}}", value)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaffold a meta review markdown file.")
    parser.add_argument("--review-id", required=True, help="Review identifier")
    parser.add_argument("--reviews-root", default="aidlc-docs/meta-knowledge/reviews", help="Reviews root path")
    parser.add_argument(
        "--templates-root",
        default=".agent/skills/meta-knowledge/assets/templates",
        help="Templates root path",
    )
    parser.add_argument("--focus", default="[TODO]", help="Review focus")
    parser.add_argument("--sources", default="[TODO]", help="Comma-separated evidence sources")
    args = parser.parse_args()

    review_slug = normalize_review_id(args.review_id)
    review_path = Path(args.reviews_root) / f"{review_slug}.md"
    if review_path.exists():
        raise FileExistsError(f"Review file already exists: {review_path}")

    template = (Path(args.templates_root) / "meta-review.md").read_text()
    rendered = render(
        template,
        {
            "REVIEW_ID": review_slug,
            "FOCUS": args.focus,
            "SOURCES": args.sources,
        },
    )
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(rendered)
    print(review_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
