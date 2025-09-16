<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • <b>Français</b> • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuer à Roo Code

Roo Code est un projet communautaire, et nous apprécions profondément chaque contribution. Pour simplifier la collaboration, nous fonctionnons sur une base [d'abord l'issue](#approche-issue-first), ce qui signifie que toutes les [Pull Requests (PRs)](#soumettre-une-pull-request) doivent d'abord être liées à une Issue GitHub. Veuillez lire attentivement ce guide.

## Table des matières

- [Avant de contribuer](#avant-de-contribuer)
- [Trouver et planifier votre contribution](#trouver-et-planifier-votre-contribution)
- [Processus de développement et de soumission](#processus-de-développement-et-de-soumission)
- [Légal](#légal)

## Avant de contribuer

### 1. Code de conduite

Tous les contributeurs doivent adhérer à notre [Code de conduite](./CODE_OF_CONDUCT.md).

### 2. Feuille de route du projet

Notre feuille de route guide la direction du projet. Alignez vos contributions sur ces objectifs clés :

### La fiabilité d'abord

- Assurez-vous que l'édition de diff et l'exécution de commandes sont fiables de manière constante.
- Réduisez les points de friction qui découragent une utilisation régulière.
- Garantissez un fonctionnement fluide dans toutes les langues et sur toutes les plateformes.
- Étendez le support robuste à une grande variété de fournisseurs et de modèles d'IA.

### Expérience utilisateur améliorée

- Simplifiez l'UI/UX pour plus de clarté et d'intuitivité.
- Améliorez continuellement le flux de travail pour répondre aux attentes élevées des développeurs pour les outils à usage quotidien.

### Leader en performance d'agent

- Établissez des benchmarks d'évaluation complets (evals) pour mesurer la productivité en conditions réelles.
- Facilitez l'exécution et l'interprétation de ces évaluations par tout le monde.
- Livrez des améliorations qui démontrent des augmentations claires des scores d'évaluation.

Mentionnez l'alignement avec ces domaines dans vos PRs.

### 3. Rejoignez la communauté Roo Code

- **Principal :** Rejoignez notre [Discord](https://discord.gg/roocode) et envoyez un DM à **Hannes Rudolph (`hrudolph`)**.
- **Alternative :** Les contributeurs expérimentés peuvent s'engager directement via les [Projets GitHub](https://github.com/orgs/RooCodeInc/projects/1).

## Trouver et planifier votre contribution

### Types de contributions

- **Corrections de bugs :** Résoudre les problèmes de code.
- **Nouvelles fonctionnalités :** Ajouter des fonctionnalités.
- **Documentation :** Améliorer les guides et la clarté.

### Approche Issue-First

Toutes les contributions commencent par une Issue GitHub en utilisant nos modèles simples.

- **Vérifiez les issues existantes** : Recherchez dans les [Issues GitHub](https://github.com/RooCodeInc/Roo-Code/issues).
- **Créez une issue** en utilisant :
    - **Améliorations :** Modèle "Demande d'amélioration" (langage simple axé sur l'avantage pour l'utilisateur).
    - **Bugs :** Modèle "Rapport de bug" (reproduction minimale + attendu vs réel + version).
- **Vous voulez y travailler ?** Commentez "Claiming" sur l'issue et envoyez un DM à **Hannes Rudolph (`hrudolph`)** sur [Discord](https://discord.gg/roocode) pour être assigné. L'assignation sera confirmée dans le fil de discussion.
- **Les PRs doivent être liées à l'issue.** Les PRs non liées peuvent être fermées.

### Décider sur quoi travailler

- Consultez le [Projet GitHub](https://github.com/orgs/RooCodeInc/projects/1) pour les issues "Issue [Non assignée]".
- Pour la documentation, visitez [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Signaler des bugs

- Vérifiez d'abord les rapports existants.
- Créez un nouveau bug en utilisant le [modèle "Rapport de bug"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) avec :
    - Des étapes de reproduction claires et numérotées
    - Résultat attendu vs réel
    - Version de Roo Code (requise) ; fournisseur/modèle d'API si pertinent
- **Problèmes de sécurité** : Signalez-les en privé via les [avis de sécurité](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Processus de développement et de soumission

### Configuration du développement

1. **Fork & Cloner :**

```
git clone https://github.com/VOTRE_NOM_UTILISATEUR/Roo-Code.git
```

2. **Installer les dépendances :**

```
pnpm install
```

3. **Débogage :** Ouvrir avec VS Code (`F5`).

### Lignes directrices pour l'écriture de code

- Une PR ciblée par fonctionnalité ou correction.
- Suivez les meilleures pratiques d'ESLint et de TypeScript.
- Rédigez des commits clairs et descriptifs faisant référence aux issues (par exemple, `Fixes #123`).
- Fournissez des tests approfondis (`npm test`).
- Rebasez sur la dernière branche `main` avant la soumission.

### Soumettre une Pull Request

- Commencez par une **PR en brouillon** si vous recherchez des commentaires précoces.
- Décrivez clairement vos changements en suivant le modèle de Pull Request.
- Liez l'issue dans la description/le titre de la PR (par exemple, "Fixes #123").
- Fournissez des captures d'écran/vidéos pour les changements d'interface utilisateur.
- Indiquez si des mises à jour de la documentation sont nécessaires.

### Politique de Pull Request

- Doit faire référence à une Issue GitHub assignée. Pour être assigné : commentez "Claiming" sur l'issue et envoyez un DM à **Hannes Rudolph (`hrudolph`)** sur [Discord](https://discord.gg/roocode). L'assignation sera confirmée dans le fil de discussion.
- Les PRs non liées peuvent être fermées.
- Les PRs doivent passer les tests d'intégration continue, s'aligner sur la feuille de route et avoir une documentation claire.

### Processus de révision

- **Triage quotidien :** Vérifications rapides par les mainteneurs.
- **Révision hebdomadaire approfondie :** Évaluation complète.
- **Itérez rapidement** en fonction des commentaires.

## Légal

En contribuant, vous acceptez que vos contributions soient sous licence Apache 2.0, conformément à la licence de Roo Code.
