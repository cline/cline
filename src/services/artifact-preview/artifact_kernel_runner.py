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
import signal
import sys
import traceback
from typing import Any


def _write_response(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _collect_matplotlib_images() -> list[str]:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    images: list[str] = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    if images:
        plt.close("all")
    return images


def _exec_code(namespace: dict[str, Any], code: str) -> dict[str, Any]:
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout_buf, stderr_buf
    error: str | None = None
    result_repr = ""
    try:
        compiled = compile(code, "<aihydro-cell>", "exec")
        exec(compiled, namespace, namespace)  # noqa: S102
        if "__builtins__" in namespace:
            # Last expression value is not available from exec; use a sentinel if set.
            pass
        # If the cell ends with an expression on its own line, users often assign to a var.
        # Optional: detect trailing expression — skipped in v1.
    except Exception:
        error = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr

    stdout = stdout_buf.getvalue()
    stderr = stderr_buf.getvalue()

    if error is None and not stdout and not stderr:
        # Show repr of last assigned name heuristic: none in v1
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
