# Orchestrateur global

## Presentation

Orchestrateur global est presente ici sous une forme publique limitee, sans secrets ni donnees privees.

## Demarrage rapide

### Pre-requis

- Git installe localement.
- Node.js 20 ou plus recent.
- Gestionnaire de paquets: npm.

### Installer et lancer

```powershell
git clone https://github.com/RYJITS/orchestrateur-showcase.git
cd orchestrateur-showcase
npm install
npm run check
npm run dashboard
```

## Installation locale

L'orchestrateur demande Git, PowerShell et Node.js 20 ou plus recent. Pour piloter plusieurs projets, placer son dossier a cote des autres projets dans une meme racine. Apres le clonage, executer `npm install`, puis `npm run check`. Aucune cle API reelle ne doit etre ajoutee au depot.

### Pre-requis
- Node.js installe localement.
- Gestionnaire detecte: npm.
- Creer un fichier `.env` local a partir de `.env.example` si des variables sont necessaires.

### Commandes
```powershell
git clone https://github.com/RYJITS/orchestrateur-showcase.git
cd orchestrateur-showcase
npm install
npm run check
```

## Lancement

```powershell
npm run dashboard
```

## Utilisation

### Utiliser le dashboard

1. Lancer `npm run dashboard`.
2. Ouvrir `http://127.0.0.1:4188` dans le navigateur.
3. Choisir un projet, puis une tache.
4. Lire le dry-run et les garde-fous avant d'autoriser une action reelle.

### Utiliser la ligne de commande

Lister les projets reconnus:

```powershell
npm run auto:projects:list
```

Simuler les huit taches pour un seul projet, sans publication:

```powershell
npm run auto:8 -- --project "00-orchestrateur" --workflow --test --local-only
```

Executer le workflow local apres verification du dry-run:

```powershell
npm run auto:8 -- --project "00-orchestrateur" --workflow --local-only
```

Les taches 06 et 08 restent protegees: GitHub exige une publication explicite apres audit securite, et Hostinger passe obligatoirement par le MCP Hostinger.

## Concept

Application locale de pilotage du Cerveau IA. Elle gere les taches, les responsables, les frequences, les routines jour/semaine/mois, les audits, les fiches et la synchronisation du hub Site Ma Methode.

Savoir quoi faire, qui doit l'appliquer, tous les combien de temps, et bloquer les actions dangereuses avant diffusion.

Public vise: Usage interne: pilotage, taches recurrentes, audits, documentation, suivi des statuts, sauvegardes et preparation des publications.


## Fonctionnement de l'application

L'application lit deux sources: le registre des projets et le registre des taches. Le registre des taches definit les actions a faire, leur cadence, le responsable, la commande, les routines ou elles apparaissent et les conditions de securite. Le dashboard affiche ce plan de travail, permet de filtrer par frequence ou responsable, et lance uniquement les actions autorisees via l'API locale. Pour chaque action, l'utilisateur choisit l'executeur: script local, Codex superviseur, Mistral API ou Alibaba/Qwen API. Avant une action globale, le dashboard relance un scan de la racine projets pour inclure les nouveaux dossiers.

## Fonctions de l'application

- Centralise la liste des taches, responsables et frequences.
- Centralise la liste des projets et leurs statuts.
- Produit les fiches lisibles par projet.
- Controle securite, fonctionnement, GitHub, publication publique et synchronisation site.
- Alimente le hub Site Ma Methode avec des donnees propres.

## Actualisations et evolution

- Ajout des routines daily, weekly et monthly pour automatiser les contrôles récurrents
- Intégration des subagents Mistral et Qwen pour les analyses sécurisées
- Renforcement des garde-fous avant publication (audit sécurité, vérification Hostinger)
- Optimisation des scripts de scan et de synchronisation des projets
- Dashboard local et routines jour/semaine/mois disponibles.
- Actions dashboard limitees aux commandes autorisees de l'orchestrateur.
- Audits architecture et optimisation globaux disponibles.
- Projets attendus et candidats de restauration verifiables via `expected:check`.
- Couverture du plan corrige verifiable via `plan:coverage`.
- Archivage et reparation fonctionnalite disponibles en dry-run.
- Garde-fou dry-run/non-publication verifiable via `safety:check`.
- Captures desktop/mobile securisees disponibles pour les projets `OK_PUBLIC`.

## Comment le projet a ete reflechi et construit

