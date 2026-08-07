from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from graph_store import executor_for_type, mode_for_type, new_id, normalize_node


CERVEAU_ROOT = Path("D:/00_Cerveau_IA")
ENV_PATH = CERVEAU_ROOT / "API" / "env.Local"

ALLOWED_COMMANDS = {
    "npm run projects:inventory": "Scanne les projets et detecte les nouveaux dossiers.",
    "npm run projects:git-check": "Verifie quels projets ont Git.",
    "npm run projects:git-ensure": "Prepare la creation Git en dry-run.",
    "npm run git:changes": "Rapport des changements Git.",
    "npm run projects:fiches-sync": "Prepare la synchronisation des fiches en dry-run.",
    "npm run check": "Controle syntaxe de l'orchestrateur.",
    "npm run safety:check": "Controle les garde-fous dry-run/non-publication.",
    "npm run registry:check": "Controle le registre projets.",
    "npm run status:check": "Controle les statuts projets.",
    "npm run expected:check": "Controle les projets attendus.",
    "npm run docs:check": "Controle la documentation.",
    "npm run site:check": "Controle la synchronisation Site Ma Methode.",
}

FORBIDDEN_PATTERNS = [
    r"\b--apply\b",
    r"\b--run\b",
    r"\b--capture\b",
    r"\bgit\s+push\b",
    r"\bgit\s+commit\b",
    r"\bgit\s+init\b",
    r"\bgit\s+add\b",
    r"\bgit\s+reset\b",
    r"\bgit\s+checkout\b",
    r"\bdeploy\b",
    r"\bpublish\b",
    r"\bpublier\b",
    r"\bhostinger\b",
    r"\brm\s+",
    r"\brmdir\b",
    r"\brd\s+",
    r"\bdel\s+",
    r"\berase\s+",
    r"\bunlink\b",
    r"\bdelete\b",
    r"\bremove\b",
    r"\bdestroy\b",
    r"\bwipe\b",
    r"\bremove-item\b",
    r"\bset-content\b",
    r"\bclear-content\b",
    r"\bout-file\b",
    r"\bwritefilesync\b",
    r"\bappendfilesync\b",
    r"\bmkdirsync\b",
    r"\brmdirsync\b",
    r"\brmsync\b",
    r"\bunlinksync\b",
    r"\bexecsync\b",
    r"\bchild_process\b",
    r"\bspawn\s*\(",
    r"\bexec\s*\(",
    r"\bsupprime[rs]?\b",
    r"\bsupprimer\b",
    r"\bsuppression\s+(de|des|du)\b",
    r"\befface[rs]?\b",
    r"\beffacement\s+(de|des|du)\b",
    r"\btoken\b",
    r"\bsecret\b",
    r"\bapi[_ -]?key\b",
    r"\benv\.local\b",
]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["mistral", "qwen", "local"], default="local")
    parser.add_argument("--goal", required=True)
    args = parser.parse_args()
    result = generate_node(args.engine, args.goal)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


def generate_node(engine: str, goal: str) -> dict:
    blocked = risk_for_text(goal)
    if blocked:
        return rejected("Demande bloquee avant appel IA.", blocked, source="local-guard")

    if engine == "local":
        node = local_node(goal, "Local securise")
        return accepted(node, source="local")

    env = load_env()
    prompt = build_prompt(goal)
    if engine == "mistral":
        response = call_mistral(env, prompt)
    else:
        response = call_qwen(env, prompt)

    if not response.get("ok"):
        node = local_node(goal, f"{engine} indisponible")
        result = accepted(node, source="local-fallback")
        result["assistantStatus"] = response.get("status", "API_UNAVAILABLE")
        result["assistantReason"] = response.get("reason", "")
        return result

    parsed = parse_json_response(response.get("content", ""))
    if not parsed:
        node = local_node(goal, f"{engine} reponse illisible")
        result = accepted(node, source="local-fallback")
        result["assistantStatus"] = "INVALID_JSON"
        return result

    candidate = normalize_ai_node(parsed, goal, engine)
    raw_risk = parse_risk_score(parsed.get("risk_score"))
    if raw_risk != 0:
        return fallback_after_rejected_model(
            goal,
            engine,
            "MODEL_RISK_NOT_ZERO",
            "Le modele n'annonce pas un risque objectif 0.",
            parsed,
        )
    risk = validate_candidate(candidate)
    if risk:
        return fallback_after_rejected_model(goal, engine, "MODEL_REJECTED_BY_GUARD", risk["reason"], parsed)
    return accepted(candidate, source=engine, raw=parsed)


