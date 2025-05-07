[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • <b>Français</b> • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Contribuer à Roo Code

Roo Code est un projet porté par la communauté et chaque contribution compte beaucoup pour nous. Pour garantir un processus fluide et efficace, **nous fonctionnons selon le principe "[Issue-First](#2-principe-clé-approche-issue-first)".** Cela signifie que tout travail doit être lié à un ticket GitHub _avant_ de soumettre une Pull Request (voir notre [Politique PR](#politique-de-pull-request-pr) pour plus de détails). Lis attentivement ce guide pour comprendre comment contribuer.
Ce guide explique comment contribuer à Roo Code, que ce soit pour corriger des bugs, ajouter des fonctionnalités ou améliorer la documentation.

## Table des matières

- [I. Avant de contribuer](#i-avant-de-contribuer)
    - [1. Code de conduite](#1-code-de-conduite)
    - [2. Comprendre la feuille de route du projet](#2-comprendre-la-feuille-de-route-du-projet)
        - [Support des fournisseurs](#support-des-fournisseurs)
        - [Support des modèles](#support-des-modèles)
        - [Support des systèmes](#support-des-systèmes)
        - [Documentation](#documentation)
        - [Stabilité](#stabilité)
        - [Internationalisation](#internationalisation)
    - [3. Rejoindre la communauté Roo Code](#3-rejoindre-la-communauté-roo-code)
- [II. Trouver et planifier ta contribution](#ii-trouver-et-planifier-ta-contribution)
    - [1. Types de contributions](#1-types-de-contributions)
    - [2. Principe clé : Approche Issue-First](#2-principe-clé--approche-issue-first)
    - [3. Décider sur quoi travailler](#3-décider-sur-quoi-travailler)
    - [4. Signaler des bugs ou des problèmes](#4-signaler-des-bugs-ou-des-problèmes)
- [III. Processus de développement et de soumission](#iii-processus-de-développement-et-de-soumission)
    - [1. Configuration du développement](#1-configuration-du-développement)
    - [2. Guide d’écriture du code](#2-guide-décriture-du-code)
    - [3. Soumettre du code : Processus de Pull Request (PR)](#3-soumettre-du-code--processus-de-pull-request-pr)
        - [Pull Requests en brouillon](#pull-requests-en-brouillon)
        - [Description de la Pull Request](#description-de-la-pull-request)
        - [Politique de Pull Request (PR)](#politique-de-pull-request-pr)
            - [Objectif](#objectif)
            - [Approche Issue-First](#approche-issue-first)
            - [Conditions pour les PR ouvertes](#conditions-pour-les-pr-ouvertes)
            - [Procédure](#procédure)
            - [Responsabilités](#responsabilités)
- [IV. Légal](#iv-légal)
    - [Accord de contribution](#accord-de-contribution)

## I. Avant de contribuer

Commence par te familiariser avec nos standards communautaires et la direction du projet.

### 1. Code de conduite

Tous les contributeurs doivent respecter notre [Code de conduite](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md). Merci de le lire avant de contribuer.

### 2. Comprendre la feuille de route du projet

Roo Code a une feuille de route claire qui guide nos priorités et notre direction future. La comprendre t’aide à :

- Aligner tes contributions avec les objectifs du projet
- Identifier les domaines où tes compétences sont les plus utiles
- Comprendre le contexte de certaines décisions de conception
- Trouver l’inspiration pour de nouvelles fonctionnalités qui soutiennent notre vision

Notre feuille de route actuelle se concentre sur six piliers principaux :

#### Support des fournisseurs

Nous voulons prendre en charge autant de fournisseurs que possible :

- Plus de support "Compatible OpenAI"
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Meilleur support pour Ollama et LM Studio

#### Support des modèles

Nous voulons que Roo fonctionne avec le plus de modèles possible, y compris les modèles locaux :

- Support des modèles locaux via des prompts système personnalisés et des workflows
- Benchmarks, évaluations et cas de test

#### Support des systèmes

Nous voulons que Roo fonctionne bien sur tous les ordinateurs :

- Intégration du terminal multiplateforme
- Support fort et cohérent pour Mac, Windows et Linux

#### Documentation

Nous voulons une documentation complète et accessible pour tous les utilisateurs et contributeurs :

- Guides et tutoriels étendus
- Documentation API claire
- Meilleur accompagnement des contributeurs
- Ressources de documentation multilingues
- Exemples interactifs et extraits de code

#### Stabilité

Nous voulons réduire significativement les bugs et augmenter les tests automatisés :

- Interrupteur de logs de debug
- Bouton "Informations machine/tâche" à copier pour les demandes de support ou de bug

#### Internationalisation

Nous voulons que Roo parle la langue de tout le monde :

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Nous accueillons particulièrement les contributions qui font avancer les objectifs de notre feuille de route. Si tu travailles sur quelque chose qui s’aligne avec ces piliers, mentionne-le dans la description de ta PR.

### 3. Rejoindre la communauté Roo Code

Se connecter à la communauté Roo Code est un excellent moyen de commencer :

- **Méthode principale** :
    1.  Rejoins la [communauté Roo Code sur Discord](https://discord.gg/roocode).
    2.  Une fois inscrit, envoie un message privé (DM) à **Hannes Rudolph** (Discord : `hrudolph`) pour discuter de ton intérêt et obtenir des conseils.
- **Alternative pour les contributeurs expérimentés** : Si tu es à l’aise avec l’approche issue-first, tu peux participer directement sur GitHub en suivant le [tableau Kanban](https://github.com/orgs/RooVetGit/projects/1) et en communiquant via issues et pull requests.

## II. Trouver et planifier ta contribution

Identifie ce sur quoi tu veux travailler et comment t’y prendre.

### 1. Types de contributions

Nous acceptons différents types de contributions :

- **Corrections de bugs** : Résoudre des problèmes dans le code existant.
- **Nouvelles fonctionnalités** : Ajouter de nouvelles fonctions.
- **Documentation** : Améliorer les guides, exemples ou corriger des fautes de frappe.

### 2. Principe clé : Approche Issue-First

**Toutes les contributions doivent commencer par un ticket GitHub.** C’est essentiel pour garantir l’alignement et éviter les efforts inutiles.

- **Trouver ou créer un ticket** :
    - Avant de commencer, cherche dans les [Issues GitHub](https://github.com/RooVetGit/Roo-Code/issues) si un ticket existe déjà pour ta contribution.
    - S’il existe et n’est pas assigné, commente pour exprimer ton intérêt. Un mainteneur te l’assignera.
    - S’il n’existe pas, crée-en un nouveau avec le bon modèle sur notre [page d’issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose) :
        - Pour les bugs, utilise le modèle "Bug Report".
        - Pour les nouvelles fonctionnalités, utilise le modèle "Detailed Feature Proposal". Attends l’approbation d’un mainteneur (surtout @hannesrudolph) avant de commencer à coder.
        - **Note** : Les idées générales ou discussions préliminaires peuvent commencer dans [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests). Une fois l’idée plus concrète, crée un ticket "Detailed Feature Proposal".
- **Réclamer et assigner** :
    - Indique clairement ton intention de travailler sur un ticket en commentant dessus.
    - Attends qu’un mainteneur te l’assigne officiellement sur GitHub. Cela évite que plusieurs personnes travaillent sur la même chose.
- **Conséquences si tu ne respectes pas** :
    - Les Pull Requests (PR) soumises sans ticket correspondant, pré-approuvé et assigné peuvent être fermées sans examen complet. Cette politique vise à garantir l’alignement des contributions avec les priorités du projet et à respecter le temps de chacun.

Cette approche nous aide à suivre le travail, à garantir que les changements sont souhaités et à coordonner efficacement les efforts.

### 3. Décider sur quoi travailler

- **Good First Issues** : Consulte la section "Issue [Unassigned]" de notre [projet Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) sur GitHub.
- **Documentation** : Bien que ce `CONTRIBUTING.md` soit le guide principal pour les contributions de code, si tu veux contribuer à d’autres docs (guides utilisateurs ou API), consulte le [repo Roo Code Docs](https://github.com/RooVetGit/Roo-Code-Docs) ou demande sur Discord.
- **Proposer de nouvelles fonctionnalités** :
    1.  **Idée/discussion initiale** : Pour des idées larges ou nouvelles, commence une discussion dans [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
    2.  **Proposition formelle** : Pour des propositions spécifiques et prêtes à être examinées, crée un ticket "Detailed Feature Proposal" avec le modèle sur notre [page d’issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose). C’est une étape clé de notre **approche Issue-First**.

### 4. Signaler des bugs ou des problèmes

Si tu trouves un bug :

1.  **Cherche des tickets existants** : Consulte les [Issues GitHub](https://github.com/RooVetGit/Roo-Code/issues) pour voir si le problème a déjà été signalé.
2.  **Crée un nouveau ticket** : Si c’est unique, utilise le modèle "Bug Report" sur notre [page d’issues](https://github.com/RooVetGit/Roo-Code/issues/new/choose).

> 🔐 **Vulnérabilités de sécurité** : Si tu découvres une faille de sécurité, signale-la en privé via l’[outil d’avis de sécurité GitHub](https://github.com/RooVetGit/Roo-Code/security/advisories/new). Ne crée pas de ticket public pour les failles de sécurité.

## III. Processus de développement et de soumission

Suis ces étapes pour coder et soumettre ton travail.

### 1. Configuration du développement

1.  **Fork & Clone** :
    - Forke le repo sur GitHub.
    - Clone ton fork localement : `git clone https://github.com/TON_UTILISATEUR/Roo-Code.git`
2.  **Installe les dépendances** : `npm run install:all`
3.  **Lance le Webview (mode dev)** : `npm run dev` (pour l’app Vite/React avec HMR)
4.  **Débugge l’extension** : Appuie sur `F5` dans VS Code (ou **Run** → **Start Debugging**) pour ouvrir une nouvelle fenêtre Extension Development Host avec Roo Code chargé.

Les changements dans le webview (`webview-ui`) apparaîtront immédiatement grâce au Hot Module Replacement. Les changements dans l’extension principale (`src`) nécessitent de redémarrer l’Extension Development Host.

Tu peux aussi construire et installer un paquet `.vsix` :

```sh
npm run build
code --install-extension bin/roo-cline-<version>.vsix
```

(Remplace `<version>` par le numéro de version réel du fichier généré).

### 2. Guide d’écriture du code

- **PRs ciblées** : Une fonctionnalité/correction par PR.
- **Qualité du code** :
    - Passer les checks CI (lint, formatage)
    - Corriger les avertissements ou erreurs ESLint (`npm run lint`)
    - Répondre au feedback des outils automatiques de revue de code
    - Suivre les bonnes pratiques TypeScript et maintenir la sécurité des types
- **Tests** :
    - Ajouter des tests pour les nouvelles fonctionnalités
    - Lancer `npm test` pour s’assurer que tout passe
    - Mettre à jour les tests existants si besoin
- **Messages de commit** :
    - Rédiger des messages clairs et descriptifs
    - Référencer les tickets concernés avec `#numéro-issue` (ex : `Fixes #123`)
- **Checklist avant de soumettre une PR** :
    - Rebaser ta branche sur le dernier `main` de l’upstream
    - Vérifier que le code compile (`npm run build`)
    - S’assurer que tous les tests passent (`npm test`)
    - Supprimer tout code de debug ou `console.log`

### 3. Soumettre du code : Processus de Pull Request (PR)

#### Pull Requests en brouillon

Utilise les PRs en brouillon pour du travail pas encore prêt pour une revue complète mais pour lequel tu veux :

- Lancer les checks automatiques (CI)
- Obtenir un feedback précoce des mainteneurs ou d’autres contributeurs
- Signaler que le travail est en cours

Marque une PR comme "Prête pour revue" seulement quand tous les checks passent et que tu penses qu’elle respecte les critères du "Guide d’écriture du code" et de la "Description de la Pull Request".

#### Description de la Pull Request

La description de ta PR doit être complète et suivre la structure de notre [Modèle de Pull Request](.github/pull_request_template.md). Points clés :

- Un lien vers le ticket GitHub approuvé concerné
- Une description claire des changements et de leur but
- Des étapes détaillées pour tester les changements
- Une liste de tout changement majeur (breaking change)
- **Pour les changements UI, fournis des captures d’écran ou vidéos avant/après**
- **Indique si ta PR nécessite une mise à jour de la doc utilisateur et quels documents/sections sont concernés**

#### Politique de Pull Request (PR)

##### Objectif

Maintenir un backlog de PR propre, ciblé et gérable.

##### Approche Issue-First

- **Obligatoire** : Avant de commencer, il doit exister un ticket GitHub approuvé et assigné (soit "Bug Report" soit "Detailed Feature Proposal").
- **Approbation** : Les tickets, surtout pour les changements importants, doivent être revus et approuvés par les mainteneurs (notamment @hannesrudolph) _avant_ de commencer à coder.
- **Référence** : Les PRs doivent référencer explicitement ces tickets pré-approuvés dans leur description.
- **Conséquences** : Ne pas suivre ce processus peut entraîner la fermeture de la PR sans revue complète.

##### Conditions pour les PR ouvertes

- **Prête à merger** : Passe tous les tests CI, s’aligne avec la feuille de route (si applicable), est liée à un ticket approuvé et assigné, a une doc/commentaires clairs, inclut des images/vidéos avant/après pour les changements UI
- **À fermer** : Échecs CI, conflits de merge importants, désalignement avec les objectifs du projet ou inactivité prolongée (>30 jours sans mise à jour après feedback)

##### Procédure

1.  **Qualification & assignation des tickets** : @hannesrudolph (ou d’autres mainteneurs) examinent et assignent les nouveaux tickets.
2.  **Triage initial des PRs (quotidien)** : Les mainteneurs font un premier tri rapide des PRs entrantes pour filtrer les urgences ou problèmes critiques.
3.  **Revue approfondie des PRs (hebdo)** : Les mainteneurs examinent en détail les PRs pour évaluer leur préparation, leur alignement avec le ticket approuvé et leur qualité globale.
4.  **Feedback détaillé & itération** : Selon la revue, les mainteneurs donnent un feedback (Approuver, Demander des changements, Rejeter). Les contributeurs doivent répondre et améliorer si besoin.
5.  **Décision** : Les PRs approuvées sont mergées. Les PRs avec des problèmes non résolus ou désalignées peuvent être fermées avec explication.
6.  **Suivi** : Les auteurs de PRs fermées peuvent corriger et ouvrir de nouvelles PRs si les problèmes sont résolus ou si la direction du projet change.

##### Responsabilités

- **Qualification des tickets & respect du process (@hannesrudolph & mainteneurs)** : S’assurer que toutes les contributions suivent l’approche Issue-First. Guider les contributeurs.
- **Mainteneurs (équipe dev)** : Revoir les PRs, donner un feedback technique, prendre les décisions d’approbation/rejet, merger les PRs.
- **Contributeurs** : S’assurer que les PRs sont liées à un ticket approuvé et assigné, respectent les guidelines de qualité et répondent rapidement au feedback.

Cette politique garantit clarté et intégration efficace.

## IV. Légal

### Accord de contribution

En soumettant une pull request, tu acceptes que tes contributions soient sous licence [Apache 2.0](LICENSE) (ou la licence actuelle du projet), comme le projet.
