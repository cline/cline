#!/usr/bin/env python3
"""
Long-lived Python kernel for AI-Hydro HTML artifact preview.

Reads newline-delimited JSON requests from stdin and writes one JSON response
per line to stdout. Maintains a single global namespace across exec calls.
"""

from __future__ import annotations

import base64
import io
import json
import re
import signal
import sys
import traceback
import warnings
from typing import Any

# ── Matplotlib Agg bootstrap ─────────────────────────────────────────────────
# Must happen before any user code imports pyplot so the backend is fixed once.
# Suppressing warnings here because matplotlib sometimes warns on the first
# use() call before pyplot is imported.
try:
    import matplotlib
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        matplotlib.use("Agg")
except Exception:
    pass  # matplotlib not installed — handled gracefully in _collect_matplotlib_images

# ── Benign warnings that should not surface as errors in cell output ──────────
# Pattern is matched against each stderr line; matching lines are silently dropped.
_BENIGN_STDERR_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"FigureCanvasAgg is non-interactive"),
    re.compile(r"matplotlib\.pyplot as plt.*non-interactive"),
    re.compile(r"switching to.*Agg"),
    re.compile(r"Cannot load backend.*Agg.*already loaded"),
    re.compile(r"UserWarning:.*Agg"),
]


def _filter_stderr(raw: str) -> str:
    """Remove known benign matplotlib/rendering warnings from stderr."""
    if not raw:
        return raw
    lines = raw.splitlines(keepends=True)
    filtered: list[str] = []
    skip_next = 0
    for line in lines:
        if skip_next > 0:
            skip_next -= 1
            continue
        if any(p.search(line) for p in _BENIGN_STDERR_PATTERNS):
            # Also skip the preceding context line (UserWarning: header line)
            if filtered and filtered[-1].strip().startswith("UserWarning:") or \
               filtered and filtered[-1].strip().startswith("/"):
                filtered.pop()
            skip_next = 1  # skip one following context line
            continue
        filtered.append(line)
    return "".join(filtered)


def _write_response(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _collect_matplotlib_images() -> list[str]:
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    images: list[str] = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", facecolor=fig.get_facecolor())
        images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    if images:
        plt.close("all")
    return images


# Sentinel comment the bridge prepends to a video-render cell so the kernel
# knows to capture a rendered MP4 instead of (or in addition to) figures.
_VIDEO_SENTINEL = "# __aihydro_render_video__"


def _render_manim_videos(namespace: dict[str, Any]) -> list[str]:
    """Render every manim Scene subclass defined in the namespace to MP4.

    Returns a list of base64-encoded MP4 strings. Raises if manim is missing
    or rendering fails, so the caller can surface a graceful note.
    """
    import os
    import tempfile
    from pathlib import Path

    from manim import Scene, config, tempconfig  # type: ignore

    scenes = [
        obj
        for obj in namespace.values()
        if isinstance(obj, type) and issubclass(obj, Scene) and obj is not Scene
    ]
    if not scenes:
        raise RuntimeError("No manim Scene subclass was defined in this cell.")

    videos: list[str] = []
    with tempfile.TemporaryDirectory() as media_dir:
        overrides = {
            "media_dir": media_dir,
            "quality": "low_quality",
            "disable_caching": True,
            "verbosity": "ERROR",
            "progress_bar": "none",
            "output_file": None,
        }
        for scene_cls in scenes:
            with tempconfig(overrides):
                scene = scene_cls()
                scene.render()
                # movie_file_path is unreliable across Manim versions — it can
                # be a Path set before rendering that doesn't match where the
                # file actually lands.  Glob the temp dir instead so we always
                # find the real output regardless of directory nesting.
                mp4_files = list(Path(media_dir).rglob("*.mp4"))
                if not mp4_files:
                    # Last-resort: trust movie_file_path when glob finds nothing
                    fp = Path(scene.renderer.file_writer.movie_file_path)
                    mp4_files = [fp] if fp.exists() else []
                if not mp4_files:
                    raise RuntimeError(
                        f"Manim rendered {scene_cls.__name__} but produced no MP4 in {media_dir}."
                    )
                out_path = mp4_files[0]
            with open(out_path, "rb") as handle:
                videos.append(base64.b64encode(handle.read()).decode("ascii"))
    # Touch config/os so linters don't flag the imports as unused on some paths.
    _ = (config, os)
    return videos


def _exec_video_code(namespace: dict[str, Any], code: str) -> dict[str, Any]:
    result = _exec_code(namespace, code)
    if result["error"]:
        return result
    try:
        result["videos_mp4_base64"] = _render_manim_videos(namespace)
    except ImportError:
        result["stderr"] = (
            (result["stderr"] or "")
            + "\nManim is not installed in this kernel environment. "
            "Add `manim` (and `ffmpeg`) to .aihydro/venv to render video cells."
        )
    except Exception:
        result["error"] = traceback.format_exc()
        result["status"] = "error"
    return result


def _exec_code(namespace: dict[str, Any], code: str) -> dict[str, Any]:
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout_buf, stderr_buf
    error: str | None = None
    result_repr = ""
    # Suppress the FigureCanvasAgg warning during execution
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="FigureCanvasAgg is non-interactive")
        warnings.filterwarnings("ignore", message=".*non-interactive.*")
        try:
            compiled = compile(code, "<aihydro-cell>", "exec")
            exec(compiled, namespace, namespace)  # noqa: S102
        except Exception:
            error = traceback.format_exc()
        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr

    stdout = stdout_buf.getvalue()
    stderr = _filter_stderr(stderr_buf.getvalue())

    if error is None and not stdout and not stderr:
        result_repr = ""

    images = [] if error else _collect_matplotlib_images()

    return {
        "stdout": stdout,
        "stderr": stderr,
        "error": error or "",
        "result_repr": result_repr,
        "images_png_base64": images,
        "status": "error" if error else "ok",
    }