def build_prompt(goal: str) -> str:
    return f"""
Tu es un specialiste de creation de noeuds pour un workflow local type n8n.
Tu dois produire UN SEUL objet JSON valide, sans markdown.

Objectif utilisateur:
{goal}

Regles obligatoires:
- Risque objectif 0.
- Ne jamais proposer suppression, push Git, commit, publication, deploiement, Hostinger, secret, token ou env.Local.
- Ne jamais utiliser --apply, --run ou --capture.
- Si une action reelle est demandee, proposer uniquement le dry-run correspondant.
- La commande doit etre vide ou une commande exacte de cette liste:
{json.dumps(list(ALLOWED_COMMANDS.keys()), ensure_ascii=False)}
- Tu peux proposer du code, mais ce code ne sera PAS execute automatiquement. Il sert de brouillon a valider.
- Le code propose doit etre en lecture seule, sans child_process, sans ecriture disque, sans top-level return.

Schema JSON exact:
{{
  "name": "nom court du noeud",
  "type": "script|mistral|qwen|condition|validation|note",
  "executor": "script|codex|mistral-api|alibaba-api",
  "mode": "dry-run|proposal-only|approval-gate|manual",
  "command": "commande autorisee ou vide",
  "prompt": "prompt du noeud si utile",
  "guard": "garde-fou clair",
  "description": "explication courte",
  "inputs": ["in"],
  "outputs": ["out"],
  "code": "code propose si necessaire, sinon vide",
  "risk_score": 0,
  "risk_reason": "pourquoi le risque est 0"
}}
""".strip()


def call_mistral(env: dict, prompt: str) -> dict:
    api_key = env.get("MISTRAL_API_KEY") or env.get("MISTRAL.API_KEY")
    model = env.get("MISTRAL_MODEL", "mistral-small-latest")
    if not api_key:
        return {"ok": False, "status": "MISSING_CONFIG", "reason": "MISTRAL_API_KEY absent"}
    endpoint = env.get("MISTRAL_BASE_URL", "https://api.mistral.ai/v1/chat/completions")
    return post_chat(endpoint, api_key, model, prompt, "Mistral")


def call_qwen(env: dict, prompt: str) -> dict:
    api_key = env.get("QWEN_API_KEY") or env.get("Alibaba_API_KEY")
    model = env.get("QWEN_MODEL", "qwen-plus")
    base_url = env.get("QWEN_BASE_URL", "")
    if not api_key or not base_url:
        return {"ok": False, "status": "MISSING_CONFIG", "reason": "QWEN_API_KEY ou QWEN_BASE_URL absent"}
    endpoint = base_url.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint = f"{endpoint}/chat/completions"
    return post_chat(endpoint, api_key, model, prompt, "Qwen")


def post_chat(endpoint: str, api_key: str, model: str, prompt: str, label: str) -> dict:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Tu generes uniquement du JSON valide pour des noeuds workflow securises. Aucun markdown.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"ok": True, "status": "OK", "content": content, "model": model, "label": label}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return {"ok": False, "status": "HTTP_ERROR", "reason": f"HTTP {error.code}: {body[:300]}"}
    except Exception as error:
        return {"ok": False, "status": "API_ERROR", "reason": str(error)}


def parse_json_response(text: str) -> dict | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.I).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.S)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


