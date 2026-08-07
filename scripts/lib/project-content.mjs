import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const projectContent = {
  "89-cerveau-ia-local": {
    title: "Cerveau IA",
    summary: "Espace de travail IA local qui organise les instructions, la memoire, les competences, les integrations API et les projets dans un systeme coherent.",
    purpose: "Conserver un contexte durable entre les assistants IA et les projets, reutiliser les memes competences et appliquer des regles communes sans exposer les donnees privees.",
    audience: "Usage personnel et prive pour piloter plusieurs projets avec des assistants IA tout en gardant la maitrise des fichiers, de la memoire et des acces API.",
    functions: [
      "Organise les instructions communes utilisees par les assistants IA.",
      "Conserve une memoire utilisateur et une memoire par projet.",
      "Centralise les competences et outils reutilisables entre plusieurs projets.",
      "Isole les configurations API locales et les donnees sensibles.",
      "Structure les projets dans des dossiers independants avec des regles communes.",
      "Produit une vue publique assainie sans publier le cerveau central complet."
    ],
    recentUpdates: [
      "Renommage de la representation locale en 89_cerveau_ia_local (2026-08-07)",
      "Separation explicite entre l'environnement prive et sa representation publique (2026-08-07)",
      "Consolidation des regles communes de memoire et de securite (2026-08-07)"
    ],
    visual: {
      theme: "brain-root",
      accent: "#2563eb",
      secondary: "#14b8a6",
      subject: "network"
    }
  },
  "00-orchestrateur": {
    title: "Orchestrateur global",
    summary: "Application locale de pilotage du Cerveau IA. Elle gere les taches, les responsables, les frequences, les routines jour/semaine/mois, les audits, les fiches et la synchronisation du hub Site Ma Methode.",
    purpose: "Savoir quoi faire, qui doit l'appliquer, tous les combien de temps, et bloquer les actions dangereuses avant diffusion.",
    audience: "Usage interne: pilotage, taches recurrentes, audits, documentation, suivi des statuts, sauvegardes et preparation des publications.",
    functions: [
      "Centralise la liste des taches, responsables et frequences.",
      "Centralise la liste des projets et leurs statuts.",
      "Produit les fiches lisibles par projet.",
      "Controle securite, fonctionnement, GitHub, publication publique et synchronisation site.",
      "Alimente le hub Site Ma Methode avec des donnees propres."
    ],
    visual: {
      theme: "orchestrator",
      accent: "#2563eb",
      secondary: "#22c55e",
      subject: "map"
    }
  },
  "01-nas": {
    title: "NAS",
    summary: "Documentation d'infrastructure pour le serveur personnel: Docker, n8n, PostgreSQL, Caddy, Tailscale, Nextcloud et sauvegardes.",
    purpose: "Rendre les procedures serveur et sauvegardes faciles a retrouver, verifier et maintenir.",
    audience: "Usage interne: infrastructure, stockage, automatisations serveur et recuperation.",
    functions: [
      "Documente le serveur Debian et les services Docker.",
      "Regroupe les procedures n8n, Nextcloud, Caddy et Tailscale.",
      "Explique la sauvegarde automatique et les actions de maintenance.",
      "Reste prive par defaut."
    ],
    visual: {
      theme: "storage",
      accent: "#0f766e",
      secondary: "#38bdf8",
      subject: "server"
    }
  },
  "01-site-ma-methode": {
    title: "Site Ma Methode",
    summary: "Vitrine interactive et hub des projets. Elle presente la methode de travail, affiche la carte des applications et ouvre des fiches detaillees synchronisees par l'orchestrateur.",
    purpose: "Transformer les projets locaux en presentation claire, navigable et diffusable.",
    audience: "Visiteurs, partenaires, clients potentiels et suivi personnel.",
    publicUrl: "https://cv.c2rdesign.com/",
    hostingerUrl: "https://cv.c2rdesign.com/",
    functions: [
      "Affiche une grille navigable de tous les projets.",
      "Ouvre une fiche simple et lisible pour chaque application.",
      "Montre les liens publics disponibles quand ils sont autorises.",
      "Garde les informations sensibles hors de la vitrine."
    ],
    visual: {
      theme: "hub",
      accent: "#7c3aed",
      secondary: "#06b6d4",
      subject: "grid"
    }
  },
  "03-codex-mistral-subagent-skill": {
    title: "Skill Codex Mistral Subagent",
    summary: "Skill Codex qui encadre l'utilisation de Mistral comme sous-agent pour resumer, classer, extraire, relire ou produire des brouillons sous controle.",
    purpose: "Ajouter un assistant secondaire utile sans lui laisser prendre des decisions risquee ou destructives.",
    audience: "Usage interne: automatisation, documentation, revue et ideation assistee.",
    functions: [
      "Decrit quand utiliser Mistral comme sous-agent.",
      "Encadre les taches non destructives.",
      "Produit des sorties structurees et controlables."
    ],
    github: "https://github.com/RYJITS/codex-mistral-subagent-skill",
    visual: {
      theme: "ai-agent",
      accent: "#8b5cf6",
      secondary: "#14b8a6",
      subject: "agent"
    }
  },
  "05-bord-planif": {
    title: "Bord PLANIF",
    summary: "Tableau de bord de planification autour d'un classeur metier. Il sert a organiser les lignes de suivi, les jalons, les priorites et les donnees utiles au pilotage.",
    purpose: "Transformer un fichier de planification en cockpit lisible, suivi par l'orchestrateur et pret a etre relie au hub sans ecraser les donnees source.",
    audience: "Usage operationnel: planification, suivi de priorites, lecture rapide d'un planning et preparation d'une interface plus claire.",
    hostingerUrl: "https://planner.c2rdesign.com/",
    functions: [
      "Reference le classeur de planification.",
      "Prepare une lecture plus visuelle des jalons et priorites.",
      "Garde le suivi orchestrateur et les statuts de publication separes.",
      "Peut etre presente dans le hub avec une vignette dediee."
    ],
    visual: {
      theme: "planning",
      accent: "#2563eb",
      secondary: "#22c55e",
      subject: "grid"
    }
  },
  "05-generateur-image-c2r": {
    title: "Generateur image C2R",
    summary: "Studio local de generation d'images C2R. Il expose une interface web, lit le corpus Image valide, lance les generations et organise les retours utiles.",
    purpose: "Creer rapidement des images coherentes avec les projets et transformer les essais visuels en assets reutilisables.",
    audience: "Creation visuelle, prototypage, contenus web et assets projets.",
    functions: [
      "Centralise une interface de generation d'images.",
      "Lit le corpus Image valide via manifeste.",
      "Lance des jobs de generation et suit leurs resultats.",
      "Aide a valider ou rejeter les images produites."
    ],
    githubCandidate: "https://github.com/RYJITS/C2R",
    visual: {
      theme: "image-studio",
      accent: "#db2777",
      secondary: "#f59e0b",
      subject: "canvas"
    }
  },
  "05-gestions-commande-matiere": {
    title: "Gestions Commande Matiere",
    summary: "Outil de suivi des commandes matiere. Il organise les besoins, les quantites, les etats de stock et les flux de commande autour d'un classeur metier.",
    purpose: "Rendre les commandes matiere plus lisibles, controlables et synchronisables avec le hub sans exposer les donnees sensibles du fichier source.",
    audience: "Usage operationnel interne: suivi matiere, commandes, quantites, priorites et preparation d'une interface metier plus propre.",
    functions: [
      "Reference le classeur de commande matiere.",
      "Structure les besoins, stocks et commandes.",
      "Separe la presentation publique des donnees sensibles.",
      "Affiche une vignette abstraite au lieu d'une capture du classeur."
    ],
    visual: {
      theme: "materials",
      accent: "#0f766e",
      secondary: "#f59e0b",
      subject: "calculator"
    }
  },
  "05-orbe-skyia": {
    title: "Orbe SkyIA",
    summary: "Prototype immersif de SkyIA avec orbe WebGL, selection de modeles, modes chat/jeu, voix, credits, sauvegardes et statistiques.",
    purpose: "Explorer une experience SkyIA plus visuelle, vivante et memorisable.",
    audience: "Prototype interne et experimentation d'interface IA.",
    hostingerUrl: "https://orbe.skyia.net/",
    functions: [
      "Met en scene SkyIA sous forme d'orbe interactif.",
      "Permet de choisir des modeles et protocoles de jeu.",
      "Teste voix, audio, sauvegardes, credits et statistiques.",
      "Reste bloque cote diffusion tant que la securite n'est pas OK."
    ],
    visual: {
      theme: "orb",
      accent: "#38bdf8",
      secondary: "#a78bfa",
      subject: "orb"
    }
  },
  "05-skyia": {
    title: "SkyIA",
    summary: "Application principale de jugement IA adversarial. Elle compare des modeles, orchestre des duels, archive les rapports et suit les performances.",
    purpose: "Donner une interface claire a un protocole IA de jugement, benchmark et suivi de modeles.",
    audience: "Projet IA principal, demonstration, experimentation et observatoire de modeles.",
    publicUrl: "https://skyia.net",
    hostingerUrl: "https://skyia.net/",
    functions: [
      "Organise des conversations et duels IA.",
      "Compare les modeles gratuits, serveur et BYOK.",
      "Archive les resultats, statistiques, latences et rapports.",
      "Expose un lien public connu tout en gardant un statut securite separe."
    ],
    visual: {
      theme: "skyia",
      accent: "#0ea5e9",
      secondary: "#22c55e",
      subject: "signal"
    }
  },
  "10-garden-inn": {
    title: "Garden Inn",
    summary: "Site vitrine multilingue pour Bukit Lawang Garden Inn. Il presente les chambres, le restaurant, les excursions, les transferts, les packages et le contact.",
    purpose: "Valoriser l'hebergement et orienter les visiteurs vers la reservation directe.",
    audience: "Voyageurs, clients potentiels et presentation du lieu.",
    publicUrl: "https://bukitlawang-garden-inn.com",
    hostingerUrl: "https://garden-inn.c2rdesign.com/",
    github: "https://github.com/RYJITS/Garden-inn",
    functions: [
      "Presente l'etablissement et ses offres.",
      "Structure les informations utiles pour les visiteurs.",
      "Adapte langue, devise et contenus touristiques.",
      "Relie le projet local a son site public."
    ],
    visual: {
      theme: "garden",
      accent: "#16a34a",
      secondary: "#f97316",
      subject: "lodge"
    }
  },
  "10-harmos-calc": {
    title: "Harmos Calc",
    summary: "Calculateur scolaire suisse. Il aide a saisir les notes, calculer les moyennes, lire l'orientation HarmoS et gerer un mode bonus lie au temps de jeu.",
    purpose: "Rendre les resultats scolaires plus faciles a comprendre et transformer les notes en suivi concret.",
    audience: "Usage familial: suivi scolaire, aide a la decision et motivation.",
    hostingerUrl: "https://mamoyenne.c2rdesign.com/",
    functions: [
      "Calcule les moyennes par matiere et moyenne generale.",
      "Evalue l'orientation scolaire selon les niveaux.",
      "Ajoute un mode parent et un mode bonus temps de jeu.",
      "Rend les resultats lisibles immediatement."
    ],
    visual: {
      theme: "calculator",
      accent: "#ea580c",
      secondary: "#2563eb",
      subject: "calculator"
    }
  },
  "20-chess-3d-ultimate": {
    title: "Chess 3D Ultimate",
    summary: "Jeu d'echecs 3D dans le navigateur. Il combine plateau WebGL, pieces procedurales, regles chess.js, IA locale et option Gemini.",
    purpose: "Creer un jeu d'echecs visuel, interactif et presentable.",
    audience: "Jeu, demonstration 3D et experimentation WebGL.",
    publicUrl: "https://chess.c2rdesign.com/",
    hostingerUrl: "https://chess.c2rdesign.com/",
    functions: [
      "Affiche un plateau d'echecs 3D interactif.",
      "Valide les coups et gere la partie avec chess.js.",
      "Joue les reponses IA en mode local ou Gemini.",
      "Propose plusieurs themes et effets visuels."
    ],
    visual: {
      theme: "chess",
      accent: "#111827",
      secondary: "#d97706",
      subject: "chess"
    }
  },
  "20-jeu3d": {
    title: "Jeu 3D",
    summary: "Jeu navigateur 3D avec course, obstacles, score, niveaux, collisions, invincibilite, munitions, leaderboard local et codes promo SkyIA.",
    purpose: "Tester une base de jeu 3D reutilisable et relier le gameplay a l'ecosysteme SkyIA.",
    audience: "Prototype de jeu, experimentation WebGL et interactions.",
    hostingerUrl: "https://neon-rush.skyia.net/",
    functions: [
      "Lance une scene 3D jouable.",
      "Gere les deplacements, collisions, score et niveaux.",
      "Ajoute charge, invincibilite, munitions et recompenses.",
      "Transforme certains scores en codes promo."
    ],
    visual: {
      theme: "game3d",
      accent: "#4f46e5",
      secondary: "#10b981",
      subject: "scene"
    }
  },
  "20-morphostyle": {
    title: "Morphostyle",
    summary: "Application IA de conseil coiffure et style. Elle analyse une photo, propose des styles adaptes puis genere des apercus et angles supplementaires.",
    purpose: "Transformer une photo et un besoin de style en recommandations visuelles exploitables.",
    audience: "Design, conseil visuel, coiffure, experimentation IA et outil creatif.",
    publicUrl: "https://morphostyle.c2rdesign.com",
    hostingerUrl: "https://morphostyle.c2rdesign.com/",
    functions: [
      "Analyse la morphologie a partir d'une image.",
      "Propose des styles recommandes selon le profil.",
      "Genere des apercus et variantes de coiffure.",
      "Garde l'identite, la lumiere et le contexte pendant les transformations."
    ],
    visual: {
      theme: "morphostyle",
      accent: "#be185d",
      secondary: "#7c3aed",
      subject: "morph"
    }
  },
  "30-pulsedeck": {
    title: "C2R PulseDeck",
    summary: "Cahier des charges d'une application locale qui doit transformer des idees brutes en fiches projet structurees et exportables en Markdown.",
    purpose: "Preparer un MVP capable de clarifier une idee, produire une fiche reutilisable et faciliter sa publication dans un portfolio.",
    audience: "Createurs, designers, developpeurs et utilisateurs d'IA qui veulent structurer rapidement leurs idees de projet.",
    functions: [
      "Prevoir une saisie rapide d'idee avec titre, categorie, priorite et statut.",
      "Prevoir la transformation d'une idee en fiche projet structuree.",
      "Prevoir l'export des fiches au format Markdown.",
      "Prevoir un stockage local JSON et des statuts de progression.",
      "Prevoir une description courte et un prompt de vignette pour chaque projet.",
      "Prevoir un tableau de bord simple pour retrouver les projets et leurs informations manquantes."
    ],
    recentUpdates: [
      "Cahier des charges du MVP documente dans projet_c2r_pulsedeck.md",
      "Depot GitHub public initialise le 7 aout 2026"
    ],
    visual: {
      theme: "project-capture",
      accent: "#ff1f1f",
      secondary: "#ffffff",
      subject: "cards"
    }
  },
  "99-archive": {
    title: "Archive",
    summary: "Zone d'archives des anciens projets, variantes, medias et versions historiques. Elle est indexee pour memoire mais non publiee ni modifiee par defaut.",
    purpose: "Conserver l'historique sans le melanger aux projets actifs.",
    audience: "Memoire interne et recuperation ponctuelle.",
    functions: [
      "Garde les anciens contenus.",
      "Reste en lecture seule par defaut.",
      "N'est pas publiee depuis le hub."
    ],
    visual: {
      theme: "archive",
      accent: "#64748b",
      secondary: "#f59e0b",
      subject: "archive"
    }
  },
  "competance-recherche-emploie": {
    title: "Competance Recherche Emploie",
    summary: "Pipeline personnel de recherche d'emploi assiste par IA. Il collecte les offres, evalue les opportunites, prepare les dossiers et suit les candidatures.",
    purpose: "Structurer la recherche d'emploi et transformer les offres en actions suivies.",
    audience: "Usage personnel sensible: emploi, CV, candidatures et informations privees.",
    functions: [
      "Organise les offres, sources, runs et candidatures.",
      "Aide a valider les opportunites et dossiers.",
      "Suit les statuts, scores, rapports et sources.",
      "Reste traite avec prudence car il contient des donnees personnelles."
    ],
    visual: {
      theme: "career",
      accent: "#0891b2",
      secondary: "#84cc16",
      subject: "cv"
    }
  }
};

