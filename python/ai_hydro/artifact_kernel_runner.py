#!/usr/bin/env python3
"""
Long-lived Python kernel for AI-Hydro HTML artifact preview.

Canonical copy used by the VSIX: src/services/artifact-preview/artifact_kernel_runner.py
(copied to dist/services/artifact-preview/ at build time). This mirror is for local dev only.
"""

from __future__ import annotations

import io
import json
import signal
import sys
import traceback
from typing import Any


def _write_response(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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
    except Exception:
        error = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr

    stdout = stdout_buf.getvalue()
    stderr = stderr_buf.getvalue()

    if error is None and not stdout and not stderr:
        result_repr = ""

    return {
        "stdout": stdout,
        "stderr": stderr,
        "error": error or "",
        "result_repr": result_repr,
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
