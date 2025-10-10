<div align="center"><sub>
Français | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/ko/README.md" target="_blank">한국어</a>
</sub></div>

# Cline – #1 sur OpenRouter

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
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Demandes de Fonctionnalités</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/for-new-coders" target="_blank"><strong>Premiers Pas</strong></a>
</td>
</tbody>
</table>
</div>

Découvrez Cline, un assistant IA qui peut utiliser votre **CLI** et **ÉDITEUR**.

Grâce aux capacités agentiques de **Claude Sonnet**, Cline peut gérer des tâches de développement logiciel complexes étape par étape. Avec des outils qui lui permettent de créer et d'éditer des fichiers, d'explorer de grands projets, d'utiliser le navigateur et d'exécuter des commandes dans le terminal (après avoir obtenu votre autorisation), il peut vous aider de façons qui dépassent le complétion de code ou le support technique. Cline peut même utiliser le Model Context Protocol (MCP) pour créer de nouveaux outils et étendre ses propres capacités. Bien que les scripts IA autonomes fonctionnent traditionnellement dans des environnements sandboxés, cette extension fournit une interface graphique humaine pour approuver chaque modification de fichier et chaque commande de terminal, fournissant ainsi un moyen sûr et accessible pour explorer le potentiel de l'IA agente.

1. Entrez votre tâche et ajoutez des images pour convertir des maquettes en applications fonctionnelles ou corriger des bugs avec des captures d'écran.
2. Cline commence par analyser votre structure de fichiers et les AST du code source, exécuter des recherches regex et lire les fichiers pertinents pour se familiariser avec les projets existants. En gérant soigneusement les informations ajoutées au contexte, Cline peut fournir une assistance précieuse même pour les projets volumineux et complexes sans surcharger la fenêtre de contexte.
3. Une fois que Cline a les informations dont il a besoin, il peut :
    - Créer et modifier des fichiers + surveiller les erreurs de linter/compilateur au fur et à mesure, lui permettant de corriger proactivement les problèmes comme les importations manquantes et les erreurs de syntaxe.
    - Exécuter des commandes directement dans votre terminal et surveiller leur sortie pendant qu'il travaille, lui permettant par exemple de réagir aux problèmes du serveur de développement après avoir modifié un fichier.
    - Pour les tâches de développement web, Cline peut lancer le site dans un navigateur headless, cliquer, taper, faire défiler, et capturer des captures d'écran + les journaux de la console, permettant de corriger les erreurs d'exécution et les bugs visuels.
4. Lorsqu'une tâche est terminée, Cline présentera le résultat avec une commande de terminal comme `open -a "Google Chrome" index.html`, que vous exécuterez en cliquant sur un bouton.

> [!TIP]
> Utilisez le raccourci `CMD/CTRL + Shift + P` pour ouvrir la palette de commandes et tapez "Cline: Open In New Tab" pour ouvrir l'extension sous forme d'onglet dans votre éditeur. Cela vous permet d'utiliser Cline côte à côte avec votre explorateur de fichiers, et de voir clairement comment il modifie votre espace de travail.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Utilisez n'importe quelle API et Modèle

Cline supporte les fournisseurs d'API comme OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras et Groq. Vous pouvez également configurer n'importe quelle API compatible OpenAI, ou utiliser un modèle local via LM Studio/Ollama. Si vous utilisez OpenRouter, l'extension récupère leur dernière liste de modèles, vous permettant d'utiliser les nouveaux modèles dès leur disponibilité.

L'extension suit également le nombre total de tokens et le coût d'utilisation de l'API pour l'ensemble de la boucle de tâche et les requêtes individuelles, vous informant de la dépense à chaque étape.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Exécutez des Commandes dans le Terminal

