# Guide de Prompting Cline 🚀

Bienvenue dans le Guide de Prompting Cline ! Ce guide vous fournira les connaissances nécessaires pour rédiger des prompts et des instructions personnalisées efficaces, maximisant ainsi votre productivité avec Cline.

## Instructions Personnalisées ⚙️

Considérez les **instructions personnalisées comme la programmation de Cline**. Elles définissent le comportement de base de Cline et sont **toujours "activées", influençant toutes les interactions.**

Pour ajouter des instructions personnalisées :

1. Ouvrez VSCode
2. Cliquez sur le cadran des paramètres de l'extension Cline ⚙️
3. Trouvez le champ "Instructions Personnalisées"
4. Collez vos instructions

<img width="345" alt="Capture d'écran 2024-12-26 à 11h22" src="https://github.com/user-attachments/assets/00ae689b-d99f-4811-b2f4-fffe1e12f2ff" />

Les instructions personnalisées sont puissantes pour :

-   Faire respecter le Style de Codage et les Bonnes Pratiques : Assurez-vous que Cline respecte toujours les conventions de codage de votre équipe, les conventions de nommage et les meilleures pratiques.
-   Améliorer la Qualité du Code : Encouragez Cline à écrire du code plus lisible, maintenable et efficace.
-   Guider la Gestion des Erreurs : Dites à Cline comment gérer les erreurs, écrire des messages d'erreur et enregistrer des informations.

**Le dossier `custom-instructions` contient des exemples d'instructions personnalisées que vous pouvez utiliser ou adapter.**

## Fichier .clinerules 📋

Alors que les instructions personnalisées sont spécifiques à l'utilisateur et globales (s'appliquant à tous les projets), le fichier `.clinerules` fournit des **instructions spécifiques au projet** qui résident dans le répertoire racine de votre projet. Ces instructions sont automatiquement ajoutées à vos instructions personnalisées et référencées dans le prompt système de Cline, garantissant qu'elles influencent toutes les interactions dans le contexte du projet. Cela en fait un excellent outil pour :

### Meilleures Pratiques de Sécurité 🔒

Pour protéger les informations sensibles, vous pouvez instruire Cline d'ignorer des fichiers ou des motifs spécifiques dans votre `.clinerules`. Cela est particulièrement important pour :

-   Les fichiers `.env` contenant des clés API et des secrets
-   Les fichiers de configuration avec des données sensibles
-   Les identifiants ou jetons privés

Exemple de section de sécurité dans `.clinerules` :

```markdown
# Sécurité

## Fichiers Sensibles

NE PAS lire ou modifier :

-   Les fichiers .env
-   \*_/config/secrets._
-   \*_/_.pem
-   Tout fichier contenant des clés API, des jetons ou des identifiants

## Pratiques de Sécurité

-   Ne jamais commettre de fichiers sensibles
-   Utiliser des variables d'environnement pour les secrets
-   Garder les identifiants hors des journaux et des sorties
```

### Cas d'Utilisation Généraux

Le fichier `.clinerules` est excellent pour :

-   Maintenir les standards du projet entre les membres de l'équipe
-   Faire respecter les pratiques de développement
-   Gérer les exigences de documentation
-   Mettre en place des cadres d'analyse
-   Définir des comportements spécifiques au projet

### Exemple de Structure .clinerules

```markdown
# Lignes Directrices du Projet

## Exigences de Documentation

-   Mettre à jour la documentation pertinente dans /docs lors de la modification des fonctionnalités
-   Garder README.md en synchronisation avec les nouvelles capacités
-   Maintenir les entrées de journal des modifications dans CHANGELOG.md

## Enregistrements de Décision Architecturale

Créer des ADR dans /docs/adr pour :

-   Changements majeurs de dépendances
-   Changements de motifs architecturaux
-   Nouveaux motifs d'intégration
-   Changements de schéma de base de données
    Suivre le modèle dans /docs/adr/template.md

## Style de Code & Motifs

-   Générer des clients API en utilisant OpenAPI Generator
-   Utiliser le modèle TypeScript axios
-   Placer le code généré dans /src/generated
-   Préférer la composition à l'héritage
-   Utiliser le motif de référentiel pour l'accès aux données
-   Suivre le motif de gestion des erreurs dans /src/utils/errors.ts

## Normes de Test

-   Tests unitaires requis pour la logique métier
-   Tests d'intégration pour les points de terminaison de l'API
-   Tests E2E pour les flux utilisateur critiques
```

