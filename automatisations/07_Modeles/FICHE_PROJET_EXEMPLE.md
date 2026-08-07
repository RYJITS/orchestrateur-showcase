# Fiche projet exemple - Site Ma Methode

Ce modele est le contrat officiel des fiches projet. Il sert au script, a la validation automatique et a une IA de redaction pour les nouveaux projets.

Une bonne fiche explique le projet lui-meme, pas le script qui genere la fiche.

# Nom lisible du projet

## Liens vers l'application
- Lien public: URL publique si autorisee, sinon `non publie` ou `masque par securite`.
- GitHub: URL du depot si autorisee.

Cette section doit toujours exister, meme si certains liens ne sont pas publiables. Ne pas afficher le chemin local et ne pas mentionner l'hebergeur dans la fiche publique.

## A quoi sert le projet
Decrire l'application en langage utilisateur. Dire le probleme traite, le resultat visible, le contexte d'usage et la valeur du projet.

Mauvais exemple: "Le script a scanne le dossier et genere une fiche."

Bon exemple: "SkyIA est une application de jugement IA adversarial qui compare des modeles, orchestre des duels et archive les resultats."

## Fonctionnement de l'application ou du projet
Expliquer le parcours reel: entree utilisateur, actions disponibles, calculs/API/moteurs utilises, sortie produite.

## Comment le projet a ete construit
Expliquer l'approche produit et technique: frontend, backend, donnees, separation public/prive, choix de design ou architecture.

## Fonctions disponibles dans l'application
- Fonction utilisateur 1.
- Fonction utilisateur 2.
- Fonction utilisateur 3.

## Outils, IA et moteurs en arriere-plan
- Frameworks visibles dans le projet.
- API ou moteurs utilises.
- Services externes seulement si le lien est public ou non sensible.

## Automatisations integrees
- Automatisations propres au projet.
- Taches planifiees ou scripts utiles.
- Ne pas lister uniquement les scripts de l'orchestrateur sauf si le projet est l'orchestrateur.

## Captures d'ecran
Ajouter des captures coherentes du projet si elles existent et sont publiques.

```markdown
![Capture 1 - Nom du projet](public/orchestrator/captures/id-projet/capture-desktop.png)
```

Ne pas utiliser une capture du site Ma Methode comme vignette d'un autre projet.

## Mises a jour
- Lister les changements recents utiles pour comprendre le projet.
- Si une fonction a ete ajoutee, decrire la fonction et son impact.
- Si la fiche est actualisee sans changement metier connu, indiquer que la fiche a ete synchronisee.
- Si Git contient des changements locaux, signaler qu'une relecture est necessaire.

## Derniere mise a jour
Date ISO de derniere actualisation.

## Criteres de qualite

- La fiche parle du produit, pas seulement des fichiers.
- La section `Liens vers l'application` est presente avec seulement `Lien public` et `GitHub`.
- La section `A quoi sert le projet` explique l'utilite du projet.
- La section `Fonctionnement de l'application ou du projet` explique le vrai fonctionnement.
- La section `Comment le projet a ete construit` explique la construction.
- La section `Mises a jour` existe et mentionne les changements ou la synchronisation.
- Les sections de resume carte, public cible et suivi technique interne ne doivent pas apparaitre dans la fiche publique.
- Les captures montrent le projet concerne.
- Les liens publics sont masques si la securite n'est pas OK.
- Le ton reste francais, clair, utile.
