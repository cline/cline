# Cline – \#1 sur OpenRouter

<p align="center">
        <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Télécharger sur VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Demandes de fonctionnalités</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>Nous recrutons !</strong></a>
</td>
</tbody>
</table>
</div>

Découvrez Cline, un assistant IA capable d’utiliser votre **CLI** et votre **Éditeur**.

Grâce aux [capacités de codage agentique de Claude 3.5 Sonnet](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf), Cline peut gérer des tâches complexes de développement logiciel étape par étape. Avec des outils lui permettant de créer et modifier des fichiers, d’explorer de grands projets, d’utiliser le navigateur et d’exécuter des commandes Terminal (avec votre autorisation), Cline vous assiste bien au-delà de la simple complétion de code ou du support technique. Il peut même utiliser le Model Context Protocol (MCP) pour créer de nouveaux outils et étendre ses propres capacités. Alors que les scripts IA autonomes fonctionnent traditionnellement dans des environnements isolés, cette extension offre une interface homme-dans-la-boucle permettant d’approuver chaque modification de fichier et chaque commande Terminal, offrant ainsi une manière sécurisée et accessible d’explorer le potentiel de l’IA agentique.

1. Saisissez votre tâche et ajoutez des images pour convertir des maquettes en applications fonctionnelles ou corriger des erreurs avec des captures d’écran.
2. Cline analyse la structure de vos fichiers et les ASTs du code source, effectue des recherches Regex et lit les fichiers pertinents pour s’orienter dans votre projet existant. Grâce à une gestion optimisée des informations, il offre une assistance précieuse même pour les projets complexes sans surcharger la fenêtre de contexte.
3. Une fois les informations collectées, Cline peut :
   - Créer et modifier des fichiers tout en surveillant les erreurs de Linter/compilateur afin de corriger proactivement des problèmes comme les imports manquants et les erreurs de syntaxe.
   - Exécuter des commandes directement dans votre Terminal et surveiller leur sortie pour répondre, par exemple, aux problèmes du serveur de développement après modification d’un fichier.
   - Pour le développement web, il peut lancer votre site dans un navigateur headless, cliquer, taper, faire défiler et capturer des captures d’écran ainsi que les logs console, lui permettant de corriger les erreurs d’exécution et les problèmes visuels.
4. Une fois la tâche terminée, Cline présente le résultat avec une commande Terminal comme `open -a "Google Chrome" index.html`, que vous pouvez exécuter d’un simple clic.

> [!ASTUCE]
> Utilisez le raccourci `CMD/CTRL + Shift + P` pour ouvrir la palette de commandes et tapez "Cline: Open In New Tab" pour ouvrir l’extension dans un nouvel onglet de votre éditeur. Vous pourrez ainsi voir Cline interagir avec votre espace de travail tout en ayant accès à votre explorateur de fichiers.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Utilisez n'importe quelle API et modèle

Cline prend en charge des fournisseurs d’API tels qu’OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure et GCP Vertex. Vous pouvez également configurer toute API compatible avec OpenAI ou utiliser un modèle local via LM Studio/Ollama. Si vous utilisez OpenRouter, l’extension récupère automatiquement la dernière liste de modèles disponibles.

Elle suit également l’utilisation des tokens et les coûts d’API pour chaque cycle de tâche et chaque requête, afin que vous soyez informé des dépenses à chaque étape.

---

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Exécuter des commandes Terminal

Avec la nouvelle [API d’intégration Shell de VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Cline peut exécuter des commandes directement dans votre Terminal et surveiller leur sortie. Il peut ainsi gérer des tâches variées, de l’installation de paquets au déploiement d’applications en passant par la gestion de bases de données et l’exécution de tests.

---

### Créer et modifier des fichiers

Cline peut directement créer et modifier des fichiers dans votre éditeur et afficher une vue diff des changements. Vous pouvez modifier ses suggestions, annuler des modifications ou donner votre avis en chat jusqu’à obtenir un résultat satisfaisant.

---

### Utiliser le navigateur

Avec la nouvelle capacité [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) de Claude 3.5 Sonnet, Cline peut lancer un navigateur, interagir avec des éléments, capturer des captures d’écran et récupérer des logs console, ce qui permet le débogage interactif et les tests de bout en bout.

---

### Ajouter des outils personnalisés

Grâce au [Model Context Protocol](https://github.com/modelcontextprotocol), Cline peut étendre ses capacités avec des outils personnalisés. Il peut créer et installer des outils adaptés à votre workflow en fonction de vos demandes.

---

### Ajouter du contexte

**`@url`** : Ajoutez une URL pour que l’extension la récupère et la convertisse en Markdown, utile pour donner à Cline les dernières documentations.

**`@problems`** : Ajoutez les erreurs et avertissements du projet à résoudre.

**`@file`** : Ajoutez le contenu d’un fichier pour éviter de gaspiller des requêtes API.

**`@folder`** : Ajoutez les fichiers d’un dossier d’un seul coup pour accélérer votre workflow.

---

### Checkpoints : comparer et restaurer

Pendant qu’il travaille, Cline prend des instantanés de votre espace de travail. Vous pouvez comparer ces checkpoints avec votre état actuel et restaurer les versions précédentes si nécessaire.

---

## Contribuer

Pour contribuer au projet, commencez par consulter notre [Guide de contribution](CONTRIBUTING.md). Vous pouvez aussi rejoindre notre [Discord](https://discord.gg/cline) pour échanger avec d’autres contributeurs dans le canal `#contributors`. Si vous cherchez un emploi à temps plein, consultez nos offres sur notre [page carrière](https://cline.bot/join-us) !

<details>
<summary>Instructions de développement local</summary>

1. Clonez le dépôt _(nécessite [git-lfs](https://git-lfs.com/))_ :
   ```bash
   git clone https://github.com/cline/cline.git
   ```
2. Ouvrez le projet dans VSCode :
   ```bash
   code cline
   ```
3. Installez les dépendances nécessaires pour l'extension et l'interface Webview :
   ```bash
   npm run install:all
    ```   
4. Lancez l’extension en appuyant sur F5 (ou via Run -> Start Debugging).
   Vous pourriez avoir besoin d’installer [l’extension esbuild problem matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) si des erreurs de build apparaissent.

</details>

## Lizenz

[Apache 2.0 © 2024 Cline Bot Inc.](./LICENSE)
