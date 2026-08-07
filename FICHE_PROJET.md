# Orchestrateur global

## Liens vers l'application
- Lien public: non detecte
- GitHub: [https://github.com/RYJITS/orchestrateur-showcase](https://github.com/RYJITS/orchestrateur-showcase)

## A quoi sert le projet
L'Orchestrateur global est l'application locale qui pilote tout le dossier Projet. Elle sert a savoir quelles taches existent, qui doit les appliquer, a quelle frequence, quels projets sont concernes, quels garde-fous bloquent les risques, et quelles commandes peuvent etre lancees depuis le dashboard.

## Fonctionnement de l'application ou du projet
L'application lit deux sources: le registre des projets et le registre des taches. Le registre des taches definit les actions a faire, leur cadence, le responsable, la commande, les routines ou elles apparaissent et les conditions de securite. Le dashboard affiche ce plan de travail, permet de filtrer par frequence ou responsable, et lance uniquement les actions autorisees via l'API locale. Pour chaque action, l'utilisateur choisit l'executeur: script local, Codex superviseur, Mistral API ou Alibaba/Qwen API. Avant une action globale, le dashboard relance un scan de la racine projets pour inclure les nouveaux dossiers.

## Comment le projet a ete construit
Il a ete concu comme une couche prudente au-dessus de toute la racine projets. Chaque action importante est rattachee a une tache explicite, un responsable, une frequence, un executeur et des garde-fous: scanner avant modification, ne pas supprimer directement, ne pas publier sans audit securite OK, archiver ou sauvegarder avant intervention, et garder Site Ma Methode comme hub de lecture plutot que cible isolee.

## Installation et utilisation
### Installation
L'orchestrateur demande Git, PowerShell et Node.js 20 ou plus recent. Pour piloter plusieurs projets, placer son dossier a cote des autres projets dans une meme racine. Apres le clonage, executer `npm install`, puis `npm run check`. Aucune cle API reelle ne doit etre ajoutee au depot.

### Utilisation
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

## Fonctions disponibles dans l'application
- Ouvrir le dashboard par raccourci Bureau
- Ajouter ou supprimer des taches
- Creer des sous-taches
- Mettre une tache ou sous-tache en pause
- Definir quand et par qui chaque action est faite
- Installer plus tard les taches depuis le store
- Choisir l'executeur par action
- Inclure les nouveaux projets par scan automatique
- Faire les repos GitHub comme tache active principale
- Servir de garde-fou avant diffusion

## Outils, IA et moteurs en arriere-plan
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

## Automatisations integrees
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
- Aucune capture validee pour cette fiche.

## Mises a jour
- Ajout des routines daily, weekly et monthly pour automatiser les contrôles récurrents
- Intégration des subagents Mistral et Qwen pour les analyses sécurisées
- Renforcement des garde-fous avant publication (audit sécurité, vérification Hostinger)
- Optimisation des scripts de scan et de synchronisation des projets
