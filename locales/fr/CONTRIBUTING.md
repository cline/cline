[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • <b>Français</b> • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Contribuer à Roo Code

Roo Code est un projet porté par la communauté, et chaque contribution compte beaucoup pour nous. Pour fluidifier la collaboration, nous fonctionnons selon une [approche Issue-First](#approche-issue-first), ce qui signifie que toutes les [Pull Requests (PRs)](#soumettre-une-pull-request) doivent d'abord être liées à un ticket GitHub. Lis attentivement ce guide.

## Table des matières

- [Avant de contribuer](#avant-de-contribuer)
- [Trouver et planifier ta contribution](#trouver-et-planifier-ta-contribution)
- [Processus de développement et de soumission](#processus-de-développement-et-de-soumission)
- [Légal](#légal)

## Avant de contribuer

### 1. Code de conduite

Tous les contributeurs doivent respecter notre [Code de conduite](./CODE_OF_CONDUCT.md).

### 2. Feuille de route du projet

Notre feuille de route guide la direction du projet. Aligne tes contributions avec ces objectifs clés :

### Fiabilité avant tout

- Garantir que l'édition des différences et l'exécution des commandes soient toujours fiables.
- Réduire les points de friction qui découragent l'utilisation régulière.
- Assurer un fonctionnement fluide dans toutes les langues et sur toutes les plateformes.
- Étendre le support robuste pour une grande variété de fournisseurs et de modèles d'IA.

### Expérience utilisateur améliorée

- Simplifier l'interface utilisateur pour plus de clarté et d'intuitivité.
- Améliorer continuellement le flux de travail pour répondre aux attentes élevées des développeurs.

### Leadership en performance des agents

- Établir des référentiels d'évaluation (evals) complets pour mesurer la productivité réelle.
- Permettre à chacun d'exécuter et d'interpréter facilement ces évaluations.
- Fournir des améliorations qui démontrent des augmentations claires dans les scores d'évaluation.

Mentionne l'alignement avec ces domaines dans tes PRs.

### 3. Rejoindre la communauté Roo Code

- **Principal :** Rejoins notre [Discord](https://discord.gg/roocode) et envoie un DM à **Hannes Rudolph (`hrudolph`)**.
- **Alternative :** Les contributeurs expérimentés peuvent participer directement via [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1).

## Trouver et planifier ta contribution

### Types de contributions

- **Corrections de bugs :** Résoudre des problèmes dans le code.
- **Nouvelles fonctionnalités :** Ajouter de nouvelles fonctions.
- **Documentation :** Améliorer les guides et la clarté.

### Approche Issue-First

Toutes les contributions doivent commencer par un ticket GitHub.

- **Vérifier les tickets existants :** Cherche dans les [Issues GitHub](https://github.com/RooCodeInc/Roo-Code/issues).
- **Créer un ticket :** Utilise les modèles appropriés :
    - **Bugs :** Modèle "Bug Report".
    - **Fonctionnalités :** Modèle "Detailed Feature Proposal". Approbation requise avant de commencer.
- **Réclamer des tickets :** Commente et attends l'assignation officielle.

**Les PRs sans tickets approuvés peuvent être fermées.**

### Décider sur quoi travailler

- Consulte le [Projet GitHub](https://github.com/orgs/RooCodeInc/projects/1) pour les "Good First Issues" non assignés.
- Pour la documentation, visite [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Signaler des bugs

- Vérifie d'abord les rapports existants.
- Crée de nouveaux rapports de bugs avec le [modèle "Bug Report"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Failles de sécurité :** Signale-les en privé via [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Processus de développement et de soumission

### Configuration du développement

1. **Fork & Clone :**

```
git clone https://github.com/TON_UTILISATEUR/Roo-Code.git
```

2. **Installer les dépendances :**

```
npm run install:all
```

3. **Débogage :** Ouvre avec VS Code (`F5`).

### Guide d'écriture du code

- Une PR ciblée par fonctionnalité ou correction.
- Suis les bonnes pratiques ESLint et TypeScript.
- Écris des commits clairs et descriptifs référençant les tickets (ex : `Fixes #123`).
- Fournis des tests complets (`npm test`).
- Rebase sur la dernière branche `main` avant de soumettre.

### Soumettre une Pull Request

- Commence par un **brouillon de PR** si tu cherches un feedback précoce.
- Décris clairement tes changements en suivant le modèle de Pull Request.
- Fournis des captures d'écran/vidéos pour les changements d'interface.
- Indique si des mises à jour de documentation sont nécessaires.

### Politique de Pull Request

- Doit référencer des tickets pré-approuvés et assignés.
- Les PRs ne respectant pas cette politique peuvent être fermées.
- Les PRs doivent passer les tests CI, s'aligner avec la feuille de route et avoir une documentation claire.

### Processus de revue

- **Triage quotidien :** Vérifications rapides par les mainteneurs.
- **Revue hebdomadaire approfondie :** Évaluation complète.
- **Itère rapidement** sur la base du feedback.

## Légal

En contribuant, tu acceptes que tes contributions soient sous licence Apache 2.0, conformément à la licence de Roo Code.
