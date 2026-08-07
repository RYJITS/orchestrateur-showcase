from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
ORCHESTRATOR_ROOT = APP_ROOT.parent
CERVEAU_ROOT = ORCHESTRATOR_ROOT.parent.parent
DATA_ROOT = APP_ROOT / "data"
WORKFLOWS_PATH = DATA_ROOT / "workflows.json"
PROJECTS_REGISTRY_PATH = ORCHESTRATOR_ROOT / "config" / "projects.registry.json"
TASKS_PATH = ORCHESTRATOR_ROOT / "config" / "orchestrator.tasks.json"
PACKAGE_PATH = ORCHESTRATOR_ROOT / "package.json"
ENV_LOCAL_PATH = CERVEAU_ROOT / "API" / "env.Local"


def build_state() -> dict:
    workflows = load_workflows()
    return {
        "generatedAt": iso_now(),
        "paths": {
            "orchestratorRoot": str(ORCHESTRATOR_ROOT),
            "cerveauRoot": str(CERVEAU_ROOT),
            "workflowsPath": str(WORKFLOWS_PATH),
        },
        "workflows": workflows.get("workflows", []),
        "registry": read_registry_summary(),
        "scripts": read_package_scripts(),
        "executors": read_executors(),
        "connectors": read_connector_status(),
    }


def ensure_store() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if not WORKFLOWS_PATH.exists():
        write_json(WORKFLOWS_PATH, default_store())


def default_store() -> dict:
    return {
        "version": "0.1.0",
        "updatedAt": iso_now(),
        "workflows": [
            {
                "id": "workflow-studio-demarrage",
                "name": "Premier workflow d'automatisation",
                "status": "draft",
                "owner": "Yann + Codex",
                "projectScope": "Tous les projets",
                "objective": "Construire les automatisations une par une avec scripts locaux, Mistral et Qwen.",
                "tags": ["local", "dry-run", "ia"],
                "steps": [
                    {
                        "id": new_id("step"),
                        "type": "script",
                        "title": "Inventaire projets archive",
                        "executor": "script",
                        "command": "npm run projects:inventory -- --apply",
                        "mode": "dry-run",
                        "prompt": "",
                        "guard": "Lecture seule sur les projets; ecriture seulement dans archives, reports et config",
                        "output": "Liste projets archivee et nouveaux projets detectes",
                    },
                    {
                        "id": new_id("step"),
                        "type": "script",
                        "title": "Verifier Git des projets",
                        "executor": "script",
                        "command": "npm run projects:git-check",
                        "mode": "dry-run",
                        "prompt": "",
                        "guard": "Lecture seule; verifie seulement la presence .git et l'etat git status",
                        "output": "Liste des projets avec Git, sans Git, dirty ou clean",
                    },
                    {
                        "id": new_id("step"),
                        "type": "mistral",
                        "title": "Analyse Mistral bornee",
                        "executor": "mistral-api",
                        "command": "",
                        "mode": "proposal-only",
                        "prompt": "Proposer les prochaines actions sans modifier les fichiers.",
                        "guard": "Aucun secret envoye; contexte minimal seulement",
                        "output": "Liste d'actions proposees",
                    },
                    {
                        "id": new_id("step"),
                        "type": "qwen",
                        "title": "Diagnostic Qwen optionnel",
                        "executor": "alibaba-api",
                        "command": "",
                        "mode": "proposal-only",
                        "prompt": "Verifier la logique technique et les risques du workflow.",
                        "guard": "Aucune modification directe",
                        "output": "Hypotheses de correction ou validation",
                    },
                ],
            }
        ],
    }


def load_workflows() -> dict:
    ensure_store()
    return read_json(WORKFLOWS_PATH, default_store())


def save_workflow(payload: dict) -> dict:
    workflow = normalize_workflow(payload.get("workflow") or payload)
    store = load_workflows()
    workflows = store.get("workflows", [])
    index = next((idx for idx, item in enumerate(workflows) if item.get("id") == workflow["id"]), -1)
    if index >= 0:
        workflows[index] = workflow
    else:
        workflows.append(workflow)
    store["workflows"] = workflows
    store["updatedAt"] = iso_now()
    write_json(WORKFLOWS_PATH, store)
    return {"ok": True, "workflow": workflow, "store": store}