Il a ete concu comme une couche prudente au-dessus de toute la racine projets. Chaque action importante est rattachee a une tache explicite, un responsable, une frequence, un executeur et des garde-fous: scanner avant modification, ne pas supprimer directement, ne pas publier sans audit securite OK, archiver ou sauvegarder avant intervention, et garder Site Ma Methode comme hub de lecture plutot que cible isolee.

### Outils, IA et moteurs utilises

- Raccourci Windows Bureau
- Registre des taches avec store
- Gestion sous-taches
- API locale du dashboard
- Executeur script local
- Executeur Codex superviseur
- Mistral API analyse-only
- Alibaba/Qwen API analyse-only
- Store reinstallable des anciennes taches
- Tache active GitHub repos
- Node.js en modules ESM
- Registre JSON central
- Schemas JSON
- Scripts npm multi-projets
- Rapports Markdown et JSON
- Playwright pour verifier le rendu du hub
- Sharp pour normaliser les vignettes
- Regles GitHub et publication publique separees

### Options techniques detectees

- Type de projet: node
- Gestionnaire: npm
- Nom package: cerveau-ia-project-orchestrator
- Version: 1.0.0

### Stack et dependances principales

- Node.js
- Node.js en modules ESM
- Registre JSON central
- Schemas JSON
- Scripts npm multi-projets
- Rapports Markdown et JSON
- Playwright pour verifier le rendu du hub
- Sharp pour normaliser les vignettes
- Regles GitHub et publication publique separees

### Scripts disponibles

