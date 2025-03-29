# Débuter avec Cline | Nouveaux codeurs

Bienvenue sur Cline ! Ce guide vous aidera à vous installer et à commencer à utiliser Cline pour construire votre premier projet.

## Ce dont vous aurez besoin

Avant de commencer, assurez-vous d'avoir les éléments suivants :

-   **VS Code :** Un éditeur de code gratuit et puissant.
    -   [Télécharger VS Code](https://code.visualstudio.com/)
-   **Outils de développement :** Logiciels essentiels pour coder (Homebrew, Node.js, Git, etc.).
    -   Suivez notre guide [Installation des outils de développement essentiels](installing-dev-essentials.md) pour les configurer avec l'aide de Cline (après vous être installé ici)
    -   Cline vous guidera à travers l'installation de tout ce dont vous avez besoin
-   **Dossier des projets Cline :** Un dossier dédié pour tous vos projets Cline.
    -   Sur macOS : Créez un dossier nommé "Cline" dans votre dossier Documents
        -   Chemin : `/Users/[votre-nom-d'utilisateur]/Documents/Cline`
    -   Sur Windows : Créez un dossier nommé "Cline" dans votre dossier Documents
        -   Chemin : `C:\Users\[votre-nom-d'utilisateur]\Documents\Cline`
    -   À l'intérieur de ce dossier Cline, créez des dossiers séparés pour chaque projet
        -   Exemple : `Documents/Cline/application-entrainement` pour une application de suivi d'entraînement
        -   Exemple : `Documents/Cline/site-portfolio` pour votre portfolio
-   **Extension Cline dans VS Code :** L'extension Cline installée dans VS Code.

-   Voici un [tutoriel](https://www.youtube.com/watch?v=N4td-fKhsOQ) sur tout ce dont vous avez besoin pour commencer.

## Configuration étape par étape

Suivez ces étapes pour mettre Cline en marche :

1. **Ouvrir VS Code :** Lancez l'application VS Code. Si VS Code affiche "L'exécution des extensions pourrait...", cliquez sur "Autoriser".

2. **Ouvrir votre dossier Cline :** Dans VS Code, ouvrez le dossier Cline que vous avez créé dans Documents.

3. **Accéder aux extensions :** Cliquez sur l'icône des extensions dans la barre d'activité sur le côté de VS Code.

4. **Rechercher 'Cline' :** Dans la barre de recherche des extensions, tapez "Cline".

5. **Installer l'extension :** Cliquez sur le bouton "Installer" à côté de l'extension Cline.

6. **Ouvrir Cline :** Une fois installé, vous pouvez ouvrir Cline de plusieurs façons :
    - Cliquez sur l'icône Cline dans la barre d'activité.
    - Utilisez la palette de commandes (`CMD/CTRL + Maj + P`) et tapez "Cline : Ouvrir dans un nouvel onglet" pour ouvrir Cline comme un onglet dans votre éditeur. C'est recommandé pour une meilleure vue.
    - **Dépannage :** Si vous ne voyez pas l'icône Cline, essayez de redémarrer VS Code.
    - **Ce que vous verrez :** Vous devriez voir apparaître la fenêtre de chat Cline dans votre éditeur VS Code.

![gettingStartedVsCodeCline](https://github.com/user-attachments/assets/622b4bb7-859b-4c2e-b87b-c12e3eabefb8)

## Configuration de la clé API OpenRouter

Maintenant que vous avez installé Cline, vous devrez configurer votre clé API OpenRouter pour utiliser toutes les capacités de Cline.
1. **Obtenez votre clé API OpenRouter :**
    - [Obtenez votre clé API OpenRouter](https://openrouter.ai/)
2. **Entrez votre clé API OpenRouter :**
    - Accédez au bouton des paramètres dans l'extension Cline.
    - Entrez votre clé API OpenRouter.
    - Sélectionnez votre modèle API préféré.
        - **Modèles recommandés pour le codage :**
            - `anthropic/claude-3.5-sonnet` : Le plus utilisé pour les tâches de codage.
            - `google/gemini-2.0-flash-exp:free` : Une option gratuite pour le codage.
            - `deepseek/deepseek-chat` : SUPER BON MARCHÉ, presque aussi bon que 3.5 sonnet
        - [Classements des modèles OpenRouter](https://openrouter.ai/rankings/programming)

## Votre première interaction avec Cline

Vous êtes maintenant prêt à commencer à construire avec Cline. Créons votre premier dossier de projet et construisons quelque chose ! Copiez et collez la demande suivante dans la fenêtre de chat de Cline :

```
Hey Cline ! Pourriez-vous m'aider à créer un nouveau dossier de projet appelé "hello-world" dans mon répertoire Cline et à créer une page web simple qui dit "Bonjour le monde" en texte bleu grand ?
```

**Ce que vous verrez :** Cline vous aidera à créer le dossier de projet et à configurer votre première page web.

## Conseils pour travailler avec Cline

- **Posez des questions :** Si vous avez des doutes sur quelque chose, n'hésitez pas à demander à Cline !
- **Utilisez des captures d'écran :** Cline peut comprendre les images, alors n'hésitez pas à utiliser des captures d'écran pour lui montrer sur quoi vous travaillez.
- **Copiez et collez les erreurs :** Si vous rencontrez des erreurs, copiez et collez les messages d'erreur dans le chat de Cline. Cela l'aidera à comprendre le problème et à fournir une solution.
- **Parlez simplement :** Cline est conçu pour comprendre un langage simple et non technique. N'hésitez pas à décrire vos idées avec vos propres mots, et Cline les traduira en code.

## FAQ

- **Qu'est-ce que le terminal ?** Le terminal est une interface basée sur du texte pour interagir avec votre ordinateur. Il vous permet d'exécuter des commandes pour effectuer diverses tâches, comme installer des paquets, exécuter des scripts et gérer des fichiers. Cline utilise le terminal pour exécuter des commandes et interagir avec votre environnement de développement.
- **Comment fonctionne la base de code ?** (Cette section sera élargie en fonction des questions courantes des nouveaux codeurs)

## Toujours en difficulté ?

N'hésitez pas à me contacter, et je vous aiderai à démarrer avec Cline.

nick | 608-558-2410

Rejoignez notre communauté Discord : [https://discord.gg/cline](https://discord.gg/cline)