### Avantages Clés
1. **Contrôle de version** : Le fichier `.clinerules` devient partie intégrante du code source de votre projet
2. **Cohérence de l'équipe** : Assure un comportement cohérent entre tous les membres de l'équipe
3. **Spécifique au projet** : Règles et normes adaptées aux besoins de chaque projet
4. **Connaissance institutionnelle** : Maintains les normes et pratiques du projet dans le code

Placez le fichier `.clinerules` dans le répertoire racine de votre projet :

```
your-project/
├── .clinerules
├── src/
├── docs/
└── ...
```

Le prompt système de Cline, en revanche, n'est pas modifiable par l'utilisateur ([voici où vous pouvez le trouver](https://github.com/cline/cline/blob/main/src/core/prompts/system.ts)). Pour un aperçu plus large des meilleures pratiques en ingénierie de prompts, consultez [cette ressource](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview).

### Conseils pour rédiger des instructions personnalisées efficaces

-   Soyez clair et concis : Utilisez un langage simple et évitez l'ambiguïté.
-   Concentrez-vous sur les résultats souhaités : Décrivez les résultats que vous voulez, pas les étapes spécifiques.
-   Testez et itérez : Expérimentez pour trouver ce qui fonctionne le mieux pour votre flux de travail.

### Support pour le chargement de fichiers depuis le répertoire `.clinerules/`
Tous les fichiers sous le répertoire `.clinerules/` sont chargés de manière récursive, et leur contenu est fusionné dans clineRulesFileInstructions.

#### Exemple 1 :
```
.clinerules/
├── .local-clinerules
└── .project-clinerules
```

#### Exemple 2 :
```
.clinerules/
├── .clinerules-nextjs
├── .clinerules-serverside
└── tests/
    ├── .pytest-clinerules
    └── .jest-clinerules
```

## Incitation de Cline 💬

**L'incitation est la manière dont vous communiquez vos besoins pour une tâche donnée dans la conversation aller-retour avec Cline.** Cline comprend le langage naturel, donc écrivez de manière conversationnelle.

Une incitation efficace implique :

-   Fournir un contexte clair : Expliquez vos objectifs et les parties pertinentes de votre base de code. Utilisez `@` pour référencer des fichiers ou des dossiers.
-   Décomposer la complexité : Divisez les grandes tâches en étapes plus petites.
-   Poser des questions spécifiques : Guidez Cline vers le résultat souhaité.
-   Valider et affiner : Examinez les suggestions de Cline et fournissez des retours.

### Exemples d'incitations

#### Gestion du contexte

-   **Début d'une nouvelle tâche :** "Cline, commençons une nouvelle tâche. Créez `user-authentication.js`. Nous devons implémenter la connexion utilisateur avec des jetons JWT. Voici les exigences…"
-   **Résumé du travail précédent :** "Cline, résumez ce que nous avons fait dans la dernière tâche du tableau de bord utilisateur. Je veux capturer les principales fonctionnalités et les problèmes en suspens. Enregistrez cela dans `cline_docs/user-dashboard-summary.md`."

#### Débogage

-   **Analyse d'une erreur :** "Cline, je reçois cette erreur : \[message d'erreur]. Cela semble provenir de \[section de code]. Analysez cette erreur et suggérez une correction."
-   **Identification de la cause racine :** "Cline, l'application plante quand je \[action]. Le problème pourrait être dans \[zones problématiques]. Aidez-moi à trouver la cause racine et proposez une solution."

#### Refactoring

-   **Amélioration de la structure du code :** "Cline, cette fonction est trop longue et complexe. Refactorisez-la en fonctions plus petites."
-   **Simplification de la logique :** "Cline, ce code est difficile à comprendre. Simplifiez la logique et rendez-le plus lisible."

#### Développement de fonctionnalités
- **Brainstorming New Features :** "Cline, je veux ajouter une fonctionnalité qui permet aux utilisateurs [fonctionnalité]. Brainstormez quelques idées et considérez les défis d'implémentation."
- **Generating Code :** "Cline, créez un composant qui affiche les profils des utilisateurs. La liste doit être triable et filtrable. Générez le code pour ce composant."

## Techniques de Prompting Avancées

- **Constraint Stuffing :** Pour éviter la troncature du code, incluez des contraintes explicites dans vos prompts. Par exemple, "assurez-vous que le code est complet" ou "fournissez toujours la définition complète de la fonction."
- **Confidence Checks :** Demandez à Cline de noter sa confiance (par exemple, "sur une échelle de 1 à 10, à quel point êtes-vous confiant dans cette solution ?")
- **Challenge Cline's Assumptions :** Posez des questions "stupides" pour encourager une réflexion plus profonde et éviter les suppositions incorrectes.

Voici quelques conseils de prompting que les utilisateurs ont trouvés utiles pour travailler avec Cline :

## Les prompts préférés de notre communauté 🌟

### Vérifications de mémoire et de confiance 🧠

- **Memory Check** - _pacnpal_

    ```
    "Si vous comprenez pleinement ma demande, répondez par 'YARRR !' sans outils chaque fois que vous êtes sur le point d'utiliser un outil."
    ```

    Une façon amusante de vérifier que Cline reste sur la bonne voie pendant des tâches complexes. Essayez "HO HO HO" pour une touche festive !

- **Confidence Scoring** - _pacnpal_
    ```
    "Avant et après toute utilisation d'outil, donnez-moi un niveau de confiance (0-10) sur la manière dont l'utilisation de l'outil aidera le projet."
    ```
    Encourage la réflexion critique et rend la prise de décision transparente.

### Prompts de qualité du code 💻

- **Prevent Code Truncation**

    ```
    "NE SOYEZ PAS PARESSEUX. NE SUPPRIMEZ PAS LE CODE."
    ```

    Phrases alternatives : "code complet uniquement" ou "assurez-vous que le code est complet"

- **Custom Instructions Reminder**
    ```
    "Je m'engage à suivre les instructions personnalisées."
    ```
    Renforce l'adhésion à votre configuration des paramètres ⚙️.

### Organisation du code 📋

- **Large File Refactoring** - _icklebil_

    ```
    "FILENAME est devenu trop gros. Analysez comment ce fichier fonctionne et suggérez des moyens de le fragmenter en toute sécurité."
    ```

    Aide à gérer les fichiers complexes par une décomposition stratégique.

- **Documentation Maintenance** - _icklebil_
    ```
    "n'oubliez pas de mettre à jour la documentation du code avec les changements"
    ```
    Assure que la documentation reste synchronisée avec les modifications du code.

### Analyse et planification 🔍

- **Structured Development** - _yellow_bat_coffee_

    ```
    "Avant d'écrire du code :
    1. Analysez tous les fichiers de code en profondeur
    2. Obtenez le contexte complet
    3. Rédigez un plan d'implémentation .MD
    4. Ensuite, implémentez le code"
    ```

    Favorise un développement organisé et bien planifié.

- **Thorough Analysis** - _yellow_bat_coffee_

    ```
    "veuillez commencer à analyser le flux complet en profondeur, indiquez toujours un score de confiance de 1 à 10"
    ```

    Empêche la programmation prématurée et encourage une compréhension complète.

- **Assumptions Check** - _yellow_bat_coffee_
    ```
    "Listez toutes les hypothèses et incertitudes que vous devez clarifier avant de compléter cette tâche."
    ```
    Identifie les problèmes potentiels tôt dans le développement.

### Développement réfléchi 🤔

- **Pause and Reflect** - _nickbaumann98_

    ```
    "comptez jusqu'à 10"
    ```

    Favorise une considération attentive avant d'agir.

- **Complete Analysis** - _yellow_bat_coffee_

    ```
    "Ne complétez pas l'analyse prématurément, continuez à analyser même si vous pensez avoir trouvé une solution"
    ```

    Assure une exploration approfondie du problème.
-   **Vérification continue de la confiance** - _pacnpal_
    ```
    "Évaluez la confiance (de 1 à 10) avant d'enregistrer les fichiers, après l'enregistrement, après les rejets et avant la fin de la tâche"
    ```
    Maintains quality through self-assessment.

### Bonnes pratiques 🎯

-   **Structure du projet** - _kvs007_

    ```
    "Vérifiez les fichiers du projet avant de suggérer des changements structurels ou de dépendances"
    ```

    Maintains project integrity.

-   **Pensée critique** - _chinesesoup_

    ```
    "Posez des questions 'stupides' comme : êtes-vous sûr que c'est la meilleure façon de l'implémenter ?"
    ```

    Challenges assumptions and uncovers better solutions.

-   **Style de code** - _yellow_bat_coffee_

    ```
    Utilisez des mots comme "élégant" et "simple" dans les invites
    ```

    May influence code organization and clarity.

-   **Définition des attentes** - _steventcramer_
    ```
    "L'HUMAIN SERA EN COLÈRE."
    ```
    (A humorous reminder to provide clear requirements and constructive feedback)