def main() -> None:
    namespace: dict[str, Any] = {"__name__": "__aihydro_kernel__"}
    namespace["__builtins__"] = __builtins__

    def handle_sigint(_signum: int, _frame: Any) -> None:
        _write_response({"id": "", "status": "interrupted", "stdout": "", "stderr": "", "error": "Interrupted", "result_repr": ""})

    signal.signal(signal.SIGINT, handle_sigint)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_response(
                {
                    "id": "",
                    "status": "error",
                    "stdout": "",
                    "stderr": "",
                    "error": f"Invalid JSON: {exc}",
                    "result_repr": "",
                }
            )
            continue

        req_id = str(msg.get("id", ""))
        op = msg.get("op", "exec")

        if op == "ping":
            _write_response({"id": req_id, "status": "ok", "stdout": "pong", "stderr": "", "error": "", "result_repr": ""})
            continue

        if op == "warm":
            # Pre-import the heavy libs most cells touch so the first real
            # exec doesn't pay the numpy/matplotlib import cost on screen.
            try:
                import numpy  # noqa: F401
                import matplotlib  # noqa: F401
                import matplotlib.pyplot  # noqa: F401
            except Exception:
                pass
            _write_response({"id": req_id, "status": "ok", "stdout": "", "stderr": "", "error": "", "result_repr": ""})
            continue

        if op == "restart":
            namespace = {"__name__": "__aihydro_kernel__", "__builtins__": __builtins__}
            _write_response({"id": req_id, "status": "ok", "stdout": "", "stderr": "", "error": "", "result_repr": ""})
            continue

        if op == "exec":
            code = msg.get("code", "")
            if not isinstance(code, str):
                _write_response(
                    {
                        "id": req_id,
                        "status": "error",
                        "stdout": "",
                        "stderr": "",
                        "error": "code must be a string",
                        "result_repr": "",
                    }
                )
                continue
            if code.lstrip().startswith(_VIDEO_SENTINEL):
                result = _exec_video_code(namespace, code)
            else:
                result = _exec_code(namespace, code)
            _write_response({"id": req_id, **result})
            continue

        _write_response(
            {
                "id": req_id,
                "status": "error",
                "stdout": "",
                "stderr": "",
                "error": f"Unknown op: {op}",
                "result_repr": "",
            }
        )


if __name__ == "__main__":
    main()