export function contentForProject(project) {
  const override = readProjectContentOverride(project);
  const base = projectContent[project.id] || {
    title: displayName(project.name),
    summary: `La finalite metier de ${displayName(project.name)} doit encore etre confirmee a partir de ses sources.`,
    purpose: "Decrire le besoin auquel repond le projet une fois son code et sa documentation verifies.",
    audience: "Public cible a identifier depuis les usages reels du projet.",
    functions: [
      "Fonctions metier a identifier dans le code et la documentation.",
      "Parcours utilisateur a verifier avant toute presentation publique."
    ],
    visual: {
      theme: "default",
      accent: "#2563eb",
      secondary: "#14b8a6",
      subject: "project"
    }
  };
  const merged = mergeContent(base, override);
  return {
    ...merged,
    details: mergeContent(detailsForProject(project), override?.details || {})
  };
}

function readProjectContentOverride(project) {
  const file = join(project.path || "", "FICHE_CONTENU_PROJET.json");
  if (!project.path || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mergeContent(base, override) {
  if (!override || typeof override !== "object") return base;
  return {
    ...base,
    ...override,
    functions: override.functions || base.functions,
    recentUpdates: override.recentUpdates || base.recentUpdates,
    visual: {
      ...(base.visual || {}),
      ...(override.visual || {})
    },
    details: {
      ...(base.details || {}),
      ...(override.details || {})
    }
  };
}

const projectDetails = {
  "89-cerveau-ia-local": {
    application: "Cerveau IA est un environnement local de travail assiste par IA. Il rassemble des instructions communes, des memoires persistantes, des competences reutilisables, des configurations API locales et un ensemble de projets independants. Son objectif est de conserver la continuite du travail entre les sessions et les outils sans melanger les donnees de chaque projet.",
    fonctionnement: "Le systeme separe les responsabilites en espaces dedies: les instructions definissent les regles de travail, la memoire conserve les decisions et apprentissages, les competences apportent des methodes reutilisables, les configurations API restent locales, et chaque projet garde ses propres sources et documents. Les assistants utilisent ce contexte commun pour travailler de maniere coherente tout en respectant les limites de chaque projet.",
    conception: "Le projet suit une approche locale, modulaire et prudente. Les informations partagees entre projets sont centralisees uniquement lorsqu'elles sont reellement transverses; les sources, secrets et donnees metier restent separes. Une representation publique limitee permet de presenter le concept et les fonctions sans exposer la structure privee complete.",
    installation: "Le systeme complet est un environnement local prive et n'est pas distribue comme une application autonome. La vitrine publique documente son organisation generale; elle ne contient ni les memoires, ni les configurations API, ni les projets prives.",
    utilisation: "Cerveau IA sert de point de depart pour travailler sur plusieurs projets avec un contexte stable. Les instructions communes guident les assistants, les memoires enregistrent les decisions utiles, les competences fournissent des workflows reutilisables et chaque projet conserve son propre suivi. La vitrine publique permet uniquement de comprendre cette methode de travail.",
    capabilities: ["Conserver un contexte IA durable", "Maintenir une memoire utilisateur et des memoires projet", "Reutiliser des competences entre plusieurs projets", "Appliquer des instructions communes", "Separer les configurations sensibles", "Coordonner plusieurs projets sans melanger leurs donnees", "Garder les donnees privees hors des espaces publics"],
    tools: ["Documents Markdown et JSON", "Scripts Node.js d'automatisation", "Assistants Codex et Mistral", "Index de memoire", "Competences reutilisables", "Configuration API locale"],
    techniques: ["Architecture locale modulaire", "Separation des responsabilites", "Memoire persistante indexee", "Configuration sensible non publiee", "Documentation versionnee", "Vitrine publique assainie"],
    automations: ["Chargement des instructions communes au demarrage d'une session", "Enregistrement des decisions dans la memoire utilisateur ou projet", "Regeneration des index apres une mise a jour de memoire", "Mise a disposition des competences reutilisables", "Application des regles propres au projet actif", "Lecture locale des configurations API sans les publier"],
    recentUpdates: ["Renommage de la representation locale en 89_cerveau_ia_local (2026-08-07)", "Separation explicite entre l'environnement prive et sa representation publique (2026-08-07)", "Consolidation des regles communes de memoire et de securite (2026-08-07)"]
  },
  "00-orchestrateur": {
    application: "L'Orchestrateur global est l'application locale qui pilote tout le dossier Projet. Elle sert a savoir quelles taches existent, qui doit les appliquer, a quelle frequence, quels projets sont concernes, quels garde-fous bloquent les risques, et quelles commandes peuvent etre lancees depuis le dashboard.",
    fonctionnement: "L'application lit deux sources: le registre des projets et le registre des taches. Le registre des taches definit les actions a faire, leur cadence, le responsable, la commande, les routines ou elles apparaissent et les conditions de securite. Le dashboard affiche ce plan de travail, permet de filtrer par frequence ou responsable, et lance uniquement les actions autorisees via l'API locale. Pour chaque action, l'utilisateur choisit l'executeur: script local, Codex superviseur, Mistral API ou Alibaba/Qwen API. Avant une action globale, le dashboard relance un scan de la racine projets pour inclure les nouveaux dossiers.",
    conception: "Il a ete concu comme une couche prudente au-dessus de toute la racine projets. Chaque action importante est rattachee a une tache explicite, un responsable, une frequence, un executeur et des garde-fous: scanner avant modification, ne pas supprimer directement, ne pas publier sans audit securite OK, archiver ou sauvegarder avant intervention, et garder Site Ma Methode comme hub de lecture plutot que cible isolee.",
    installation: "L'orchestrateur demande Git, PowerShell et Node.js 20 ou plus recent. Pour piloter plusieurs projets, placer son dossier a cote des autres projets dans une meme racine. Apres le clonage, executer `npm install`, puis `npm run check`. Aucune cle API reelle ne doit etre ajoutee au depot.",
    utilisation: `### Utiliser le dashboard

1. Lancer \`npm run dashboard\`.
2. Ouvrir \`http://127.0.0.1:4188\` dans le navigateur.
3. Choisir un projet, puis une tache.
4. Lire le dry-run et les garde-fous avant d'autoriser une action reelle.

### Utiliser la ligne de commande

Lister les projets reconnus:

\`\`\`powershell
npm run auto:projects:list
\`\`\`

Simuler les huit taches pour un seul projet, sans publication:

\`\`\`powershell
npm run auto:8 -- --project "00-orchestrateur" --workflow --test --local-only
\`\`\`

Executer le workflow local apres verification du dry-run:

\`\`\`powershell
npm run auto:8 -- --project "00-orchestrateur" --workflow --local-only
\`\`\`

Les taches 06 et 08 restent protegees: GitHub exige une publication explicite apres audit securite, et Hostinger passe obligatoirement par le MCP Hostinger.`,
    capabilities: ["Ouvrir le dashboard par raccourci Bureau", "Ajouter ou supprimer des taches", "Creer des sous-taches", "Mettre une tache ou sous-tache en pause", "Definir quand et par qui chaque action est faite", "Installer plus tard les taches depuis le store", "Choisir l'executeur par action", "Inclure les nouveaux projets par scan automatique", "Faire les repos GitHub comme tache active principale", "Servir de garde-fou avant diffusion"],
    tools: ["Raccourci Windows Bureau", "Registre des taches avec store", "Gestion sous-taches", "API locale du dashboard", "Executeur script local", "Executeur Codex superviseur", "Mistral API analyse-only", "Alibaba/Qwen API analyse-only", "Store reinstallable des anciennes taches", "Tache active GitHub repos"],
    techniques: ["Node.js en modules ESM", "Registre JSON central", "Schemas JSON", "Scripts npm multi-projets", "Rapports Markdown et JSON", "Playwright pour verifier le rendu du hub", "Sharp pour normaliser les vignettes", "Regles GitHub et publication publique separees"],
    automations: ["Scan global des projets", "Audit securite et blocage des secrets", "Audit nettoyage en dry-run", "Verification build/test/lint/dev selon scripts disponibles", "Generation des fiches FICHE_PROJET, INSTALLATION_FR et CHANGELOG_FR", "Synchronisation Site Ma Methode", "Import et optimisation des vignettes IA", "Routines daily, weekly et monthly", "Controles GitHub/publication sans publication automatique", "Rapports memoire, subagents et sauvegardes controlees"]
  },
  "01-nas": {
    application: "NAS est une documentation d'exploitation pour l'infrastructure personnelle. Elle explique comment sont organises le serveur Debian, Docker Compose, n8n, PostgreSQL, Caddy, Tailscale, Nextcloud, les volumes et les sauvegardes.",
    fonctionnement: "Le projet ne lance pas une application publique: il sert de manuel operationnel. Les documents indiquent les chemins serveur, les commandes docker compose, les validations Caddy, les logs, les dossiers de donnees et les gestes de recuperation. Il permet donc de retrouver rapidement comment redemarrer les services, verifier l'etat du serveur ou comprendre la structure des sauvegardes.",
    conception: "Il a ete concu comme un espace prive et pratique. La structure privilegie les procedures lisibles, les reperes de maintenance et la separation entre documentation generale et parametres sensibles.",
    capabilities: ["Retrouver les procedures serveur", "Comprendre l'organisation n8n et Nextcloud", "Verifier les commandes de maintenance", "Suivre les sauvegardes", "Documenter les chemins critiques", "Preparer la recuperation apres incident"],
    tools: ["Serveur Debian", "Docker Compose", "n8n", "PostgreSQL", "Nextcloud", "Caddy reverse proxy", "Tailscale", "Script de backup", "Cron serveur", "Logs de sauvegarde"],
    techniques: ["Debian 12", "Docker Compose", "n8n", "PostgreSQL", "Caddy reverse proxy", "Tailscale", "Nextcloud", "Scripts shell et documentation Markdown"],
    automations: ["Sauvegarde automatique par script shell", "Dump SQL Nextcloud/MariaDB", "Compression tar.gz des donnees", "Purge des sauvegardes anciennes", "Journalisation des sauvegardes", "Execution nocturne planifiee par cron"]
  },
  "01-site-ma-methode": {
    application: "Site Ma Methode est la vitrine centrale qui relie les projets du Cerveau IA. La page raconte la methode, propose une experience scroll/video, puis ouvre une carte interactive ou chaque application possede sa vignette, son statut, ses liens et sa fiche.",
    fonctionnement: "Le site importe un module project-registry.js genere par l'orchestrateur. A l'ouverture de la grille, il place les projets par zones, gere le zoom, le deplacement, les boutons de focus et le panneau detail. Quand une carte est ouverte, le panneau affiche l'image, le resume, les statuts, le lien public, le lien GitHub, la fiche, puis les sections Application, Fonctionnement, Conception, Techniques et Automatisations. Le contact passe par une scene interactive et une API PHP dediee.",
    conception: "Il a ete concu comme un hub vivant plutot qu'une liste statique. Le design existant garde la narration immersive, mais la couche projet est maintenant alimentee par les donnees de l'orchestrateur pour eviter de recoder les cartes a la main et pour garder les projets synchronises.",
    capabilities: ["Presenter la methode de travail", "Ouvrir une carte interactive des projets", "Filtrer visuellement par familles de projets", "Afficher une fiche detaillee par application", "Donner le lien public et GitHub quand ils sont autorises", "Afficher les vignettes generees", "Envoyer un message via le contact", "Garder les contenus sensibles hors de la vitrine"],
    tools: ["Registre fourni par l'orchestrateur", "Fiches Markdown publiques", "Vignettes IA WebP", "Panneau detail dynamique", "Scene contact interactive", "API PHP de contact", "Verification navigateur automatisee", "Regles de non-exposition des secrets"],
    techniques: ["Vite", "JavaScript modulaire", "CSS responsive immersif", "Video controlee par le scroll", "WebGL pour la scene contact", "Registre JavaScript genere", "Fiches Markdown publiques", "Images WebP optimisees", "Verification navigateur avec Playwright"],
    automations: ["Generation automatique de project-registry.js", "Copie des fiches publiques vers public/orchestrator/fiches", "Synchronisation des statuts, liens et vignettes", "Verification du rendu par script Chromium", "Controle que les secrets ne sont pas exposes", "Ouverture QA via parametre qaScroll", "Import des vignettes IA depuis le dossier thumbnails-ai"]
  },
  "03-codex-mistral-subagent-skill": {
    application: "Ce projet est un skill Codex qui permet d'utiliser Mistral comme sous-agent encadre. Il sert a confier des taches bornees comme resumer un dossier, classer des informations, extraire des points importants, relire un texte ou proposer un brouillon.",
    fonctionnement: "Le skill decrit les cas d'usage autorises, les limites de delegation, les formats attendus et le protocole de securite. Le helper Node peut appeler Mistral pour une tache precise, puis renvoyer une sortie structuree que Codex doit relire avant toute decision ou modification.",
    conception: "Il a ete concu pour ajouter une aide IA sans perdre le controle principal. Mistral peut accelerer l'analyse ou la redaction, mais il ne publie pas, ne supprime pas, ne pousse pas de code et ne remplace pas les validations de Codex.",
    capabilities: ["Deleguer un resume a Mistral", "Demander une classification", "Extraire des informations importantes", "Produire un brouillon de documentation", "Obtenir un second avis", "Retourner des donnees structurees", "Limiter les taches aux actions non destructives"],
    tools: ["Mistral AI", "Helper local de delegation", "Catalogue de taches autorisees", "Protocole de delegation sure", "Validation du skill", "Controle de modeles", "Sorties JSON ou Markdown relues par Codex"],
    techniques: ["Format SKILL.md Codex", "Scripts Node.js", "Consignes Markdown", "Catalogue de taches", "Protocole de delegation sure", "Validation npm", "Controle des modeles disponibles"],
    automations: ["Validation du skill par npm run validate", "Verification syntaxique du helper", "Controle de selection des modeles", "Generation de sorties structurees", "Utilisation en dry-run depuis l'orchestrateur", "Separation entre proposition du sous-agent et action reelle"]
  },
  "05-bord-planif": {
    application: "Bord PLANIF est une application web locale qui reconstruit un cockpit de planification depuis l'analyse du classeur BORD_DEC_MRPC17.xlsm. Elle ne recopie pas les donnees reelles du fichier: elle reproduit la structure, les feuilles, les volumes, les familles de formules et les actions observables avec un jeu de donnees fictif.",
    fonctionnement: "L'application ouvre une interface type Excel avec ruban d'actions, onglets de feuilles, barre de formule, grille paginee, filtres, mode compact/complet et edition de lignes. Elle genere environ 14 905 lignes fictives sur 18 feuilles: PLANING, BUFFER, CLIENT, SUIVI_MET, capacites CAPAMET, metteurs en train, archives, PRT, starts, machines, confirmations, gammes, nomenclature et versions production. Les calculs JavaScript simulent les taux de couverture, buffers, capacites, retards, statuts planif et heatmaps de charge. Les modifications restent dans le navigateur via localStorage et les tables peuvent etre importees/exportees en CSV.",
    conception: "Le projet a ete concu comme un clone fonctionnel et prudent du classeur metier: garder l'ergonomie et la logique de pilotage sans publier les valeurs sensibles du fichier source. La page web separe les jeux fictifs, les calculs recalcules en JavaScript, les vues specialisees et les actions de simulation pour pouvoir presenter ou tester le fonctionnement sans ouvrir le classeur original.",
    capabilities: ["Naviguer dans 18 feuilles de planification type Excel", "Lire un cockpit KPI avec risques, lignes actives, capacites et graphiques canvas", "Filtrer par statut, semaine, recherche et groupes de colonnes", "Consulter les vues Planning, Buffer, Capacite, MET, Sources et Audit", "Ajouter, modifier ou supprimer des lignes fictives", "Simuler une actualisation et creer un snapshot d'archive", "Importer et exporter des tables en CSV", "Conserver les changements locaux dans le navigateur"],
    tools: ["Classeur source BORD_DEC_MRPC17.xlsm analyse en structure seulement", "Interface HTML/CSS/JavaScript autonome", "Grille type Excel", "Ruban d'actions", "Barre de formule explicative", "Canvas pour graphiques KPI", "localStorage pour overrides et preferences", "Import/export CSV"],
    techniques: ["JavaScript vanilla", "Seed deterministe pour donnees fictives", "Recalcul de formules Excel en fonctions JS", "Pagination et tri cote client", "Filtres statut/semaine/recherche", "Edition CRUD en modale", "Canvas charts", "Persistance localStorage", "Design Windows 11 / Fluent"],
    automations: ["Generation deterministe des donnees fictives au chargement", "Recalcul automatique des lignes planning et buffer apres edition", "Sauvegarde locale des ajouts, modifications et suppressions", "Simulation de refresh PowerQuery et journal d'actualisation", "Creation de snapshots d'archive depuis les lignes planning", "Import CSV avec materialisation dans les overrides", "Export CSV de la vue active", "Rendu automatique des graphiques selon la vue"]
  },
  "05-generateur-image-c2r": {
    application: "Generateur image C2R est un studio local pour piloter la generation d'images. Il permet de consulter le corpus Image valide, lancer des generations, suivre les jobs, recuperer les images produites et indiquer celles qui doivent etre gardees ou rejetees.",
    fonctionnement: "Le serveur Express expose des routes de sante, configuration, galerie, generation, assets, jobs et feedback. L'application lit un manifeste JSON du corpus Image valide, sert les images de facon controlee, cree un job quand une generation est demandee, peut lancer le script C2R historique ou fonctionner en dry-run, puis stocke le resultat et le retour utilisateur. Une image valide peut etre copiee dans le corpus et le manifeste est rafraichi.",
    conception: "L'outil a ete concu comme une passerelle propre entre l'ancienne chaine C2R et une interface web plus confortable. Les donnees lourdes et le corpus existant ne sont pas dupliques dans le projet; ils sont references par configuration pour garder le depot plus propre.",
    capabilities: ["Consulter la galerie Image valide", "Rafraichir le manifeste d'images", "Lancer une generation d'image", "Suivre les jobs en cours", "Servir les images generees", "Valider ou rejeter un resultat", "Ajouter une image validee au corpus", "Utiliser un mode dry-run avant generation reelle"],
    tools: ["Moteur C2R historique", "ComfyUI detecte par health check", "Manifestes Image valide", "Store local de jobs", "Journal feedback JSONL", "Configuration de chemins C2R", "Service local d'assets securise", "Runtime outputs/logs/feedback"],
    techniques: ["React/Vite pour l'interface", "Express pour l'API locale", "Manifestes JSON", "Adaptateurs C2R", "ComfyUI system_stats", "Gestion de jobs", "Service d'assets avec verification de chemin", "Runtime local pour outputs/logs/feedback"],
    automations: ["Refresh automatique du manifeste Image valide", "Controle health du projet, corpus, script legacy et ComfyUI", "Creation et suivi de jobs", "Mode dry-run de generation", "Execution asynchrone du script C2R", "Feedback valide/rejete en JSONL", "Copie des images validees dans le corpus", "Rafraichissement du manifeste apres validation", "Checks npm compatibilite/build"]
  },
  "05-gestions-commande-matiere": {
    application: "Gestions Commande Matiere est une application web locale reconstruite depuis l'analyse du classeur COMMANDE_MATIERE.xlsm. Elle sert a piloter des commandes matiere fictives, les archives, les referentiels et le suivi galva sans reutiliser les donnees metier sensibles du fichier original.",
    fonctionnement: "L'application demarre sur un module de commande matiere avec trois champs manuels: machine, nombre d'OF/laufnotes et type PROD ou MET. A partir de ces entrees, elle auto-remplit les champs gris comme item matiere, type matiere, quantites, couverture, statut planif et responsable fictif. L'utilisateur peut sauvegarder la commande, simuler la creation d'OF, lancer une disponibilite, generer un email fictif et archiver la ligne. Le tableau Archives est filtrable, triable, pagine et editable; le Suivi galva permet d'ajouter ou modifier des lignes; les Referentiels exposent SPC, options, MET, CW724R, seuils manco et articles de verification. Les donnees sont generees localement et conservees dans localStorage.",
    conception: "Le projet a ete concu comme une reproduction securisee du flux de commande matiere: conserver le parcours utilisateur, les champs et les volumes du classeur, mais remplacer les valeurs reelles par des donnees fictives. Le code met en avant les modules utiles au quotidien: saisie rapide, auto-remplissage, archive exploitable, referentiels modifiables et audit de la structure Excel.",
    capabilities: ["Creer une commande matiere fictive PROD ou MET", "Auto-remplir les champs calcules depuis machine, OF et type", "Simuler un email de commande puis ajouter la ligne aux archives", "Sauvegarder une commande et creer un OF fictif", "Lancer une verification de disponibilite fictive", "Filtrer, trier, paginer, selectionner et editer les archives", "Modifier le suivi galva et ajouter des lignes", "Consulter et enrichir les referentiels SPC, options, MET, CW724R, manco et articles de verification", "Exporter l'etat local en JSON"],
    tools: ["Classeur source COMMANDE_MATIERE.xlsm analyse en structure seulement", "Interface HTML/CSS/JavaScript autonome", "Module Commande matiere", "Table Archives", "Suivi galva editable", "Referentiels locaux", "Preview email fictif", "Export JSON", "localStorage"],
    techniques: ["JavaScript vanilla", "Donnees fictives seedees", "Auto-remplissage par hash des entrees", "Filtrage et tri cote client", "Pagination table", "Edition inline et formulaire", "SVG charts pour flux mensuel", "Persistance localStorage", "Export Blob JSON"],
    automations: ["Generation initiale de 1 525 lignes d'archives fictives", "Calcul automatique du statut planif selon couverture", "Auto-preview des champs gris pendant la saisie", "Creation automatique d'un identifiant de commande et d'OF fictif", "Archivage depuis le bouton email fictif", "Planification en masse des lignes selectionnees", "Sauvegarde automatique des changements localStorage", "Regeneration volontaire du jeu fictif", "Export JSON de l'etat courant"]
  },
  "05-orbe-skyia": {
    application: "Orbe SkyIA est une version experimentale et immersive de SkyIA. L'utilisateur interagit avec une presence visuelle en forme d'orbe, choisit des modeles, lance des modes chat ou jeu, utilise la voix et peut sauvegarder ses sessions.",
    fonctionnement: "L'application demarre un noyau SkyIA, prepare le backend, charge les modeles disponibles, gere les protocoles de partie, puis route les messages vers les services IA. Les composants gerent le profil, les sauvegardes, le magasin, les rapports, l'installation et le rendu WebGL de l'orbe. Les services audio ajoutent reconnaissance vocale, analyse micro, filtres, synthese vocale et visualisation.",
    conception: "Le projet a ete concu comme laboratoire d'experience IA: meme logique de jugement et de modeles que SkyIA, mais avec une interface plus expressive. La partie visuelle, la voix, les credits et les sauvegardes servent a tester ce qui peut rendre l'assistant plus present et engageant.",
    capabilities: ["Discuter avec SkyIA en mode immersif", "Choisir des modeles et protocoles", "Utiliser un mode chat ou jeu", "Activer la voix et la synthese vocale", "Sauvegarder et reprendre une session", "Consulter des rapports de fin de partie", "Gerer profil, credits et magasin", "Explorer des modeles OpenRouter"],
    tools: ["Gemini", "Gemini Live", "OpenRouter model discovery", "Firebase/Firestore", "Fonctions cloud Firebase", "Stripe checkout", "Web Speech API", "Proxy TTS", "Analyse micro et filtres audio", "Orbe WebGL"],
    techniques: ["React/Vite", "TypeScript", "Three.js/WebGL", "Services Gemini et Gemini Live", "OpenRouter model discovery", "Firebase/Firestore et fonctions cloud", "Stripe checkout", "Web Speech API", "Synthese vocale proxy TTS", "localStorage pour preferences et sessions"],
    automations: ["Warm-up du backend au demarrage", "Decouverte des modeles OpenRouter", "Chargement et filtrage des modeles", "Sauvegarde locale et Firestore des sessions", "Statistiques de parties via fonctions cloud", "Gestion des credits et codes promo", "Checkout Stripe", "Export PDF de rapports", "Filtres audio et TTS automatises", "Tests de securite et de composants"]
  },
  "05-skyia": {
    application: "SkyIA est l'application principale de jugement IA adversarial. Elle met en face un humain ou une IA defensive avec un juge hostile, compare les modeles, archive les duels et transforme les resultats en observatoire de performance.",
    fonctionnement: "Le frontend React pilote les conversations, les modeles, les sessions et les rapports. L'API PHP gere l'authentification, les modeles, le chat stream, les sauvegardes, les statistiques, les rapports de duel, les latences, les cles utilisateur et les modeles personnalises. Les services front choisissent le fournisseur, compactent le contexte quand le modele a peu de tokens, streament les reponses et extraient les metriques utiles.",
    conception: "SkyIA a ete concu en deux couches: une interface de jeu/benchmark pour l'utilisateur et une API serveur qui conserve les donnees importantes. Le projet separe les modeles gratuits serveur, les modeles BYOK, les statistiques, les rapports publics et les donnees sensibles pour pouvoir evoluer vers une publication plus propre.",
    capabilities: ["Lancer une conversation avec SkyIA", "Comparer plusieurs modeles IA", "Jouer un duel juge IA contre defenseur IA", "Utiliser des modeles serveur gratuits ou des cles BYOK", "Sauvegarder des sessions", "Archiver les rapports de duel", "Suivre les statistiques et classements", "Mesurer la latence des modeles", "Gerer des modeles personnalises"],
    tools: ["OpenRouter", "Groq", "Modeles serveur gratuits", "BYOK chiffre cote utilisateur", "API PHP/MySQL", "Streaming chat", "Base rapports dual_reports", "Benchmark de latence", "Benchmark duel multi-modeles", "Audit qualite texte"],
    techniques: ["React/Vite", "TypeScript", "API PHP", "PDO/MySQL", "Sessions applicatives", "OpenRouter et Groq", "Streaming SSE", "Stockage chiffre des cles BYOK", "Tables stats/latency/dual_reports", "Scripts Node.js de benchmark"],
    automations: ["Warm-up backend", "Routage automatique provider/modeles", "Compaction de contexte pour modeles low TPM", "Migrations et creation de tables API", "Backfill de rapports archives", "Ingestion de resultats de parties", "Benchmark de latence des modeles", "Benchmark duel multi-modeles", "Copie controlee de l'API vers dist", "Tests endpoints, modeles, stockage et exports"]
  },
  "10-garden-inn": {
    application: "Garden Inn est le site vitrine de Bukit Lawang Garden Inn. Il presente l'hebergement, les chambres, le restaurant, les excursions, les transferts, les packages et les informations de contact pour convertir les visiteurs en reservations.",
    fonctionnement: "L'application React affiche les sections principales et suit la section active pendant le scroll. Les donnees de chambres, excursions, transferts et packages sont traduites selon la langue choisie. Les prix en roupies peuvent etre convertis dans plusieurs devises. Les liens de reservation directe, email, itineraire Google Maps et notes Google Places guident l'utilisateur vers l'action.",
    conception: "Le site a ete concu comme une vitrine touristique orientee reservation. Le contenu est structure par parcours visiteur: decouvrir le lieu, comprendre les offres, filtrer les transferts ou excursions, puis reserver ou contacter.",
    capabilities: ["Presenter les chambres", "Presenter restaurant, excursions et packages", "Afficher les transferts", "Changer de langue", "Changer de devise", "Convertir les prix", "Ouvrir la reservation directe", "Creer un itineraire Google Maps", "Afficher une note Google Places avec fallback"],
    tools: ["Fichiers de traduction", "Convertisseur de devise", "Frankfurter exchange rates", "Google Maps route URL", "Google Places rating", "Lien booking direct", "Fallback image", "Navigation active au scroll"],
    techniques: ["React", "Vite", "TypeScript", "Contextes langue et devise", "Fichiers locales JSON", "Frankfurter API pour taux de change", "IntersectionObserver", "Images versionnees/cache-busting", "Liens Google Maps et booking direct"],
    automations: ["Chargement automatique des traductions avec fallback anglais", "Sauvegarde langue/devise en localStorage", "Conversion dynamique des prix IDR vers EUR/USD/GBP/AUD/SGD/CHF", "Detection de section active par IntersectionObserver", "Cache-busting des images avec APP_VERSION", "Fallback image en cas d'erreur", "Rating Google Places avec fallback", "Generation de routes Google Maps pour les transferts"]
  },
  "10-harmos-calc": {
    application: "HarmoS Calc est un outil familial de suivi scolaire. Il permet de saisir les notes par matiere, choisir les niveaux A/B/C, calculer les moyennes et comprendre l'orientation possible dans le systeme suisse.",
    fonctionnement: "L'utilisateur ajoute des notes et composants par matiere. L'application calcule les moyennes par discipline, la moyenne generale, le total des matieres principales et le nombre de niveaux A/B/C. Elle determine ensuite une orientation comme pre-gymnase, moderne ou general, affiche une progression et donne un conseil. Le mode bonus transforme les bonnes notes en temps de jeu et les mauvaises notes en retrait de temps.",
    conception: "Le projet a ete concu comme un outil de decision simple pour les parents et l'eleve. Il combine calcul scolaire, visualisation immediate et mecanique de motivation, avec un espace parent protege pour gerer les regles sensibles.",
    capabilities: ["Saisir les notes par matiere", "Calculer les moyennes", "Lire l'orientation HarmoS", "Compter les niveaux A/B/C", "Afficher progression et conseils", "Ajouter ou retirer du temps de jeu", "Proteger les reglages parent", "Reinitialiser notes, timer ou bonus"],
    tools: ["Moteur de calcul HarmoS", "Regles niveaux A/B/C", "Mode parent protege", "Timer de jeu", "Systeme bonus/malus", "Journal d'actions parent", "Stockage local", "Effets confetti et penalite"],
    techniques: ["React", "Vite", "TypeScript", "Calcul cote client", "Etat applicatif local", "Modal parent protegee par mot de passe", "Timer de temps de jeu", "Animations confetti et penalite", "Interface responsive"],
    automations: ["Recalcul automatique des moyennes", "Classification automatique de l'orientation", "Progression et conseils generes depuis les resultats", "Attribution automatique d'heures bonus selon les notes", "Retrait automatique si note inferieure a 4", "Timer play/pause", "Actions parent de reset et bonus/malus", "Journalisation des actions parent", "Persistance locale des parametres et resultats"]
  },
  "20-chess-3d-ultimate": {
    application: "Chess 3D Ultimate est un jeu d'echecs 3D jouable dans le navigateur. Il propose un plateau interactif, des pieces procedurales, plusieurs themes visuels et une IA adverse.",
    fonctionnement: "La partie est geree par chess.js: selection d'une piece, affichage des coups valides, execution du coup, mise a jour du FEN et tour de l'IA noire. La scene Three.js reconstruit le plateau, les pieces, les effets de selection et les animations. L'IA peut jouer en local avec evaluation/minimax ou utiliser Gemini, avec validation du coup repondu et fallback si la reponse n'est pas jouable.",
    conception: "Le projet a ete concu en separant la logique d'echecs de la scene 3D. Les regles restent fiables grace a chess.js, tandis que Three.js gere le rendu, les themes, les effets et l'interaction souris/raycast.",
    capabilities: ["Jouer une partie d'echecs 3D", "Selectionner une piece et voir les coups legaux", "Changer de theme visuel", "Jouer contre une IA locale", "Tester une IA Gemini", "Regler la difficulte", "Reinitialiser la partie", "Voir captures, animations et effets de selection"],
    tools: ["Moteur de regles chess.js", "IA locale random/evaluation/minimax", "Gemini comme adversaire optionnel", "Evaluation de position", "Validation des coups Gemini", "Fallback si coup invalide", "Raycast de selection", "Plateau et pieces proceduraux", "Themes classic/disney/LEGO"],
    techniques: ["React", "Vite", "Three.js", "chess.js", "OrbitControls", "Raycaster", "Pieces Staunton procedurales", "Minimax alpha-beta", "Option Gemini", "Themes classic/disney/LEGO"],
    automations: ["Generation procedurale du plateau et des pieces", "Detection des cases par raycast", "Affichage automatique des coups legaux", "Execution du tour IA apres le joueur", "IA locale random/evaluation/minimax selon difficulte", "Validation et fallback des coups Gemini", "Effets de capture et environnement anime", "Resize automatique de la scene"]
  },
  "20-jeu3d": {
    application: "Jeu 3D est un runner navigateur en 3D. Le joueur evite des obstacles, gagne des points, monte de niveau, charge une invincibilite, conserve des scores locaux et peut gagner des codes promo SkyIA.",
    fonctionnement: "La scene React Three Fiber affiche le joueur, l'environnement, les obstacles et les projectiles. Le store Zustand gere le statut menu/playing/gameover, le score, la vitesse, le niveau, les munitions, l'invincibilite, le son, les highscores et les recompenses. Les collisions sont verifiees avec des boites 3D elargies pour eviter les collisions manquees a grande vitesse.",
    conception: "Le projet a ete concu comme une base de gameplay rapide: un coeur de jeu simple, un rendu WebGL, une progression lisible et une connexion a l'ecosysteme SkyIA via les codes promo.",
    capabilities: ["Jouer un runner 3D", "Changer de voie au clavier ou tactile", "Eviter les obstacles", "Monter de niveau", "Charger une invincibilite", "Utiliser des munitions", "Sauvegarder les meilleurs scores", "Copier un code promo SkyIA", "Activer ou couper le son"],
    tools: ["Moteur de jeu WebGL", "Store de partie", "Detection de collision continue", "Systeme niveau/vitesse", "Invincibilite et ammo", "Leaderboard local", "Generateur de codes promo", "Sauvegarde Firebase des promos", "Audio player et postprocessing visuel"],
    techniques: ["React", "Vite", "TypeScript", "Three.js", "@react-three/fiber", "Zustand", "Box3 collision detection", "Postprocessing Bloom/Vignette", "localStorage", "Firebase pour codes promo"],
    automations: ["Progression de niveau tous les 10 obstacles", "Courbe de vitesse avec limite apres niveau 20", "Detection continue des collisions", "Charge automatique de l'invincibilite", "Gestion ammo/charge et destruction d'obstacle en mode charge", "Sauvegarde des 50 meilleurs scores localement", "Generation de codes promo selon seuils de score", "Sauvegarde asynchrone du code promo Firebase", "Controle clavier, A/D et touch swipe"]
  },
  "20-morphostyle": {
    application: "Morphostyle est une application IA de conseil visuel pour coiffure et style. Elle part d'une photo, recueille un profil de consultation, analyse la morphologie, propose des styles et genere des apercus realistes.",
    fonctionnement: "L'utilisateur charge une image, renseigne le genre, l'age, le niveau d'entretien, le style de vie et la longueur souhaitee. Gemini analyse ensuite la morphologie avec un schema JSON strict et renvoie la forme du visage, le conseil professionnel et une liste de styles recommandes. L'utilisateur selectionne jusqu'a quatre styles, genere les looks, puis peut demander des angles supplementaires gauche, droite ou dos.",
    conception: "Le projet a ete concu comme un assistant de consultation: il combine analyse structuree, recommandations lisibles et generation image-to-image. Les prompts insistent sur la conservation de l'identite, du fond, des vetements et de la lumiere afin de modifier surtout la coiffure ou la barbe.",
    capabilities: ["Uploader une photo", "Renseigner un profil de consultation", "Analyser la morphologie", "Recevoir des conseils professionnels", "Proposer des styles adaptes", "Selectionner jusqu'a quatre looks", "Generer des apercus realistes", "Demander des angles supplementaires", "Eviter les suggestions barbe pour enfant/bebe"],
    tools: ["Gemini pour analyse morphologique", "Gemini image-to-image", "Schema JSON strict", "Prompts de conservation identite/fond/lumiere", "Generation quick preview", "Generation multi-angle", "Retry automatique", "Gestion saturation service"],
    techniques: ["React", "Vite", "TypeScript", "@google/genai", "Gemini pour analyse JSON", "Gemini image-to-image", "Upload base64", "Schemas stricts", "Generation multi-angle", "Gestion d'erreurs et retry"],
    automations: ["Retry automatique avec delai exponentiel", "Analyse morphologique en JSON strict", "Regles age enfant/bebe sans barbe", "Generation rapide de previews", "Generation des looks selectionnes", "Conservation automatique de l'identite et du contexte dans le prompt", "Generation des angles front/left/right/back", "Messages de chargement et erreurs service sature"]
  },
  "30-pulsedeck": {
    application: "C2R PulseDeck est actuellement un cahier des charges, pas encore une application executable. Le concept decrit un futur outil local qui devra recevoir une idee brute, la clarifier et produire une fiche projet prete a relire ou a publier.",
    fonctionnement: "Le MVP prevu devra proposer une saisie d'idee, transformer cette saisie en blocs structures, conserver les projets dans un fichier JSON local et exporter une fiche Markdown. Les fonctions de tableau de bord, de detection des fiches incompletes et d'assistance IA sont decrites comme des etapes a developper; elles ne sont pas encore implementees dans ce dossier.",
    conception: "Le brief propose une application React et TypeScript construite avec Vite et Tailwind CSS, sans backend ni cloud pour le MVP. Les ecrans envisages sont la capture d'idee, la fiche generee et un tableau de bord. La priorite est de valider un parcours simple avant d'ajouter des automatisations ou des effets visuels avances.",
    installation: "Le depot actuel contient la specification du projet. Cloner le depot, entrer dans le dossier puis ouvrir `projet_c2r_pulsedeck.md`. Aucune installation de dependances n'est necessaire tant que le MVP React n'a pas ete implemente.",
    utilisation: "Dans l'etat actuel, utiliser le depot pour lire et affiner le cahier des charges, definir le perimetre du MVP et suivre les prochaines etapes. Une fois le MVP developpe, le parcours prevu sera: saisir une idee, generer la fiche, la corriger, puis l'exporter en Markdown.",
    capabilities: ["Specification du parcours de capture d'idee", "Definition du format de fiche projet", "Definition de l'export Markdown", "Definition des statuts de progression", "Definition du stockage JSON local", "Planification d'un tableau de bord MVP"],
    tools: ["Markdown pour le cahier des charges", "Git pour versionner la specification", "React, TypeScript, Vite et Tailwind CSS proposes pour le futur MVP", "JSON local propose pour les donnees"],
    techniques: ["MVP local sans backend", "Separation entre saisie, fiche et tableau de bord", "Export Markdown", "Stockage local JSON", "Fonctions avancees repoussees apres validation du MVP"],
    automations: [],
    recentUpdates: ["Cahier des charges du MVP documente dans projet_c2r_pulsedeck.md", "Depot GitHub public initialise le 7 aout 2026"]
  },
  "99-archive": {
    application: "Archive conserve les anciens projets, sauvegardes, medias, variantes WebGL, contenus CV et experimentations historiques. Elle sert de reserve de recuperation, pas de produit a publier.",
    fonctionnement: "L'orchestrateur detecte le dossier pour que l'historique reste visible dans le registre, mais le classe comme ARCHIVE_ONLY. Les routines normales n'y lancent pas de reparation, publication ou nettoyage reel. Les contenus peuvent etre consultes ponctuellement si une restauration ou une comparaison devient necessaire.",
    conception: "La zone a ete separee des projets actifs pour eviter de melanger anciens essais, gros medias et sauvegardes avec les applications actuelles. Le principe est la lecture et l'indexation, pas l'intervention automatique.",
    capabilities: ["Conserver les anciennes versions", "Retrouver des medias ou essais historiques", "Servir de reserve de restauration", "Eviter la publication accidentelle", "Garder la memoire des experimentations"],
    tools: ["Indexation orchestrateur", "Statut ARCHIVE_ONLY", "Regle lecture seule", "Exclusion des reparations", "Exclusion publication", "Rapports archive"],
    techniques: ["Dossier d'archives", "Indexation fichier", "Classification ARCHIVE_ONLY", "Lecture seule par convention", "Exclusion des publications", "Contenus historiques multimedia et code"],
    automations: ["Indexation dans le registre", "Exclusion des reparations par defaut", "Blocage publication", "Rapport archive read-only", "Non-modification sauf demande explicite"]
  },
  "competance-recherche-emploie": {
    application: "Competance Recherche Emploie est un cockpit personnel pour la recherche d'emploi. Il centralise les offres, sources, runs, validations, dossiers, postulations et archives pour transformer la recherche en pipeline suivi.",
    fonctionnement: "Le flux principal part de l'inbox et des sources d'offres, lance des recherches ou scans, dedoublonne et normalise les donnees, evalue les opportunites, cree des dossiers valides puis suit les candidatures. L'interface web propose des vues recherche, candidatures spontanees, applications, tracking, settings, sources et runs. Les scripts career-ops verifient les donnees, generent des PDF, controlent les liens et analysent les patterns de reponse.",
    conception: "Le projet a ete concu comme systeme personnel sensible: il melange CV, profil, scoring, sources, candidatures et automatisation IA. La prudence est donc prioritaire: l'orchestrateur l'indexe et le documente, mais bloque la publication automatique et signale les modifications Git existantes.",
    capabilities: ["Centraliser les offres", "Scanner des sources", "Evaluer les opportunites", "Dedoublonner les candidatures", "Generer des dossiers valides", "Suivre les postulations", "Analyser les retours", "Creer des PDF de candidature", "Controler les offres expirees", "Rechercher des entreprises pour candidatures spontanees"],
    tools: ["Pipeline inbox/sources/runs/validations/dossiers/postulations", "Mistral search", "Gemini evaluation", "Playwright PDF et liveness", "Zefix lookup", "Scanners ATS Greenhouse/Ashby/Lever", "Doctor prerequisites", "Verifier/normalize/dedup/merge", "Analyse patterns", "Update rollback avec backup"],
    techniques: ["Node.js", "Playwright", "Scripts career-ops", "Markdown et TSV de suivi", "Profil YAML", "Portails et sources configurees", "Interface JavaScript", "API locale", "Mistral/Gemini pour evaluation", "Generation PDF"],
    automations: ["Recherche et scan de sources d'offres", "Recherche assistee Mistral", "Optimisation, seed, discovery et import de sources", "Lookup entreprises via Zefix", "Validation d'une offre vers dossier de candidature", "Doctor des prerequis", "Verification integrite du pipeline", "Normalisation et deduplication des candidatures", "Merge batch TSV", "Generation PDF via Playwright", "Controle de synchronisation CV", "Liveness check des offres", "Analyse de patterns et blocages", "Systeme update/check/apply/rollback avec backup"]
  }
};

export function detailsForProject(project) {
  return projectDetails[project.id] || {
    application: `La finalite metier de ${displayName(project.name)} n'a pas encore ete validee a partir de ses sources.`,
    fonctionnement: "Fonctionnement non renseigne. Le code applicatif, les scripts et les donnees doivent etre examines avant de decrire le parcours reel.",
    conception: "Choix de conception non documentes. Ils doivent etre etablis a partir des fichiers source et de la documentation propre au projet.",
    capabilities: ["Fonctions metier a identifier dans le code", "Parcours utilisateur a confirmer", "Limites fonctionnelles a documenter"],
    tools: ["Outils et services propres au projet a identifier"],
    techniques: project.stack?.length ? project.stack : ["Techniques a identifier depuis les sources"],
    automations: ["Automatisations propres au projet a identifier"]
  };
}

export function publicUrlForProject(project) {
  return contentForProject(project).publicUrl || null;
}

export function hostingerUrlForProject(project) {
  return contentForProject(project).hostingerUrl || null;
}

export function githubUrlForProject(project) {
  return project?.links?.github || contentForProject(project).github || null;
}

export function githubCandidateForProject(project) {
  return contentForProject(project).githubCandidate || null;
}

export function displayName(name) {
  return String(name)
    .replace(/^\d+_/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