def create_workflow(payload: dict) -> dict:
    workflow = normalize_workflow(
        {
            "id": new_id("workflow"),
            "name": str(payload.get("name") or "Nouveau workflow").strip(),
            "status": "draft",
            "owner": str(payload.get("owner") or "Yann + Codex"),
            "projectScope": str(payload.get("projectScope") or "Tous les projets"),
            "objective": str(payload.get("objective") or "A definir ensemble workflow par workflow."),
            "tags": ["local", "draft"],
            "steps": [],
        }
    )
    store = load_workflows()
    store["workflows"] = [workflow, *store.get("workflows", [])]
    store["updatedAt"] = iso_now()
    write_json(WORKFLOWS_PATH, store)
    return {"ok": True, "workflow": workflow, "store": store}


def duplicate_workflow(workflow_id: str | None) -> dict:
    if not workflow_id:
        raise ValueError("Identifiant workflow manquant.")
    store = load_workflows()
    source = next((item for item in store.get("workflows", []) if item.get("id") == workflow_id), None)
    if not source:
        raise ValueError("Workflow introuvable.")
    duplicate = json.loads(json.dumps(source))
    duplicate["id"] = new_id("workflow")
    duplicate["name"] = f"{source.get('name', 'Workflow')} - copie"
    duplicate["status"] = "draft"
    duplicate["steps"] = [{**step, "id": new_id("step")} for step in duplicate.get("steps", [])]
    store["workflows"] = [duplicate, *store.get("workflows", [])]
    store["updatedAt"] = iso_now()
    write_json(WORKFLOWS_PATH, store)
    return {"ok": True, "workflow": duplicate, "store": store}


def delete_workflow(workflow_id: str | None) -> dict:
    if not workflow_id:
        raise ValueError("Identifiant workflow manquant.")
    store = load_workflows()
    workflows = store.get("workflows", [])
    if len(workflows) <= 1:
        raise ValueError("Le dernier workflow ne peut pas etre supprime.")
    remaining = [item for item in workflows if item.get("id") != workflow_id]
    if len(remaining) == len(workflows):
        raise ValueError("Workflow introuvable.")
    store["workflows"] = remaining
    store["updatedAt"] = iso_now()
    write_json(WORKFLOWS_PATH, store)
    return {"ok": True, "store": store}


def normalize_workflow(workflow: dict) -> dict:
    steps = workflow.get("steps") if isinstance(workflow.get("steps"), list) else []
    return {
        "id": str(workflow.get("id") or new_id("workflow")),
        "name": str(workflow.get("name") or "Workflow sans nom").strip(),
        "status": str(workflow.get("status") or "draft"),
        "owner": str(workflow.get("owner") or "Yann + Codex"),
        "projectScope": str(workflow.get("projectScope") or "Tous les projets"),
        "objective": str(workflow.get("objective") or ""),
        "tags": normalize_tags(workflow.get("tags")),
        "steps": [normalize_step(step) for step in steps],
        "updatedAt": iso_now(),
    }


def normalize_step(step: dict) -> dict:
    step_type = str(step.get("type") or "script")
    return {
        "id": str(step.get("id") or new_id("step")),
        "type": step_type,
        "title": str(step.get("title") or label_for_step_type(step_type)),
        "executor": str(step.get("executor") or executor_for_step_type(step_type)),
        "command": str(step.get("command") or ""),
        "mode": str(step.get("mode") or default_mode_for_step_type(step_type)),
        "prompt": str(step.get("prompt") or ""),
        "guard": str(step.get("guard") or ""),
        "output": str(step.get("output") or ""),
    }


def dry_run_workflow(payload: dict) -> dict:
    workflow = normalize_workflow(payload.get("workflow") or payload)
    connectors = read_connector_status()
    checks = [check_step(index, step, connectors) for index, step in enumerate(workflow.get("steps", []), start=1)]
    global_status = "OK" if all(item["status"] == "OK" for item in checks) else "ATTENTION"
    return {
        "ok": True,
        "generatedAt": iso_now(),
        "status": global_status,
        "workflowId": workflow["id"],
        "workflowName": workflow["name"],
        "checks": checks,
        "message": "Simulation uniquement: aucun script, API ou publication n'a ete lance.",
    }


