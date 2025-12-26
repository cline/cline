# Contribution à Cline

Nous sommes ravis que vous soyez intéressé par la contribution à Cline. Que vous corrigiez un bug, ajoutiez une fonctionnalité ou amélioriez notre documentation, chaque contribution rend Cline plus intelligent ! Pour maintenir une communauté vibrante et accueillante, tous les membres doivent respecter notre [Code de Conduite](CODE_OF_CONDUCT.md).

## Signalement des Bugs ou Problèmes

Les rapports de bugs aident à rendre Cline meilleur pour tout le monde ! Avant de créer un nouveau problème, veuillez [rechercher les problèmes existants](https://github.com/cline/cline/issues) pour éviter les doublons. Lorsque vous êtes prêt à signaler un bug, rendez-vous sur notre [page des problèmes](https://github.com/cline/cline/issues/new/choose) où vous trouverez un modèle pour vous aider à remplir les informations pertinentes.

<blockquote class='warning-note'>
     🔐 <b>Important :</b> Si vous découvrez une vulnérabilité de sécurité, veuillez utiliser l'<a href="https://github.com/cline/cline/security/advisories/new">outil de sécurité Github pour le signaler de manière privée</a>.
</blockquote>


## Avant de Contribuer

Toutes les contributions doivent commencer par un problème GitHub, sauf pour les corrections de bugs mineurs, les corrections de fautes de frappe, les améliorations mineures de formulation ou les corrections de types simples qui ne changent pas la fonctionnalité.
**Pour les fonctionnalités et les contributions** :
- Vérifiez d'abord le [tableau des Demandes de Fonctionnalités](https://github.com/cline/cline/discussions/categories/feature-requests) pour des idées similaires
- Si votre idée est nouvelle, créez une nouvelle demande de fonctionnalité  
- Attendez l'approbation des mainteneurs principaux avant de commencer l'implémentation
- Une fois approuvé, vous pouvez commencer à travailler sur une PR avec l'aide de notre communauté !

**Les PR sans problèmes approuvés peuvent être fermées.**


## Déterminer ce sur quoi Travailler

Vous cherchez une bonne première contribution ? Consultez les problèmes étiquetés ["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue) ou ["help wanted"](https://github.com/cline/cline/labels/help%20wanted). Ces problèmes sont spécifiquement sélectionnés pour les nouveaux contributeurs et sont des zones où nous aimerions beaucoup d'aide !

Nous accueillons également les contributions à notre [documentation](https://github.com/cline/cline/tree/main/docs) ! Que ce soit pour corriger des fautes de frappe, améliorer les guides existants ou créer du contenu éducatif - nous aimerions construire un dépôt de ressources piloté par la communauté qui aide tout le monde à tirer le meilleur parti de Cline. Vous pouvez commencer en plongeant dans `/docs` et en regardant les zones qui ont besoin d'amélioration.

## Configuration du Développement


### Instructions de Développement Local

1. Clonez le dépôt _(Nécessite [git-lfs](https://git-lfs.com/))_ :
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. Ouvrez le projet dans VSCode :
    ```bash
    code cline
    ```
3. Installez les dépendances nécessaires pour l'extension et l'interface utilisateur webview :
    ```bash
    npm run install:all
    ```
4. Lancez en appuyant sur `F5` (ou `Run`->`Start Debugging`) pour ouvrir une nouvelle fenêtre VSCode avec l'extension chargée. (Vous devrez peut-être installer l'[extension des correspondances de problèmes esbuild](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) si vous rencontrez des problèmes de construction du projet.)




### Création d'une Pull Request

1. Avant de créer une PR, générez une entrée de changeset :
    ```bash
    npm run changeset
    ```
   Cela vous invitera à :
   - Type de changement (majeur, mineur, correctif)
     - `majeur` → changements cassants (1.0.0 → 2.0.0)
     - `mineur` → nouvelles fonctionnalités (1.0.0 → 1.1.0)
     - `correctif` → corrections de bugs (1.0.0 → 1.0.1)
   - Description de vos changements

2. Committez vos changements et le fichier `.changeset` généré

3. Poussez votre branche et créez une PR sur GitHub. Notre CI :
   - Exécute les tests et les vérifications
   - Changesetbot créera un commentaire montrant l'impact sur la version
   - Lorsqu'elle est fusionnée dans main, changesetbot créera une PR de Version Packages
   - Lorsque la PR Version Packages est fusionnée, une nouvelle version sera publiée
4. Tests
    - Exécutez `npm run test` pour exécuter les tests localement. 
    - Avant de soumettre une PR, exécutez `npm run format:fix` pour formater votre code

### Extension

1. **Extensions VS Code**

    - Lors de l'ouverture du projet, VS Code vous invitera à installer les extensions recommandées
    - Ces extensions sont requises pour le développement - veuillez accepter toutes les invitations d'installation
    - Si vous avez ignoré les invites, vous pouvez les installer manuellement depuis le panneau Extensions

2. **Développement Local**
    - Exécutez `npm run install:all` pour installer les dépendances
    - Exécutez `npm run test` pour exécuter les tests localement
    - Run → Start Debugging ou `>Debug: Select and Start Debugging` et attendez qu'une nouvelle instance VS Code s'ouvre
    - Avant de soumettre une PR, exécutez `npm run format:fix` pour formater votre code

3. **Configuration spécifique à Linux**
    Les tests d'extensions VS Code sur Linux nécessitent les bibliothèques système suivantes :

    - `dbus`
    - `libasound2`
    - `libatk-bridge2.0-0`
    - `libatk1.0-0`
    - `libdrm2`
    - `libgbm1`
    - `libgtk-3-0`
    - `libnss3`
    - `libx11-xcb1`
    - `libxcomposite1`
    - `libxdamage1`
    - `libxfixes3`
    - `libxkbfile1`
    - `libxrandr2`
    - `xvfb`

    Ces bibliothèques fournissent les composants graphiques et les services système nécessaires pour l'environnement de test.

    Par exemple, sur les distributions basées sur Debian (ex : Ubuntu), vous pouvez installer ces bibliothèques en utilisant apt :
    ```bash
    sudo apt update
    sudo apt install -y \
      dbus \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbfile1 \
      libxrandr2 \
      xvfb
    ```

## Écriture et Soumission de Code

N'importe qui peut contribuer du code à Cline, mais nous vous demandons de suivre ces directives pour garantir que vos contributions puissent être intégrées sans problème :

1. **Gardez les Pull Requests Concentrées**

    - Limitez les PR à une seule fonctionnalité ou correction de bug
    - Divisez les changements importants en PR plus petites et liées
    - Divisez les changements en commits logiques qui peuvent être examinés indépendamment

2. **Qualité du Code**

    - Exécutez `npm run lint` pour vérifier le style du code
    - Exécutez `npm run format` pour formater automatiquement le code
    - Toutes les PR doivent passer les vérifications CI qui incluent à la fois le linting et le formatage
    - Corrigez tous les avertissements ou erreurs du linter avant de soumettre
    - Suivez les meilleures pratiques TypeScript et maintenez la sécurité de type

3. **Tests**

    - Ajoutez des tests pour les nouvelles fonctionnalités
    - Exécutez `npm test` pour vous assurer que tous les tests passent
    - Mettez à jour les tests existants si vos changements les affectent
    - Incluez à la fois des tests unitaires et des tests d'intégration lorsque cela est approprié

    **Tests de Bout en Bout (E2E)**
    
    Cline inclut des tests E2E complets utilisant Playwright qui simulent les interactions réelles de l'utilisateur avec l'extension dans VS Code :
    
    - **Exécution des tests E2E :**
      ```bash
      npm run test:e2e        # Construire et exécuter tous les tests E2E
      npm run e2e             # Exécuter les tests sans reconstruire
      npm run test:e2e -- --debug  # Exécuter avec le débogueur interactif
      ```
    
    - **Écriture des tests E2E :**
      - Les tests se trouvent dans `src/test/e2e/`
      - Utilisez le fixture `e2e` pour les tests d'espace de travail à racine unique
      - Utilisez le fixture `e2eMultiRoot` pour les tests d'espace de travail multi-racine
      - Suivez les modèles existants dans `auth.test.ts`, `chat.test.ts`, `diff.test.ts`, et `editor.test.ts`
      - Voir `src/test/e2e/README.md` pour la documentation détaillée
    
    - **Fonctionnalités du mode débogage :**
      - Inspecteur Playwright interactif pour le débogage pas à pas
      - Enregistrement des nouvelles interactions et génération automatique du code de test
      - Instance VS Code visuelle pour le test manuel
      - Inspection d'éléments et validation des sélecteurs
    
    - **Environnement de test :**
      - Configuration automatique de VS Code avec l'extension Cline chargée
      - Serveur API mock pour les tests backend
      - Espaces de travail temporaires avec des fixtures de test
      - Enregistrement vidéo pour les tests échoués

4. **Gestion des Versions avec Changesets**

    - Créez un changeset pour tout changement visible par l'utilisateur en utilisant `npm run changeset`
    - Choisissez la mise à jour de version appropriée :
        - `majeur` pour les changements cassants (1.0.0 → 2.0.0)
        - `mineur` pour les nouvelles fonctionnalités (1.0.0 → 1.1.0)
        - `correctif` pour les corrections de bugs (1.0.0 → 1.0.1)
    - Écrivez des messages de changeset clairs et descriptifs qui expliquent l'impact
    - Les changements liés à la documentation n'ont pas besoin de changesets

5. **Guidelines des Commit**

    - Écrivez des messages de commit clairs et descriptifs
    - Utilisez le format de commit conventionnel (ex : "feat:", "fix:", "docs:")
    - Référencer les problèmes pertinents dans les commits en utilisant #numéro-du-problème

6. **Avant de Soumettre**

    - Rebasez votre branche sur la dernière version de main
    - Assurez-vous que votre branche compile avec succès
    - Vérifiez que tous les tests passent
    - Revoyez vos changements pour tout code de débogage ou logs console

7. **Description de la Pull Request**
    - Décrivez clairement ce que font vos changements
    - Incluez les étapes pour tester les changements
    - Listez les changements cassants
    - Ajoutez des captures d'écran pour les modifications de l'interface utilisateur

## Accord de Contribution

En soumettant une pull request, vous acceptez que vos contributions soient licenciées sous la même licence que le projet ([Apache 2.0](LICENSE)).

N'oubliez pas : Contribuer à Cline, ce n'est pas seulement écrire du code - c'est faire partie d'une communauté qui façonne l'avenir du développement assisté par l'IA. Construisons quelque chose d'extraordinaire ensemble ! 🚀
