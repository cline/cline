# Guide de référence des outils Cline

## Que peut faire Cline ?

Cline est votre assistant IA qui peut :

-   Éditer et créer des fichiers dans votre projet
-   Exécuter des commandes terminales
-   Rechercher et analyser votre code
-   Aider à déboguer et corriger des problèmes
-   Automatiser des tâches répétitives
-   S'intégrer avec des outils externes

## Premières étapes

1. **Démarrer une tâche**

    - Tapez votre demande dans le chat
    - Exemple : "Créer un nouveau composant React appelé Header"

2. **Fournir un contexte**

    - Utilisez des mentions @ pour ajouter des fichiers, des dossiers ou des URL
    - Exemple : "@file:src/components/App.tsx"

3. **Examiner les modifications**
    - Cline affichera les différences avant d'apporter des modifications
    - Vous pouvez modifier ou rejeter les changements

## Fonctionnalités clés

1. **Édition de fichiers**

    - Créer de nouveaux fichiers
    - Modifier le code existant
    - Rechercher et remplacer dans les fichiers

2. **Commandes terminales**

    - Exécuter des commandes npm
    - Démarrer des serveurs de développement
    - Installer des dépendances

3. **Analyse de code**

    - Trouver et corriger des erreurs
    - Refactoriser le code
    - Ajouter de la documentation

4. **Intégration au navigateur**
    - Tester des pages web
    - Capturer des captures d'écran
    - Inspecter les journaux de la console

## Outils disponibles

Pour les détails d'implémentation les plus à jour, vous pouvez consulter le code source complet dans le [dépôt Cline](https://github.com/cline/cline/blob/main/src/core/Cline.ts).

Cline a accès aux outils suivants pour diverses tâches :

1. **Opérations sur les fichiers**

    - `write_to_file` : Créer ou écraser des fichiers
    - `read_file` : Lire le contenu des fichiers
    - `replace_in_file` : Effectuer des modifications ciblées dans les fichiers
    - `search_files` : Rechercher des fichiers en utilisant des expressions régulières
    - `list_files` : Lister le contenu des répertoires

2. **Opérations terminales**

    - `execute_command` : Exécuter des commandes CLI
    - `list_code_definition_names` : Lister les définitions de code

3. **Outils MCP**

    - `use_mcp_tool` : Utiliser des outils des serveurs MCP
    - `access_mcp_resource` : Accéder aux ressources des serveurs MCP
    - Les utilisateurs peuvent créer des outils MCP personnalisés que Cline peut ensuite accéder
    - Exemple : Créer un outil API météo que Cline peut utiliser pour récupérer des prévisions

4. **Outils d'interaction**
    - `ask_followup_question` : Demander des clarifications à l'utilisateur
    - `attempt_completion` : Présenter les résultats finaux

Chaque outil a des paramètres et des modèles d'utilisation spécifiques. Voici quelques exemples :

-   Créer un nouveau fichier (write_to_file) :

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Code du composant Header
    </content>
    </write_to_file>
    ```

-   Rechercher un motif (search_files) :

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   Exécuter une commande (execute_command) :
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## Tâches courantes

1. **Créer un nouveau composant**

    - "Créer un nouveau composant React appelé Footer"

2. **Corriger un bogue**

    - "Corriger l'erreur dans src/utils/format.ts"

3. **Refactoriser le code**

    - "Refactoriser le composant Button pour utiliser TypeScript"

4. **Exécuter des commandes**
    - "Exécuter npm install pour ajouter axios"

## Obtenir de l'aide

-   [Rejoindre la communauté Discord](https://discord.gg/cline)
-   Consulter la documentation
-   Fournir des retours pour améliorer Cline