def check_step(index: int, step: dict, connectors: dict) -> dict:
    status = "OK"
    notes = []
    step_type = step.get("type")
    if step_type == "script" and not step.get("command"):
        status = "WARN"
        notes.append("Commande script manquante.")
    if step_type == "mistral" and not connectors["mistral"]["configured"]:
        status = "WARN"
        notes.append("Cle Mistral non detectee dans env.Local.")
    if step_type == "qwen" and not connectors["qwen"]["configured"]:
        status = "WARN"
        notes.append("Cle Qwen non detectee dans env.Local.")
    if step_type in {"mistral", "qwen"} and not step.get("prompt"):
        status = "WARN"
        notes.append("Prompt a definir avant execution reelle.")
    return {
        "index": index,
        "stepId": step.get("id"),
        "title": step.get("title"),
        "type": step_type,
        "executor": step.get("executor"),
        "status": status,
        "notes": notes or ["Pret pour cadrage workflow."],
    }


def read_registry_summary() -> dict:
    registry = read_json(PROJECTS_REGISTRY_PATH, {"projects": []})
    projects = registry.get("projects", [])
    return {
        "generatedAt": registry.get("generatedAt"),
        "root": registry.get("root"),
        "total": len(projects),
        "publicReady": sum(1 for item in projects if "PUBLIC" in str(item.get("status", ""))),
        "blocked": sum(1 for item in projects if "FAIL" in f"{item.get('status', '')} {item.get('securityStatus', '')}"),
    }


def read_package_scripts() -> list[dict]:
    package = read_json(PACKAGE_PATH, {})
    scripts = package.get("scripts") or {}
    return sorted(
        [
            {"name": name, "command": f"npm run {name}", "raw": command}
            for name, command in scripts.items()
            if not name.startswith("pre")
        ],
        key=lambda item: item["name"],
    )


def read_executors() -> dict:
    tasks = read_json(TASKS_PATH, {})
    return tasks.get("executors") or {
        "script": {"label": "Script local"},
        "codex": {"label": "Codex superviseur"},
        "mistral-api": {"label": "Mistral API"},
        "alibaba-api": {"label": "Alibaba / Qwen API"},
    }


def read_connector_status() -> dict:
    env_keys = read_env_keys()
    return {
        "mistral": {
            "label": "Mistral",
            "configured": "MISTRAL_API_KEY" in env_keys,
            "model": env_keys.get("MISTRAL_MODEL", "mistral-small-latest"),
        },
        "qwen": {
            "label": "Qwen",
            "configured": "QWEN_API_KEY" in env_keys,
            "model": env_keys.get("QWEN_MODEL", "qwen-plus"),
        },
        "scripts": {
            "label": "Scripts locaux",
            "configured": PACKAGE_PATH.exists(),
            "model": "npm scripts",
        },
    }


def read_env_keys() -> dict[str, str]:
    if not ENV_LOCAL_PATH.exists():
        return {}
    keys: dict[str, str] = {}
    for line in ENV_LOCAL_PATH.read_text("utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key:
            keys[key] = "configured" if value.strip() else ""
    return keys


def read_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(temp_path, path)


def normalize_tags(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def label_for_step_type(step_type: str) -> str:
    return {
        "script": "Etape script local",
        "mistral": "Etape Mistral",
        "qwen": "Etape Qwen",
        "gate": "Validation manuelle",
        "note": "Note workflow",
    }.get(step_type, "Etape workflow")


def executor_for_step_type(step_type: str) -> str:
    return {
        "script": "script",
        "mistral": "mistral-api",
        "qwen": "alibaba-api",
        "gate": "codex",
        "note": "codex",
    }.get(step_type, "script")


def default_mode_for_step_type(step_type: str) -> str:
    return {
        "script": "dry-run",
        "mistral": "proposal-only",
        "qwen": "proposal-only",
        "gate": "approval-gate",
        "note": "manual",
    }.get(step_type, "manual")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")
