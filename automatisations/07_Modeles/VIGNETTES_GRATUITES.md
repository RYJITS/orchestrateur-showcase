# Strategie vignettes gratuites - Site Ma Methode

Objectif: produire ou conserver des vignettes coherentes en privilegiant Qwen-Image si disponible, puis le local gratuit si Qwen echoue ou si les credits doivent etre preserves.

## Solution par defaut

1. Conserver toute vignette existante si le fichier existe.
2. Generer uniquement les vignettes manquantes.
3. Option 1: tenter Qwen-Image pour une image plus riche.
4. Option 2: si Qwen est indisponible, en erreur, ou limite par credit, generer localement via SVG + Sharp.
5. Utiliser des assets locaux deja presents dans `01_SITE_MA_METHODE/public` quand ils existent.
6. Ne jamais utiliser une capture du site Ma Methode comme vignette d'un autre projet.

## Sources gratuites autorisees

- Vignettes existantes dans `public/orchestrator/thumbnails`.
- Vignettes IA deja payees/produites dans `public/orchestrator/thumbnails-ai`, si elles existent.
- Qwen-Image uniquement pour les vignettes manquantes, avec limite par lancement.
- Assets publics locaux du site: images de projet, logos, scenes deja validees.
- Generation locale deterministe: formes, grilles, couleurs, motifs lies au theme du projet.
- Captures d'ecran du projet seulement comme captures de fiche, pas comme vignette principale par defaut.

## Regles de securite

- Pas de capture si le projet n'est pas `OK_PUBLIC`.
- Pas d'image provenant d'un dossier prive, session, archive sensible ou `.env`.
- Pas de screenshot contenant donnees personnelles, tokens, logs, tableaux sensibles ou interface admin privee.
- Archive exclue du hub comme projet actif.
- Pas de remplacement massif avec Qwen: limiter par `--qwen-max`.

## Options futures sans cout

- Deposer manuellement une image WebP dans `01_SITE_MA_METHODE/public/orchestrator/thumbnails/<id>.webp`.
- Ajouter une image source locale dans `sourceAssetFor()` du script `generate-project-thumbnails.mjs`.
- Capturer desktop/mobile avec `npm run screenshots -- --capture` seulement pour les projets `OK_PUBLIC`.
- Faire valider les vignettes par une IA textuelle via un manifeste.
- Couper Qwen avec `--local-only` si on veut preserver les credits.
