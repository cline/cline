# Construction de serveurs MCP à partir de dépôts GitHub

Ce guide fournit un walkthrough étape par étape sur la manière d'utiliser Cline pour construire un serveur MCP existant à partir d'un dépôt GitHub.

## **Recherche d'un serveur MCP**

Il existe plusieurs endroits en ligne pour trouver des serveurs MCP :

-   **Cline peut automatiquement ajouter des serveurs MCP à sa liste, que vous pouvez ensuite modifier.** Cline peut cloner des dépôts directement depuis GitHub et construire les serveurs pour vous.
-   **GitHub :** Deux des endroits les plus courants pour trouver des serveurs MCP sur GitHub incluent :
    -   [Dépôt officiel des serveurs MCP](https://github.com/modelcontextprotocol/servers)
    -   [Dépôt Awesome-MCP servers](https://github.com/punkpeye/awesome-mcp-servers)
-   **Répertoires en ligne :** Plusieurs sites Web listent des serveurs MCP, y compris :

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    Ces répertoires permettent aux utilisateurs de trier les serveurs selon divers critères tels que les téléchargements, la date, les étoiles et le cas d'utilisation. Chaque entrée fournit des informations telles que les fonctionnalités, les outils et les instructions de configuration.

-   **PulseMCP :** Ce site Web a un article de blog discutant de la manière dont l'IA pourrait utiliser des serveurs MCP pour rendre les sites Web obsolètes. PulseMCP inclut également une section FAQ sur les serveurs MCP : [https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **Construction avec Cline**

1.  **Initier le processus :** Fournissez à Cline les informations suivantes :
    -   **URL du dépôt GitHub :** L'URL du dépôt du serveur.
    -   **Contenu de README.md :** Ceci est facultatif mais utile pour que Cline comprenne le but et la configuration du serveur. Vous pouvez copier le fichier README.md du dépôt GitHub.
2.  **Exemple d'interaction avec Cline :**

    ```
    Utilisateur : "Cline, je veux ajouter le serveur MCP pour le contrôle du navigateur Brave. Voici le lien GitHub : https://github.com/modelcontextprotocol/servers/tree/main/src/brave Pouvez-vous l'ajouter ?"

    Cline : "OK. Clonage du dépôt dans le répertoire MCP. Il doit être construit car il contient un fichier 'package.json'. Dois-je exécuter 'npm run build' ?"

    Utilisateur : "Oui, construisez-le."

    Cline : "Construction terminée. Ce serveur a besoin d'un chemin de navigateur. Où se trouve votre exécutable Brave Browser ?"

    Utilisateur : "Il est dans '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'."

    Cline : "OK. J'ai mis à jour la configuration du serveur avec ce chemin et l'ai ajouté à 'cline_mcp_settings.json'. Autre chose ?"

    Utilisateur : "Non, c'est tout. Testons-le."

    Cline : "Super ! Lancement de l'inspecteur MCP pour tester la connexion au serveur. Après cela, nous pourrons essayer de contrôler le navigateur depuis Cline."
    ```
3. **Actions de Cline :** Selon vos instructions, Cline effectuera les actions suivantes :
    - **Clonage du dépôt :** Cline clonera le dépôt sur votre machine locale, généralement dans le répertoire spécifié dans votre configuration.
    - **Ajustements :** Vous pouvez guider Cline pour modifier la configuration du serveur. Par exemple :
        - **Utilisateur :** "Ce serveur nécessite une clé API. Pouvez-vous trouver où elle doit être ajoutée ?"
        - Cline peut automatiquement mettre à jour le fichier `cline_mcp_settings.json` ou d'autres fichiers pertinents selon vos instructions.
    - **Construction du serveur :** Cline exécutera la commande de construction appropriée pour le serveur, qui est généralement `npm run build`.
    - **Ajout du serveur aux paramètres :** Cline ajoutera la configuration du serveur au fichier `cline_mcp_settings.json`.

## **Test et dépannage**

1. **Test du serveur :** Une fois que Cline a terminé le processus de construction, testez le serveur pour vous assurer qu'il fonctionne comme prévu. Cline peut vous aider si vous rencontrez des problèmes.
2. **Inspecteur MCP :** Vous pouvez utiliser l'Inspecteur MCP pour tester la connexion et la fonctionnalité du serveur.

## **Bonnes pratiques**

- **Comprendre les bases :** Bien que Cline simplifie le processus, il est bénéfique d'avoir une compréhension de base du code du serveur, du protocole MCP () et de la manière de configurer le serveur. Cela permet un dépannage et une personnalisation plus efficaces.
- **Instructions claires :** Fournissez des instructions claires et spécifiques à Cline tout au long du processus.
- **Test :** Testez minutieusement le serveur après l'installation et la configuration pour vous assurer qu'il fonctionne correctement.
- **Contrôle de version :** Utilisez un système de contrôle de version (comme Git) pour suivre les modifications apportées au code du serveur.
- **Restez à jour :** Gardez vos serveurs MCP à jour pour bénéficier des dernières fonctionnalités et des correctifs de sécurité.