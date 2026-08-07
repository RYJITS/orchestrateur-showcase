from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
ORCHESTRATOR_ROOT = APP_ROOT.parent
DATA_ROOT = APP_ROOT / "data"
NODES_PATH = DATA_ROOT / "nodes.json"
NODE_WORKFLOWS_PATH = DATA_ROOT / "node_workflows.json"


def ensure_graph_store() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if not NODES_PATH.exists():
        write_json(NODES_PATH, default_nodes_store())
    if not NODE_WORKFLOWS_PATH.exists():
        write_json(NODE_WORKFLOWS_PATH, default_workflows_store())
    migrate_default_graph_content()


def migrate_default_graph_content() -> None:
    nodes_store = read_json(NODES_PATH, default_nodes_store())
    default_nodes = {node["id"]: node for node in default_nodes_store().get("nodes", [])}
    current_nodes = nodes_store.setdefault("nodes", [])
    current_node_ids = {node.get("id") for node in current_nodes}
    nodes_changed = False
    for node_id, node in default_nodes.items():
        if node_id not in current_node_ids:
            current_nodes.append(node)
            nodes_changed = True
    if nodes_changed:
        write_json(NODES_PATH, nodes_store)

    workflows_store = read_json(NODE_WORKFLOWS_PATH, default_workflows_store())
    default_workflow = default_workflows_store()["workflows"][0]
    workflows = workflows_store.setdefault("workflows", [])
    index = next((idx for idx, item in enumerate(workflows) if item.get("id") == default_workflow["id"]), -1)
    if index >= 0 and len(workflows[index].get("nodes", [])) < len(default_workflow["nodes"]):
        workflows[index] = default_workflow
        write_json(NODE_WORKFLOWS_PATH, workflows_store)
    elif index < 0:
        workflows.insert(0, default_workflow)
        write_json(NODE_WORKFLOWS_PATH, workflows_store)


def load_nodes_store() -> dict:
    ensure_graph_store()
    return read_json(NODES_PATH, default_nodes_store())


def load_workflows_store() -> dict:
    ensure_graph_store()
    return read_json(NODE_WORKFLOWS_PATH, default_workflows_store())


def save_nodes_store(store: dict) -> dict:
    normalized = {
        "version": "0.1.0",
        "updatedAt": iso_now(),
        "nodes": [normalize_node(node) for node in store.get("nodes", [])],
    }
    write_json(NODES_PATH, normalized)
    return normalized


def save_workflows_store(store: dict) -> dict:
    normalized = {
        "version": "0.1.0",
        "updatedAt": iso_now(),
        "workflows": [normalize_workflow(workflow) for workflow in store.get("workflows", [])],
    }
    write_json(NODE_WORKFLOWS_PATH, normalized)
    return normalized


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


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


def normalize_node(node: dict) -> dict:
    node_type = str(node.get("type") or "script")
    return {
        "id": str(node.get("id") or new_id("node")),
        "name": str(node.get("name") or "Nouveau noeud").strip(),
        "type": node_type,
        "executor": str(node.get("executor") or executor_for_type(node_type)),
        "mode": str(node.get("mode") or mode_for_type(node_type)),
        "command": str(node.get("command") or ""),
        "prompt": str(node.get("prompt") or ""),
        "guard": str(node.get("guard") or ""),
        "description": str(node.get("description") or ""),
        "code": str(node.get("code") or ""),
        "inputs": normalize_ports(node.get("inputs") or ["in"]),
        "outputs": normalize_ports(node.get("outputs") or ["out"]),
        "updatedAt": str(node.get("updatedAt") or iso_now()),
    }


def normalize_workflow(workflow: dict) -> dict:
    return {
        "id": str(workflow.get("id") or new_id("workflow")),
        "name": str(workflow.get("name") or "Workflow visuel").strip(),
        "status": str(workflow.get("status") or "draft"),
        "description": str(workflow.get("description") or ""),
        "nodes": [normalize_node_instance(node) for node in workflow.get("nodes", [])],
        "connections": [normalize_connection(edge) for edge in workflow.get("connections", [])],
        "updatedAt": iso_now(),
    }


def normalize_node_instance(node: dict) -> dict:
    return {
        "id": str(node.get("id") or new_id("instance")),
        "nodeId": str(node.get("nodeId") or ""),
        "label": str(node.get("label") or ""),
        "x": float(node.get("x", 0)),
        "y": float(node.get("y", 0)),
        "command": str(node.get("command") or ""),
        "prompt": str(node.get("prompt") or ""),
        "guard": str(node.get("guard") or ""),
        "mode": str(node.get("mode") or ""),
    }


def normalize_connection(edge: dict) -> dict:
    return {
        "from": str(edge.get("from") or ""),
        "to": str(edge.get("to") or ""),
    }


