# Automatisations Orchestrateur

Ce dossier contient les scripts d'action de haut niveau.

Principe:

- une action = un script numerote;
- `--dry-run` par defaut pour annoncer les commandes;
- `--run` pour executer l'action;
- rapport Markdown et JSON dans `automatisations/99_Resultats/<tache>`;
- aucune publication reelle sans gate securite et validation dediee.

## Actions proposees

0. `00-pilote-automatisations.mjs` - auditer toutes les taches, lancer un test reel cible sur un projet et servir d'executeur global avec garde-fous.
1. `01-scan-etat-projets.mjs` - scanner la flotte de projets, compter les projets, verifier Git local, fiches Ma Methode, cartes publiques et depot GitHub connu.
2. `02-moteur-audit.mjs` - verifier les moteurs d'audit, Hostinger Vite et GitHub git-only avant les audits specialises.
3. `03-audit-securite.mjs` - auditer les secrets, sessions et donnees sensibles avec rapport Markdown aligne.
4. `04-preparation-git-public.mjs` - preparer un depot GitHub public propre, verifier les fichiers utiles, exclure secrets/donnees privees et imposer un README avec demarrage rapide, installation, lancement et utilisation.
5. `05-verification-statuts-publication.mjs` - reprendre les statuts Hostinger Vite/GitHub apres preparation et proposer/appliquer seulement les corrections sures.
6. `06-deploiement-repos-github-public.mjs` - preparer le deploiement des depots GitHub avec README utilisable; la publication est bloquee si le demarrage rapide, l'installation, le lancement, l'utilisation ou les commandes detectees manquent.
7. `07-fiches-et-vignettes-ma-methode.mjs` - capturer les projets publics lancables, actualiser/creer les fiches projet, generer seulement les vignettes manquantes et synchroniser Site Ma Methode.
8. `08-verification-fonctionnement.mjs` - verifier les scripts de build/test/lint/dev.
9. `09-synchronisation-site-ma-methode.mjs` - synchroniser le hub public sans publier.
10. `10-controles-publication.mjs` - lancer les gates GitHub, Hostinger, site et rendu.
11. `11-preparation-hostinger.mjs` - preparer l'archive Hostinger sans deployer.
12. `12-memoire-index.mjs` - enregistrer les evolutions et regenerer les index memoire.

## Organisation optimisee 02-05

Les actions 02, 03, 04 et 05 gardent des responsabilites separees:

- `02` produit les statuts de publication et de controle.
- `03` regenere/relit les audits securite projet.
- `04` prepare le Git public propre, les fichiers publics et le build local.
- `05` transforme les statuts apres preparation en actions de correction/validation.

Le code commun est regroupe dans:

```text
automatisations\lib\automation-utils.mjs
```

Cette lib centralise les rapports Markdown/JSON, les tableaux alignes, les arguments `--run`/`--dry-run`, la recherche du dernier rapport JSON et les textes courts. Les scripts restent donc plus faciles a maintenir sans fusionner leurs roles.

## Actions manuelles

```powershell
node automatisations/00-pilote-automatisations.mjs
node automatisations/00-pilote-automatisations.mjs --test-project --project 10_harmos-calc
node automatisations/00-pilote-automatisations.mjs --run-all --confirm-run-all
node automatisations/00-pilote-automatisations.mjs --run-all --confirm-run-all --local-only
node automatisations/00-rapport-workflow-projets.mjs
node automatisations/00-executeur-projets.mjs --list
node automatisations/00-executeur-projets.mjs --project 10_harmos-calc --actions scan,github,report
node automatisations/00-executeur-projets.mjs --project 10_harmos-calc --workflow
node automatisations/00-executeur-projets.mjs --all --workflow --test
node automatisations/01-scan-etat-projets.mjs
node automatisations/01-scan-etat-projets.mjs --run
node automatisations/02-moteur-audit.mjs
node automatisations/02-moteur-audit.mjs --run
node automatisations/03-audit-securite.mjs
node automatisations/03-audit-securite.mjs --run
node automatisations/04-preparation-git-public.mjs
node automatisations/04-preparation-git-public.mjs --run
node automatisations/04-preparation-git-public.mjs --api --compare-agents --limit 3
node automatisations/04-preparation-git-public.mjs --api --simulate-fail-agent mistral --limit 1
node automatisations/05-verification-statuts-publication.mjs
node automatisations/05-verification-statuts-publication.mjs --run
node automatisations/06-deploiement-repos-github-public.mjs
node automatisations/06-deploiement-repos-github-public.mjs --run
node automatisations/06-deploiement-repos-github-public.mjs --api --compare-agents --limit 3
node automatisations/07-fiches-et-vignettes-ma-methode.mjs
node automatisations/07-fiches-et-vignettes-ma-methode.mjs --run
node automatisations/07-fiches-et-vignettes-ma-methode.mjs --run --local-only
node automatisations/07-fiches-et-vignettes-ma-methode.mjs --run --qwen-max 1
node automatisations/07-fiches-et-vignettes-ma-methode.mjs --run --no-captures
```