- agents:sync: node scripts/sync-codex-agents.mjs
- architecture: node scripts/audit-project-architecture.mjs
- audit:compliance: node scripts/audit-instructions-compliance.mjs
- audit:initial: node scripts/audit-orchestrator-initial.mjs
- auto:00: node automatisations/00-pilote-automatisations.mjs
- auto:00:run-all: node automatisations/00-pilote-automatisations.mjs --run-all
- auto:00:test: node automatisations/00-pilote-automatisations.mjs --test-project
- auto:01: node automatisations/01-scan-etat-projets.mjs
- auto:01:run: node automatisations/01-scan-etat-projets.mjs --run
- auto:02: node automatisations/02-moteur-audit.mjs
- auto:02:run: node automatisations/02-moteur-audit.mjs --run
- auto:03: node automatisations/03-audit-securite.mjs
- auto:03:run: node automatisations/03-audit-securite.mjs --run
- auto:04: node automatisations/04-preparation-git-public.mjs
- auto:04:api: node automatisations/04-preparation-git-public.mjs --api --compare-agents
- auto:04:run: node automatisations/04-preparation-git-public.mjs --run
- auto:05: node automatisations/05-verification-statuts-publication.mjs
- auto:05:run: node automatisations/05-verification-statuts-publication.mjs --run
- auto:06: node automatisations/06-deploiement-repos-github-public.mjs
- auto:06:api: node automatisations/06-deploiement-repos-github-public.mjs --api --compare-agents
- auto:06:run: node automatisations/06-deploiement-repos-github-public.mjs --run --publish
- auto:07: node automatisations/07-fiches-et-vignettes-ma-methode.mjs
- auto:07:local: node automatisations/07-fiches-et-vignettes-ma-methode.mjs --run --local-only
- auto:07:run: node automatisations/07-fiches-et-vignettes-ma-methode.mjs --run
- auto:08: node automatisations/08-publication-hostinger.mjs
- auto:08:publish: node automatisations/08-publication-hostinger.mjs --run --publish
- auto:08:run: node automatisations/08-publication-hostinger.mjs --run
- auto:7: node automatisations/00-executeur-7-taches.mjs
- auto:7:list: node automatisations/00-executeur-7-taches.mjs --list
- auto:7:workflow: node automatisations/00-executeur-7-taches.mjs --workflow
- auto:8: node automatisations/00-executeur-7-taches.mjs
- auto:8:workflow: node automatisations/00-executeur-7-taches.mjs --workflow
- auto:projects: node automatisations/00-executeur-projets.mjs
- auto:projects:list: node automatisations/00-executeur-projets.mjs --list
- auto:projects:workflow: node automatisations/00-executeur-projets.mjs --workflow
- auto:report: node automatisations/00-rapport-workflow-projets.mjs
- backup:prepare: node scripts/git-backup-guard.mjs
- backup:status: node scripts/git-backup-guard.mjs --status
- check: node scripts/check-orchestrator-syntax.mjs
- cleanup:archive: node scripts/archive-unused-assets.mjs
- cleanup:audit: node scripts/audit-project-cleanup.mjs
- daily: node scripts/run-daily-automation.mjs
- dashboard: npm --prefix dashboard run dev
- detect:stack: node scripts/detect-project-stack.mjs
- docs:check: node scripts/validate-project-documentation.mjs
- expected:check: node scripts/validate-expected-projects.mjs
- fiches: node scripts/update-project-fiches.mjs
- fiches:ai-draft: node scripts/generate-project-fiche-ai-draft.mjs
- git:changes: node scripts/git-change-report.mjs
- git:guard: node scripts/validate-git-backup-readiness.mjs
- github:prepare: node scripts/github-prepare-public-repo.mjs
- github:readme: node scripts/github-generate-readme-fr.mjs
- github:sync: node scripts/github-sync-project.mjs
- github:verify-repos: node scripts/github-verify-or-create-repos.mjs
- hostinger:check: node scripts/validate-hostinger-gates.mjs
- memory:central: node scripts/sync-memory-central.mjs
- memory:project: node scripts/sync-project-memory.mjs
- monthly: node scripts/run-monthly-automation.mjs
- optimization: node scripts/audit-project-optimization.mjs
- plan:coverage: node scripts/validate-plan-coverage.mjs
- projects:fiches-sync: node scripts/sync-project-fiches-on-changes.mjs
- projects:git-check: node scripts/check-project-git.mjs
- projects:git-ensure: node scripts/ensure-project-git.mjs
- projects:inventory: node scripts/archive-project-inventory.mjs
- publication:check: node scripts/validate-publication-gates.mjs
- registry:check: node scripts/validate-project-registry.mjs
- repair:functionality: node scripts/repair-project-functionality.mjs
- safety:check: node scripts/validate-dry-run-safety.mjs
- scan: node scripts/scan-projects.mjs
- screenshots: node scripts/capture-project-screenshots.mjs
- screenshots:capture: node scripts/capture-project-screenshots.mjs --capture
- screenshots:check: node scripts/validate-screenshot-coverage.mjs
- security: node scripts/audit-project-security.mjs
- site-ma-methode: node scripts/update-site-ma-methode-projects.mjs
- site-ma-methode:publish: node scripts/publish-site-ma-methode.mjs
- site:check: node scripts/validate-site-ma-methode-sync.mjs
- site:render-check: node scripts/validate-site-render.mjs
- skills:check: node scripts/install-codex-skills.mjs --check-only
- skills:install: node scripts/install-codex-skills.mjs
- status:check: node scripts/validate-project-statuses.mjs
- subagent:dispatch: node scripts/subagent-dispatch.mjs
- subagent:merge: node scripts/subagent-merge-report.mjs
- subagent:mistral: node scripts/subagent-mistral.mjs
- subagent:qwen: node scripts/subagent-qwen.mjs
- subagents: node scripts/subagent-dispatch.mjs
- subagents:check: node scripts/validate-subagent-safety.mjs
- thumbnails: node scripts/generate-project-thumbnails.mjs
- thumbnails:import-ai: node scripts/import-latest-ai-thumbnail.mjs
- verify:functionality: node scripts/verify-project-functionality.mjs
- weekly: node scripts/run-weekly-automation.mjs

### Dependances applicatives

- Aucune dependance applicative detectee.

### Dependances de developpement

- Aucune dependance de developpement detectee.

## Automatisations et comportements internes

- Scan global des projets
- Audit securite et blocage des secrets
- Audit nettoyage en dry-run
- Verification build/test/lint/dev selon scripts disponibles
- Generation des fiches FICHE_PROJET, INSTALLATION_FR et CHANGELOG_FR
- Synchronisation Site Ma Methode
- Import et optimisation des vignettes IA
- Routines daily, weekly et monthly
- Controles GitHub/publication sans publication automatique
- Rapports memoire, subagents et sauvegardes controlees

## Captures d'ecran

Aucune capture publique n'est disponible pour ce projet.

## Variables d'environnement

Copier `.env.example` vers `.env` en local puis remplir les valeurs privees.

## Securite

Ne jamais publier `.env`, tokens, sessions, logs sensibles, cles privees ou donnees personnelles.
