from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any
import sys


def _import_ee() -> tuple[bool, Any | None, str | None]:
    try:
        import ee  # type: ignore

        return True, ee, None
    except Exception as exc:  # pragma: no cover - depends on env
        return False, None, str(exc)


def _credentials_path() -> Path:
    return Path.home() / ".config" / "earthengine" / "credentials"


def _credentials_found() -> bool:
    return _credentials_path().exists()


def _configured_project_id(project_id: str | None = None) -> str | None:
    if project_id and project_id.strip():
        return project_id.strip()
    for key in ("EE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"):
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip()
    try:
        data = json.loads(_credentials_path().read_text(encoding="utf-8"))
        for key in ("project", "project_id", "quota_project_id"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    except Exception:
        pass
    return None


def _project_help(project_id: str | None) -> str:
    if project_id:
        return (
            f"OAuth credentials were found, but Earth Engine could not initialize with project "
            f"'{project_id}'. Confirm this project is registered for Earth Engine and that your "
            "Google account has serviceusage.services.use permission on it."
        )
    return (
        "OAuth credentials were found, but Earth Engine requires a registered Google Cloud project. "
        "Set AI-Hydro setting 'aihydro.gee.projectId', run `earthengine set_project YOUR_PROJECT_ID`, "
        "or call the MCP tool with project_id='YOUR_PROJECT_ID'."
    )


def _runtime_meta(ee_module: Any | None) -> dict[str, Any]:
    return {
        "python_executable": sys.executable,
        "ee_version": getattr(ee_module, "__version__", None) if ee_module is not None else None,
        "credentials_path": str(_credentials_path()),
    }


def list_projects() -> dict[str, Any]:
    """
    Return Google Cloud projects visible to the current user.

    Preference order:
    1. `gcloud projects list` when the Cloud SDK is installed.
    2. Cloud Resource Manager REST using the Earth Engine OAuth token.

    Both paths can legitimately fail on machines without gcloud or when the
    Cloud Resource Manager API is disabled. Callers should fall back to manual
    project-id entry.
    """
    projects: list[dict[str, str]] = []
    errors: list[str] = []

    try:
        proc = subprocess.run(
            ["gcloud", "projects", "list", "--format=json(projectId,name,projectNumber)"],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            for item in json.loads(proc.stdout):
                project_id = item.get("projectId")
                if project_id:
                    projects.append({
                        "project_id": str(project_id),
                        "name": str(item.get("name") or project_id),
                        "project_number": str(item.get("projectNumber") or ""),
                        "source": "gcloud",
                    })
            return {
                "ok": True,
                "type": "gee_projects",
                "projects": projects,
                "message": f"Found {len(projects)} Google Cloud project(s) via gcloud.",
            }
        errors.append(proc.stderr.strip() or "gcloud returned no projects")
    except FileNotFoundError:
        errors.append("gcloud CLI not found")
    except Exception as exc:
        errors.append(f"gcloud project listing failed: {exc}")

    ok, ee, err = _import_ee()
    if not ok:
        return {
            "ok": False,
            "type": "gee_projects",
            "projects": [],
            "message": "Cannot list projects because earthengine-api is unavailable.",
            "error": err,
            "errors": errors,
            "runtime": _runtime_meta(None),
        }

    try:
        import requests
        from google.auth.transport.requests import Request

        credentials = ee.data.get_persistent_credentials()
        credentials.refresh(Request())
        response = requests.get(
            "https://cloudresourcemanager.googleapis.com/v1/projects",
            headers={"Authorization": f"Bearer {credentials.token}"},
            params={"pageSize": 200},
            timeout=20,
        )
        if response.ok:
            payload = response.json()
            for item in payload.get("projects", []):
                project_id = item.get("projectId")
                if project_id:
                    projects.append({
                        "project_id": str(project_id),
                        "name": str(item.get("name") or project_id),
                        "project_number": str(item.get("projectNumber") or ""),
                        "source": "cloudresourcemanager",
                    })
            return {
                "ok": True,
                "type": "gee_projects",
                "projects": projects,
                "message": f"Found {len(projects)} Google Cloud project(s).",
                "runtime": _runtime_meta(ee),
            }
        errors.append(f"Cloud Resource Manager returned HTTP {response.status_code}: {response.text[:500]}")
    except Exception as exc:
        errors.append(f"Cloud Resource Manager project listing failed: {exc}")

    return {
        "ok": False,
        "type": "gee_projects",
        "projects": [],
        "message": "Could not list Google Cloud projects automatically. Enter a project ID manually.",
        "errors": errors,
        "runtime": _runtime_meta(ee),
    }


def set_project(project_id: str) -> dict[str, Any]:
    """
    Persist default Earth Engine project for this machine.

    Primary path uses `earthengine set_project`. Fallback edits credentials JSON
    directly when CLI is unavailable.
    """
    pid = str(project_id or "").strip()
    if not pid:
        return {
            "ok": False,
            "type": "gee_set_project",
            "project_id": None,
            "message": "Project ID is required.",
            "runtime": _runtime_meta(None),
        }

    errors: list[str] = []
    try:
        proc = subprocess.run(
            ["earthengine", "set_project", pid],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if proc.returncode == 0:
            return {
                "ok": True,
                "type": "gee_set_project",
                "project_id": pid,
                "message": "Successfully saved project id",
                "runtime": _runtime_meta(None),
            }
        errors.append(proc.stderr.strip() or proc.stdout.strip() or "earthengine set_project failed")
    except Exception as exc:
        errors.append(f"earthengine set_project unavailable: {exc}")

    try:
        path = _credentials_path()
        data = {}
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
        data["project"] = pid
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
        return {
            "ok": True,
            "type": "gee_set_project",
            "project_id": pid,
            "message": "Saved project id in Earth Engine credentials file.",
            "warnings": errors,
            "runtime": _runtime_meta(None),
        }
    except Exception as exc:
        errors.append(f"credentials write failed: {exc}")
        return {
            "ok": False,
            "type": "gee_set_project",
            "project_id": pid,
            "message": "Could not persist Earth Engine project id.",
            "errors": errors,
            "runtime": _runtime_meta(None),
        }


def status(project_id: str | None = None) -> dict[str, Any]:
    ok, ee, err = _import_ee()
    resolved_project_id = _configured_project_id(project_id)
    credentials_found = _credentials_found()
    if not ok:
        return {
            "ok": False,
            "type": "gee_status",
            "authenticated": False,
            "credentials_found": credentials_found,
            "initialized": False,
            "ee_available": False,
            "project_id": resolved_project_id,
            "project_id_source": "explicit" if project_id else "auto",
            "message": "earthengine-api not installed",
            "error": err,
            "runtime": _runtime_meta(None),
            "provenance": {"adapter": "aihydro_gee", "operation": "status"},
        }

    try:
        if resolved_project_id:
            ee.Initialize(project=resolved_project_id)
        else:
            ee.Initialize()
        return {
            "ok": True,
            "type": "gee_status",
            "authenticated": True,
            "credentials_found": credentials_found,
            "initialized": True,
            "ee_available": True,
            "project_id": resolved_project_id,
            "project_id_source": "explicit" if project_id else ("credentials_or_env" if resolved_project_id else "none"),
            "message": "Google Earth Engine initialized",
            "runtime": _runtime_meta(ee),
            "provenance": {"adapter": "aihydro_gee", "operation": "status"},
        }
    except Exception as exc:  # pragma: no cover - depends on env
        help_msg = _project_help(resolved_project_id) if credentials_found else "Google Earth Engine is not authenticated."
        return {
            "ok": False,
            "type": "gee_status",
            "authenticated": credentials_found,
            "credentials_found": credentials_found,
            "initialized": False,
            "ee_available": True,
            "project_id": resolved_project_id,
            "project_id_source": "explicit" if project_id else ("credentials_or_env" if resolved_project_id else "none"),
            "message": help_msg,
            "error": str(exc),
            "runtime": _runtime_meta(ee),
            "provenance": {"adapter": "aihydro_gee", "operation": "status"},
        }


def connect(project_id: str | None = None) -> dict[str, Any]:
    ok, ee, err = _import_ee()
    resolved_project_id = _configured_project_id(project_id)
    credentials_found = _credentials_found()
    if not ok:
        return {
            "ok": False,
            "type": "gee_status",
            "authenticated": False,
            "credentials_found": credentials_found,
            "initialized": False,
            "ee_available": False,
            "project_id": resolved_project_id,
            "project_id_source": "explicit" if project_id else "auto",
            "message": "earthengine-api not installed",
            "error": err,
            "runtime": _runtime_meta(None),
            "provenance": {"adapter": "aihydro_gee", "operation": "connect"},
        }

    try:
        if resolved_project_id:
            ee.Initialize(project=resolved_project_id)
        else:
            ee.Initialize()
        return {
            "ok": True,
            "type": "gee_status",
            "authenticated": True,
            "credentials_found": True,
            "initialized": True,
            "ee_available": True,
            "project_id": resolved_project_id,
            "project_id_source": "explicit" if project_id else ("credentials_or_env" if resolved_project_id else "none"),
            "message": "Google Earth Engine already initialized",
            "runtime": _runtime_meta(ee),
            "provenance": {"adapter": "aihydro_gee", "operation": "connect"},
        }
    except Exception:
        try:
            if not credentials_found:
                ee.Authenticate()
            if resolved_project_id:
                ee.Initialize(project=resolved_project_id)
            else:
                ee.Initialize()
            return {
                "ok": True,
                "type": "gee_status",
                "authenticated": True,
                "credentials_found": True,
                "initialized": True,
                "ee_available": True,
                "project_id": resolved_project_id,
                "project_id_source": "explicit" if project_id else ("credentials_or_env" if resolved_project_id else "none"),
                "message": "Google Earth Engine authenticated and initialized",
                "runtime": _runtime_meta(ee),
                "provenance": {"adapter": "aihydro_gee", "operation": "connect"},
            }
        except Exception as exc:  # pragma: no cover - depends on env
            help_msg = _project_help(resolved_project_id) if _credentials_found() else "Google Earth Engine authentication failed."
            return {
                "ok": False,
                "type": "gee_status",
                "authenticated": _credentials_found(),
                "credentials_found": _credentials_found(),
                "initialized": False,
                "ee_available": True,
                "project_id": resolved_project_id,
                "project_id_source": "explicit" if project_id else ("credentials_or_env" if resolved_project_id else "none"),
                "message": help_msg,
                "error": str(exc),
                "runtime": _runtime_meta(ee),
                "provenance": {"adapter": "aihydro_gee", "operation": "connect"},
            }