def parse_risk_score(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 100


def normalize_ai_node(data: dict, goal: str, engine: str) -> dict:
    node_type = str(data.get("type") or ("qwen" if engine == "qwen" else "mistral")).lower()
    if node_type not in {"script", "mistral", "qwen", "condition", "validation", "note"}:
        node_type = "note"
    command = str(data.get("command") or "").strip()
    preferred_command = preferred_command_for_goal(goal)
    if preferred_command and (not command or command == "npm run projects:inventory" or command not in ALLOWED_COMMANDS):
        command = preferred_command
    if command in ALLOWED_COMMANDS:
        node_type = "script"
    code = normalize_code(str(data.get("code") or "").strip())
    return normalize_node(
        {
            "id": new_id("node"),
            "name": str(data.get("name") or "Noeud IA").strip()[:80],
            "type": node_type,
            "executor": "script" if command in ALLOWED_COMMANDS else str(data.get("executor") or executor_for_type(node_type)),
            "mode": "dry-run" if command in ALLOWED_COMMANDS else str(data.get("mode") or mode_for_type(node_type)),
            "command": command,
            "prompt": str(data.get("prompt") or goal).strip(),
            "guard": str(data.get("guard") or "Risque 0: aucune action reelle automatique.").strip(),
            "description": str(data.get("description") or "Noeud genere par assistant IA.").strip(),
            "inputs": data.get("inputs") or ["in"],
            "outputs": data.get("outputs") or ["out"],
            "code": code,
        }
    )


def normalize_code(code: str) -> str:
    return re.sub(r"(?m)^return\s+([^;\n]+);\s*$", r"console.log(JSON.stringify(\1, null, 2));", code)


def preferred_command_for_goal(goal: str) -> str:
    text = goal.lower()
    if "git" in text and any(needle in text for needle in ["creer git", "creation git", "initialiser git", "git init"]):
        return "npm run projects:git-ensure"
    if "git" in text and any(word in text for word in ["sans", "manquant", "absent", "verifie", "verifier", "controle"]):
        return "npm run projects:git-check"
    if any(word in text for word in ["fiche", "site ma methode", "site"]):
        return "npm run projects:fiches-sync"
    if any(word in text for word in ["changement", "changements", "dirty", "modifie", "modifies"]):
        return "npm run git:changes"
    if any(word in text for word in ["scan", "scanner", "inventaire", "projet"]):
        return "npm run projects:inventory"
    return ""


def validate_candidate(node: dict) -> dict | None:
    joined = "\n".join(str(node.get(key, "")) for key in ["name", "command", "prompt", "guard", "description", "code"])
    risk = risk_for_text(joined)
    if risk:
        return risk
    command = node.get("command", "").strip()
    if command and command not in ALLOWED_COMMANDS:
        return {"score": 80, "reason": f"Commande non autorisee: {command}"}
    if node.get("mode") not in {"dry-run", "proposal-only", "manual"}:
        return {"score": 60, "reason": "Mode refuse pour generation automatique. Utiliser dry-run/proposal-only/manual."}
    return None


def local_node(goal: str, source: str) -> dict:
    text = goal.lower()
    base = {
        "id": new_id("node"),
        "guard": f"Genere par {source}. Risque 0: aucune action reelle automatique.",
        "inputs": ["in"],
        "outputs": ["out"],
        "code": "",
    }
    if "git" in text and any(word in text for word in ["sans", "manquant", "absent", "verifie", "verifier"]):
        return normalize_node({**base, "name": "Verifier Git manquant", "type": "script", "mode": "dry-run", "command": "npm run projects:git-check", "description": ALLOWED_COMMANDS["npm run projects:git-check"], "inputs": ["projects"], "outputs": ["git-status"]})
    if "git" in text and any(word in text for word in ["creer", "creation", "initialiser", "init"]):
        return normalize_node({**base, "name": "Preparer creation Git", "type": "script", "mode": "dry-run", "command": "npm run projects:git-ensure", "description": ALLOWED_COMMANDS["npm run projects:git-ensure"], "inputs": ["git-status"], "outputs": ["git-plan"]})
    if any(word in text for word in ["fiche", "site ma methode", "site"]):
        return normalize_node({**base, "name": "Preparer fiches site", "type": "script", "mode": "dry-run", "command": "npm run projects:fiches-sync", "description": ALLOWED_COMMANDS["npm run projects:fiches-sync"], "inputs": ["changes"], "outputs": ["fiches-plan"]})
    if any(word in text for word in ["changement", "changements", "dirty", "modifie", "modifies"]):
        return normalize_node({**base, "name": "Verifier changements Git", "type": "script", "mode": "dry-run", "command": "npm run git:changes", "description": ALLOWED_COMMANDS["npm run git:changes"], "inputs": ["git-ready"], "outputs": ["changes"]})
    if any(word in text for word in ["scan", "scanner", "inventaire", "projet"]):
        return normalize_node({**base, "name": "Scanner projets", "type": "script", "mode": "dry-run", "command": "npm run projects:inventory", "description": ALLOWED_COMMANDS["npm run projects:inventory"], "inputs": ["start"], "outputs": ["projects"]})
    return normalize_node({**base, "name": "Analyse IA bornee", "type": "mistral", "executor": "mistral-api", "mode": "proposal-only", "prompt": goal, "description": "Analyse ou proposition sans modification automatique.", "inputs": ["context"], "outputs": ["proposal"]})


def accepted(node: dict, source: str, raw: dict | None = None) -> dict:
    return {
        "ok": True,
        "source": source,
        "risk": {"score": 0, "reason": "Aucune action reelle automatique; commande autorisee ou proposition seulement."},
        "node": node,
        "raw": raw or {},
    }


def fallback_after_rejected_model(goal: str, engine: str, status: str, reason: str, raw: dict) -> dict:
    node = local_node(goal, f"{engine} refuse par garde-fou")
    result = accepted(node, source="local-fallback", raw=raw)
    result["assistantStatus"] = status
    result["assistantReason"] = reason
    return result


def rejected(message: str, risk: dict, source: str, raw: dict | None = None) -> dict:
    return {"ok": False, "source": source, "message": message, "risk": risk, "raw": raw or {}}


def risk_for_text(text: str) -> dict | None:
    lowered = text.lower()
    for pattern in FORBIDDEN_PATTERNS:
        if re.search(pattern, lowered):
            return {"score": 100, "reason": f"Motif interdit detecte: {pattern}"}
    return None


def load_env() -> dict:
    env = {}
    if not ENV_PATH.exists():
        return env
    for raw in ENV_PATH.read_text("utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip("\"'")
    return env


if __name__ == "__main__":
    raise SystemExit(main())