Double-clic Windows:

```text
automatisations\00_Executer\Ouvrir_Orchestrateur_Projets_Actions_HTA.cmd
automatisations\00_Executer\Orchestrateur_Projets_Actions.hta
automatisations\00_Executer\Ouvrir_Orchestrateur_Automatisations_HTA.cmd
automatisations\00_Executer\Orchestrateur_Automatisations.hta
automatisations\00_Executer\Lancer_Toutes_Les_Automatisations.cmd
automatisations\00_Executer\Lancer_Automatisation_01_Scan_Etat_Projets.cmd
automatisations\00_Executer\Lancer_Automatisation_02_Moteur_Audit.cmd
automatisations\00_Executer\Lancer_Automatisation_03_Audit_Securite.cmd
automatisations\00_Executer\Lancer_Automatisation_04_Preparation_Git_Public.cmd
automatisations\00_Executer\Lancer_Automatisation_05_Verification_Statuts_Publication.cmd
automatisations\00_Executer\Lancer_Automatisation_06_Deploiement_Repos_GitHub_Public.cmd
automatisations\00_Executer\Lancer_Automatisation_07_Fiches_Vignettes_Ma_Methode.cmd
```

Le lanceur propose:

- `D` pour dry-run;
- `R` pour executer l'action;
- `Q` pour quitter.

Les resultats des automatisations sont ecrits dans un dossier par tache:

```text
automatisations\99_Resultats\01-scan-etat-projets
automatisations\99_Resultats\00-pilote-automatisations
automatisations\99_Resultats\00-rapport-workflow-projets
automatisations\99_Resultats\00-executeur-projets
automatisations\99_Resultats\02-moteur-audit
automatisations\99_Resultats\03-audit-securite
automatisations\99_Resultats\04-preparation-git-public
automatisations\99_Resultats\05-verification-statuts-publication
automatisations\99_Resultats\06-deploiement-repos-github-public
automatisations\99_Resultats\07-fiches-et-vignettes-ma-methode
```

## Pilote 00 - Executeur global

Le pilote `00` sert de point d'entree:

- audit syntaxe des taches `01` a `07`;
- dry-run de chaque tache avec rapport centralise;
- test reel cible sur un seul projet via `04 --run --project <projet>`;
- build local du projet cible quand un script `build` existe;
- controle des fichiers publics generes pour eviter chemin local, cle `hostingerUrl` interne ou token apparent;
- run global uniquement avec `--confirm-run-all`.

Il ne fait jamais `git add`, commit, push, changement de visibilite GitHub ou publication Hostinger.

## Interface HTA

L'interface concrete par projet se lance par double-clic:

```text
automatisations\00_Executer\Ouvrir_Orchestrateur_Projets_Actions_HTA.cmd
```

Elle scanne les projets au demarrage, affiche la liste, puis permet de lancer:

- une action sur le projet selectionne;
- une action sur tous les projets visibles;
- le workflow complet projet;
- le workflow complet tous projets;
- le mode test seulement si la case `Mode test` est cochee.
- la vue `Actions par projet` avec compteurs finalises / a revoir / bloques, prochaine action et actions a mettre en place.

Actions disponibles:

- scan;
- securite;
- fonctionnement;
- GitHub public;
- fiches;
- captures;
- vignettes;
- synchronisation Site Ma Methode;
- rapport consolide.

Moteur:

```text
automatisations\00-executeur-projets.mjs
```

Sorties:

```text
automatisations\99_Resultats\00-executeur-projets\projects-latest.json
automatisations\99_Resultats\00-executeur-projets\last-execution.md
```

L'ancienne interface globale reste disponible:

