# Installation des outils de développement essentiels avec Cline | Nouveaux codeurs

Lorsque vous commencez à coder, vous aurez besoin d'installer certains outils de développement essentiels sur votre ordinateur. Cline peut vous aider à installer tout ce dont vous avez besoin de manière sûre et guidée.

## Les outils essentiels

Voici les outils de base dont vous aurez besoin pour le développement :

-   **Homebrew** : Un gestionnaire de paquets pour macOS qui facilite l'installation d'autres outils
-   **Node.js & npm** : Nécessaires pour le développement JavaScript et web
-   **Git** : Pour suivre les modifications de votre code et collaborer avec d'autres
-   **Python** : Un langage de programmation utilisé par de nombreux outils de développement
-   **Utilitaires supplémentaires** : Des outils comme wget et jq qui aident à télécharger des fichiers et à traiter des données

## Laissez Cline installer tout

Copiez cette invite et collez-la dans Cline :

```bash
Bonjour Cline ! J'ai besoin d'aide pour configurer mon Mac pour le développement logiciel. Pourriez-vous m'aider à installer les outils de développement essentiels comme Homebrew, Node.js, Git, Python, et tout autre utilitaire couramment nécessaire pour coder ? J'aimerais que vous me guidiez à travers le processus étape par étape, en expliquant ce que fait chaque outil et en vous assurant que tout est installé correctement.
```

## Ce qui va se passer

1. Cline installera d'abord Homebrew, qui est comme un "app store" pour les outils de développement
2. En utilisant Homebrew, Cline installera ensuite d'autres outils essentiels comme Node.js et Git
3. Pour chaque étape d'installation :
    - Cline vous montrera la commande exacte qu'il souhaite exécuter
    - Vous devrez approuver chaque commande avant son exécution
    - Cline vérifiera que chaque installation a été réussie

## Pourquoi ces outils sont importants

-   **Homebrew** : Facilite l'installation et la mise à jour des outils de développement sur votre Mac
-   **Node.js & npm** : Nécessaires pour :
    -   Construire des sites web avec React ou Next.js
    -   Exécuter du code JavaScript
    -   Installer des paquets JavaScript
-   **Git** : Vous aide à :
    -   Sauvegarder différentes versions de votre code
    -   Collaborer avec d'autres développeurs
    -   Sauvegarder votre travail
-   **Python** : Utilisé pour :
    -   Exécuter des scripts de développement
    -   Traiter des données
    -   Des projets de machine learning

## Notes

-   Le processus d'installation est interactif - Cline vous guidera à travers chaque étape
-   Vous devrez peut-être entrer le mot de passe de votre ordinateur pour certaines installations. Lorsqu'on vous le demande, vous ne verrez aucun caractère s'afficher à l'écran. C'est normal et c'est une fonction de sécurité pour protéger votre mot de passe. Tapez simplement votre mot de passe et appuyez sur Entrée.

**Exemple :**

```bash
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Mot de passe :
```

_Tapez votre mot de passe ici, même si rien ne s'affichera à l'écran. Appuyez sur Entrée quand vous avez terminé._

-   Toutes les commandes vous seront montrées pour approbation avant leur exécution
-   Si vous rencontrez des problèmes, Cline vous aidera à les résoudre

## Conseils supplémentaires pour les nouveaux codeurs

### Comprendre le terminal

Le **Terminal** est une application où vous pouvez taper des commandes pour interagir avec votre ordinateur. Sur macOS, vous pouvez l'ouvrir en cherchant "Terminal" dans Spotlight.

**Exemple :**

```bash
$ open -a Terminal
```

### Comprendre les fonctionnalités de VS Code

#### Terminal dans VS Code

Le **Terminal** dans VS Code vous permet d'exécuter des commandes directement depuis l'éditeur. Vous pouvez l'ouvrir en allant dans `Affichage > Terminal` ou en appuyant sur `` Ctrl + ` ``.

**Exemple :**

```bash
$ node -v
v16.14.0
```

#### Vue du document
La **vue du document** est l'endroit où vous éditez vos fichiers de code. Vous pouvez ouvrir des fichiers en cliquant sur eux dans le panneau **Explorateur** sur le côté gauche de l'écran.

#### Section Problèmes

La section **Problèmes** dans VS Code montre toutes les erreurs ou avertissements dans votre code. Vous pouvez y accéder en cliquant sur l'icône de l'ampoule ou en allant dans `Affichage > Problèmes`.

### Fonctionnalités courantes

-   **Interface de ligne de commande (CLI)** : Il s'agit d'une interface basée sur du texte où vous tapez des commandes pour interagir avec votre ordinateur. Cela peut sembler intimidant au début, mais c'est un outil puissant pour les développeurs.
-   **Permissions** : Parfois, vous devrez accorder des permissions à certaines applications ou commandes. C'est une mesure de sécurité pour s'assurer que seules les applications de confiance peuvent apporter des modifications à votre système.

## Étapes suivantes

Après avoir installé ces outils, vous serez prêt à commencer à coder ! Retournez au guide [Débuter avec Cline pour les nouveaux codeurs](../getting-started-new-coders/README.md) pour continuer votre parcours.