def normalize_ports(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def executor_for_type(node_type: str) -> str:
    return {
        "script": "script",
        "condition": "codex",
        "validation": "codex",
        "mistral": "mistral-api",
        "qwen": "alibaba-api",
        "note": "codex",
    }.get(node_type, "script")


def mode_for_type(node_type: str) -> str:
    return {
        "script": "dry-run",
        "condition": "manual",
        "validation": "approval-gate",
        "mistral": "proposal-only",
        "qwen": "proposal-only",
        "note": "manual",
    }.get(node_type, "manual")


def default_nodes_store() -> dict:
    nodes = [
        {
            "id": "node-scan-projects",
            "name": "Scanner les projets",
            "type": "script",
            "executor": "script",
            "mode": "dry-run",
            "command": "npm run projects:inventory",
            "description": "Scanne les dossiers projets et detecte les nouveaux dossiers.",
            "guard": "Dry-run obligatoire avant modification.",
            "inputs": ["start"],
            "outputs": ["projects"],
        },
        {
            "id": "node-check-git",
            "name": "Verifier Git",
            "type": "script",
            "executor": "script",
            "mode": "dry-run",
            "command": "npm run projects:git-check",
            "description": "Verifie quels projets ont Git et leur etat.",
            "guard": "Lecture seule.",
            "inputs": ["projects"],
            "outputs": ["git-status"],
        },
        {
            "id": "node-ensure-git-dry-run",
            "name": "Preparer creation Git",
            "type": "script",
            "executor": "script",
            "mode": "dry-run",
            "command": "npm run projects:git-ensure",
            "description": "Liste les projets sans .git sans rien modifier.",
            "guard": "Rapport dry-run avant git init.",
            "inputs": ["git-status"],
            "outputs": ["git-plan"],
        },
        {
            "id": "node-ensure-git",
            "name": "Creer Git si absent",
            "type": "script",
            "executor": "script",
            "mode": "approval-gate",
            "command": "npm run projects:git-ensure -- --apply",
            "description": "Initialise Git dans les projets sans .git apres validation.",
            "guard": "Aucun commit, aucun push.",
            "inputs": ["git-plan"],
            "outputs": ["git-ready"],
        },
        {
            "id": "node-git-changes",
            "name": "Verifier changements",
            "type": "script",
            "executor": "script",
            "mode": "dry-run",
            "command": "npm run git:changes",
            "description": "Liste les projets clean ou dirty.",
            "guard": "Lecture seule.",
            "inputs": ["git-ready"],
            "outputs": ["changes"],
        },
        {
            "id": "node-sync-fiches-dry-run",
            "name": "Preparer fiches site",
            "type": "script",
            "executor": "script",
            "mode": "dry-run",
            "command": "npm run projects:fiches-sync",
            "description": "Liste les fiches a creer ou synchroniser sans ecrire.",
            "guard": "Rapport dry-run avant mise a jour.",
            "inputs": ["changes"],
            "outputs": ["fiches-plan"],
        },
        {
            "id": "node-sync-fiches",
            "name": "Synchroniser fiches",
            "type": "script",
            "executor": "script",
            "mode": "approval-gate",
            "command": "npm run projects:fiches-sync -- --apply",
            "description": "Cree ou met a jour les fiches puis synchronise Site Ma Methode.",
            "guard": "Executer seulement apres dry-run.",
            "inputs": ["fiches-plan"],
            "outputs": ["site-synced"],
        },
        {
            "id": "node-validation",
            "name": "Validation manuelle",
            "type": "validation",
            "executor": "codex",
            "mode": "approval-gate",
            "description": "Point d'arret avant une action sensible.",
            "guard": "Validation Yann requise.",
            "inputs": ["in"],
            "outputs": ["approved"],
        },
        {
            "id": "node-mistral-review",
            "name": "Analyse Mistral",
            "type": "mistral",
            "executor": "mistral-api",
            "mode": "proposal-only",
            "prompt": "Analyser le workflow et proposer les risques sans modifier les fichiers.",
            "description": "Demande un avis borne a Mistral.",
            "guard": "Aucun secret envoye.",
            "inputs": ["context"],
            "outputs": ["proposal"],
        },
        {
            "id": "node-qwen-review",
            "name": "Diagnostic Qwen",
            "type": "qwen",
            "executor": "alibaba-api",
            "mode": "proposal-only",
            "prompt": "Verifier la logique technique du workflow sans modifier les fichiers.",
            "description": "Demande un diagnostic borne a Qwen.",
            "guard": "Aucun secret envoye; aucune modification directe.",
            "inputs": ["context"],
            "outputs": ["diagnostic"],
        },
    ]
    return {"version": "0.1.0", "updatedAt": iso_now(), "nodes": [normalize_node(node) for node in nodes]}


def default_workflows_store() -> dict:
    nodes = [
        {"id": "inst-scan", "nodeId": "node-scan-projects", "label": "Scanner projets", "x": -840, "y": -60},
        {"id": "inst-check-git", "nodeId": "node-check-git", "label": "Verifier Git", "x": -560, "y": -60},
        {"id": "inst-ensure-git-dry-run", "nodeId": "node-ensure-git-dry-run", "label": "Preparer Git", "x": -280, "y": -60},
        {"id": "inst-ensure-git", "nodeId": "node-ensure-git", "label": "Creer Git si absent", "x": 0, "y": -60},
        {"id": "inst-git-changes", "nodeId": "node-git-changes", "label": "Verifier changements", "x": 280, "y": -60},
        {"id": "inst-sync-fiches-dry-run", "nodeId": "node-sync-fiches-dry-run", "label": "Preparer fiches", "x": 560, "y": -60},
        {"id": "inst-sync-fiches", "nodeId": "node-sync-fiches", "label": "Sync fiches/site", "x": 840, "y": -60},
    ]
    connections = [
        {"from": "inst-scan", "to": "inst-check-git"},
        {"from": "inst-check-git", "to": "inst-ensure-git-dry-run"},
        {"from": "inst-ensure-git-dry-run", "to": "inst-ensure-git"},
        {"from": "inst-ensure-git", "to": "inst-git-changes"},
        {"from": "inst-git-changes", "to": "inst-sync-fiches-dry-run"},
        {"from": "inst-sync-fiches-dry-run", "to": "inst-sync-fiches"},
    ]
    workflow = {
        "id": "workflow-projets-git-fiches-graph",
        "name": "Projets -> Git -> fiches",
        "status": "draft",
        "description": "Workflow visuel pour scanner, preparer Git et synchroniser Site Ma Methode.",
        "nodes": nodes,
        "connections": connections,
    }
    return {"version": "0.1.0", "updatedAt": iso_now(), "workflows": [normalize_workflow(workflow)]}