Grâce aux nouvelles [mises à jour d'intégration shell dans VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Cline peut exécuter des commandes directement dans votre terminal et recevoir la sortie. Cela lui permet d'effectuer une large gamme de tâches, depuis l'installation de packages et l'exécution de scripts de build jusqu au déploiement d'applications, à la gestion de bases de données et à l'exécution de tests, tout en s'adaptant à votre environnement de développement et à votre chaîne d'outils pour accomplir le travail correctement.

Pour les processus longs comme les serveurs de développement, utilisez le bouton "Continuer Pendant l'Exécution" pour permettre à Cline de continuer la tâche pendant que la commande s'exécute en arrière-plan. Pendant que Cline travaille, il sera informé de toute nouvelle sortie du terminal, lui permettant de réagir aux problèmes qui peuvent survenir, comme les erreurs de compilation lors de l'édition de fichiers.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Créez et Modifiez des Fichiers

Cline peut créer et modifier des fichiers directement dans votre éditeur, vous présentant une vue de différences des modifications. Vous pouvez modifier ou annuler les modifications de Cline directement dans l'éditeur de vue de différences, ou fournir des commentaires dans le chat jusqu'à ce que vous soyez satisfait du résultat. Cline surveille également les erreurs de linter/compilateur (importations manquantes, erreurs de syntaxe, etc.) afin qu'il puisse corriger les problèmes qui surviennent au fur et à mesure.

Toutes les modifications apportées par Cline sont enregistrées dans la chronologie de votre fichier, fournissant un moyen facile de suivre et d'annuler les modifications si nécessaire.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Utilisez le Navigateur

Avec la nouvelle capacité [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) de Claude Sonnet, Cline peut lancer un navigateur, cliquer sur des éléments, taper du texte et faire défiler, capturer des captures d'écran et les journaux de la console à chaque étape. Cela permet un débogage interactif, des tests de bout en bout et même une utilisation générale du web ! Cela lui donne l'autonomie de corriger les bugs visuels et les problèmes d'exécution sans que vous n'ayez besoin de vous pencher sur eux et de copier-coller les journaux d'erreur vous-même.

Essayez de demander à Cline de "tester l'application", et regardez comme il exécute une commande comme `npm run dev`, lance votre serveur de développement local dans un navigateur, et effectue une série de tests pour confirmer que tout fonctionne. [Voir une démo ici.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "ajoutez un outil qui..."

Grâce au [Model Context Protocol](https://github.com/modelcontextprotocol), Cline peut étendre ses capacités grâce à des outils personnalisés. Bien que vous puissiez utiliser [des serveurs créés par la communauté](https://github.com/modelcontextprotocol/servers), Cline peut plutôt créer et installer des outils adaptés à votre flux de travail spécifique. Il vous suffit de demander à Cline de "ajouter un outil" et il s'occupera de tout, depuis la création d'un nouveau serveur MCP jusqu'à son installation dans l'extension. Ces outils personnalisés deviennent alors partie intégrante de l'outil de Cline, prêts à être utilisés dans les tâches futures.

-   "ajoutez un outil qui récupère les tickets Jira" : Récupérez les exigences des tickets et mettez Cline au travail
-   "ajoutez un outil qui gère les EC2 AWS" : Vérifiez les métriques du serveur et augmentez ou diminuez les instances
-   "ajoutez un outil qui récupère les incidents PagerDuty" : Récupérez les détails et demandez à Cline de corriger des bugs

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Ajoutez du Contexte

**`@url`:** Coller un URL pour que l'extension le récupère et le convertisse en markdown, utile lorsque vous voulez donner à Cline les derniers documents

**`@problems`:** Ajoutez les erreurs et avertissements de l'espace de travail (panneau "Problèmes") pour que Cline les corrige

**`@file`:** Ajoute le contenu d'un fichier pour que vous n'ayez pas à gaspiller des requêtes API en approuvant la lecture de fichiers (+ tapez pour rechercher des fichiers)

**`@folder`:** Ajoute les fichiers d'un dossier en une seule fois pour accélérer davantage votre workflow

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### Points de Contrôle : Comparer et Restaurer

Pendant que Cline travaille sur une tâche, l'extension prend un instantané de votre espace de travail à chaque étape. Vous pouvez utiliser le bouton 'Comparer' pour voir une différence entre l'instantané et votre espace de travail actuel, et le bouton 'Restaurer' pour revenir à ce point.

Par exemple, lors du travail avec un serveur web local, vous pouvez utiliser 'Restaurer l'Espace de Travail Seulement' pour tester rapidement différentes versions de votre application, puis utiliser 'Restaurer la Tâche et l'Espace de Travail' lorsque vous trouvez la version à laquelle continuer à construire. Cela vous permet d'explorer en toute sécurité différentes approches sans perdre votre progression.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Contribution

Pour contribuer au projet, commencez par notre [Guide de Contribution](CONTRIBUTING.md) pour apprendre les bases. Vous pouvez également rejoindre notre [Discord](https://discord.gg/cline) pour discuter avec d'autres contributeurs dans le canal `#contributors`. Si vous recherchez un travail à temps plein, consultez nos postes ouverts sur notre [page carrière](https://cline.bot/join-us) !

## Licence

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