L'interface locale HTA se lance par double-clic:

```text
automatisations\00_Executer\Ouvrir_Orchestrateur_Automatisations_HTA.cmd
```

Elle permet:

- de lancer chaque tache separement en dry-run ou run;
- de lancer le workflow complet avec confirmation;
- de lancer un test reel cible sur un projet;
- de regenerer le rapport consolide par projet;
- d'ouvrir le dernier rapport et le dossier des resultats.

Fichiers:

```text
automatisations\00_Executer\Orchestrateur_Automatisations.hta
automatisations\00_Executer\orchestrateur-automatisations.css
automatisations\00-rapport-workflow-projets.mjs
```

Le rapport consolide se trouve dans:

```text
automatisations\99_Resultats\00-rapport-workflow-projets
```

## Automatisation 06 - Deploiement repos GitHub publics

Le `06` ne publie rien sans validation humaine. Il prepare un plan public par projet:

- fichiers utiles a inclure pour installer et lancer localement;
- README public qui commence par le clonage, le demarrage rapide, l'installation, le lancement et l'utilisation individuelle;
- controle bloquant du README avant creation du workspace et avant push GitHub;
- fichiers a exclure: `.env`, sessions, caches, builds, logs, archives, cles privees;
- fichiers a revoir: bases locales, exports, zips, tableurs, donnees potentiellement personnelles;
- commandes detectees: installation, dev, build, test;
- manques: `README.md`, `.gitignore`, `.env.example` si des variables sont detectees.

En `--run`, il peut ecrire:

- `PREPARATION_GITHUB_PUBLIC.md`;
- `PREPARATION_GITHUB_PUBLIC.json`;
- `README_GITHUB_PUBLIC.md`;
- `.gitignore` complete;
- `.env.example` sans valeurs secretes quand des variables sont detectees.

Il ne fait jamais `git add`, commit, push, ni changement de visibilite GitHub.

Validation IA:

- Mistral est le validateur principal;
- Qwen prend le relais si Mistral ne repond pas;
- avec `--compare-agents`, les deux sont appeles et le premier JSON valide est retenu;
- le contexte envoye est un manifeste filtre, pas les fichiers secrets.

## Automatisation 07 - Fiches et vignettes Ma Methode

Le `07` regroupe trois actions existantes dans un flux lisible:

- `update-project-fiches.mjs` pour creer ou actualiser `FICHE_PROJET.md`, `INSTALLATION_FR.md`, `CHANGELOG_FR.md`;
- `generate-project-thumbnails.mjs` pour generer seulement les vignettes manquantes;
- `update-site-ma-methode-projects.mjs --sync` pour copier les fiches et cartes dans Site Ma Methode.

Modeles fournis:

```text
automatisations\07_Modeles\FICHE_PROJET_EXEMPLE.md
automatisations\07_Modeles\VIGNETTES_GRATUITES.md
```

Regles vignettes:

- conserver les vignettes existantes;
- option 1: tenter Qwen-Image uniquement pour les vignettes manquantes;
- option 2: fallback local gratuit en WebP via SVG + Sharp;
- limiter Qwen avec `--qwen-max` pour proteger les credits;
- couper Qwen avec `--local-only` si besoin;
- endpoint Qwen-Image par defaut: `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
- utiliser les assets publics locaux si disponibles;
- capturer les projets `OK_PUBLIC` lancables avant la generation des fiches;
- garder les captures d'ecran comme captures de fiche, pas comme vignettes principales;
- ne jamais utiliser une capture du site Ma Methode comme vignette d'un autre projet;
- ne jamais remplacer les anciennes vignettes sans `--force-thumbnails`.

## Statuts d'action de l'automatisation 04

| Statut action    | Sens                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| OK_AUCUNE_ACTION | Le controle passe deja ou ne concerne pas ce canal.                  |
| A_FAIRE_AUTO     | Correction sure disponible via l'action 04 en mode RUN.              |
| A_FAIRE_MANUEL   | Correction a faire/revoir manuellement avant publication.            |
| BLOQUE_SECURITE  | Publication bloquee tant que le probleme securite n'est pas corrige. |
| APPLIQUE_OK      | Action automatique executee avec succes pendant un RUN.              |
| ECHEC_ACTION     | Action automatique tentee mais en erreur pendant un RUN.             |
| A_ANALYSER       | Statut non reconnu a analyser avant toute action.                    |
