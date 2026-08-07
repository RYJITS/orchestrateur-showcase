import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadRegistry,
  markdownTable,
  nowIso,
  toPosixPath
} from "./orchestrator-utils.mjs";

const envPath = resolve("D:/00_Cerveau_IA/API/env.Local");
const defaultMistralModel = "mistral-small-latest";
const defaultQwenBaseUrl = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const defaultQwenModel = "qwen-plus";

export async function loadSubagentEnv() {
  if (!existsSync(envPath)) return { env: {}, envPath, exists: false };
  const text = await readFile(envPath, "utf8");
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  if (!env.MISTRAL_API_KEY && env["MISTRAL.API_KEY"]) env.MISTRAL_API_KEY = env["MISTRAL.API_KEY"];
  if (!env.MISTRAL_MODEL) env.MISTRAL_MODEL = defaultMistralModel;
  if (!env.QWEN_API_KEY && env.Alibaba_API_KEY) env.QWEN_API_KEY = env.Alibaba_API_KEY;
  if (!env.QWEN_BASE_URL) env.QWEN_BASE_URL = defaultQwenBaseUrl;
  if (!env.QWEN_MODEL) env.QWEN_MODEL = defaultQwenModel;
  return { env, envPath, exists: true };
}

export async function buildAllProjectsContext(action, task) {
  const registry = await loadRegistry();
  const projects = registry.projects || [];
  return {
    generatedAt: nowIso(),
    action,
    task,
    root: toPosixPath(registry.root || "D:/00_Cerveau_IA/Projet"),
    projectCount: projects.length,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: toPosixPath(project.path),
      status: project.status,
      securityStatus: project.securityStatus,
      functionalityStatus: project.functionalityStatus,
      publicationStatus: project.publicationStatus,
      category: project.category,
      scripts: (project.scripts || []).slice(0, 12),
      stack: (project.stack || []).slice(0, 8)
    }))
  };
}

export function renderContextMarkdown(context) {
  return markdownTable(
    ["Projet", "Statut", "Securite", "Fonctionnement", "Publication"],
    context.projects.map((project) => [
      project.name,
      project.status || "",
      project.securityStatus || "",
      project.functionalityStatus || "",
      project.publicationStatus || ""
    ])
  );
}

export function buildPrompt(context, agentLabel) {
  return [
    `Tu es ${agentLabel}, sous-agent d'analyse pour l'orchestrateur Cerveau IA.`,
    "Tu analyses uniquement les metadonnees fournies. Tu ne modifies aucun fichier.",
    "Tu ne demandes jamais de secret et tu ne proposes pas de publication si la securite n'est pas OK.",
    "Reponds en francais, avec une synthese courte, les risques, les actions recommandees et les projets prioritaires.",
    "",
    `Action demandee: ${context.action}`,
    `Tache: ${context.task}`,
    `Racine projets: ${context.root}`,
    `Nombre de projets: ${context.projectCount}`,
    "",
    "Projets:",
    JSON.stringify(context.projects, null, 2)
  ].join("\n");
}

export async function callMistral({ env, prompt, system, temperature = 0.2, maxTokens = null, responseFormat = null }) {
  const apiKey = env.MISTRAL_API_KEY;
  const model = env.MISTRAL_MODEL || defaultMistralModel;
  if (!apiKey) {
    return {
      sent: false,
      status: "NOT_SENT_MISSING_CONFIG",
      reason: "MISTRAL_API_KEY absent dans env.Local"
    };
  }
  const endpoint = env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1/chat/completions";
  const body = {
    model,
    messages: [
      { role: "system", content: system || "Tu es un assistant d'analyse projet prudent. Reponds en francais." },
      { role: "user", content: prompt }
    ],
    temperature
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (responseFormat) body.response_format = responseFormat;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      sent: true,
      status: "API_ERROR",
      reason: payload.error?.message || payload.message || `HTTP ${response.status}`
    };
  }
  return {
    sent: true,
    status: "OK",
    model,
    content: payload.choices?.[0]?.message?.content || ""
  };
}

export async function callQwen({ env, prompt, system, temperature = 0.2, maxTokens = null, responseFormat = null }) {
  const apiKey = env.QWEN_API_KEY;
  const model = env.QWEN_MODEL || defaultQwenModel;
  const baseUrl = env.QWEN_BASE_URL || defaultQwenBaseUrl;
  if (!apiKey) {
    return {
      sent: false,
      status: "NOT_SENT_MISSING_CONFIG",
      reason: "QWEN_API_KEY absent dans env.Local"
    };
  }
  const endpoint = baseUrl.replace(/\/$/, "").endsWith("/chat/completions")
    ? baseUrl.replace(/\/$/, "")
    : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: "system", content: system || "Tu es un assistant d'analyse projet prudent. Reponds en francais." },
      { role: "user", content: prompt }
    ],
    temperature
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (responseFormat) body.response_format = responseFormat;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      sent: true,
      status: "API_ERROR",
      reason: payload.error?.message || payload.message || `HTTP ${response.status}`
    };
  }
  return {
    sent: true,
    status: "OK",
    model,
    content: payload.choices?.[0]?.message?.content || ""
  };
}
