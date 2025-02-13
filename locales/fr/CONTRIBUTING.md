# Contribution à Cline

Nous sommes ravis que tu sois intéressé à contribuer à Cline. Que tu corriges un bug, ajoutes une fonctionnalité ou améliores notre documentation, chaque contribution rend Cline plus intelligent ! Afin de maintenir une communauté dynamique et accueillante, tous les membres doivent respecter notre [Code de conduite](CODE_OF_CONDUCT.md).

## Signaler des bugs ou des problèmes

Les rapports de bugs nous aident à améliorer Cline pour tout le monde ! Avant de créer un nouveau problème, vérifie les [problèmes existants](https://github.com/cline/cline/issues) pour éviter les doublons. Si tu es prêt à signaler un bug, rends-toi sur notre [page Issues](https://github.com/cline/cline/issues/new/choose), où un modèle t’aidera à fournir les informations nécessaires.

<blockquote class='warning-note'>
    🔐 <b>Important :</b> Si tu découvres une faille de sécurité, utilise l’<a href="https://github.com/cline/cline/security/advisories/new">outil de sécurité GitHub pour la signaler en privé</a>.
</blockquote>

## Choisir sur quoi travailler

Tu cherches une première contribution ? Consulte les issues marquées comme ["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue) ou ["help wanted"](https://github.com/cline/cline/labels/help%20wanted). Celles-ci sont spécialement sélectionnées pour les nouveaux contributeurs et concernent des domaines où nous avons besoin d’aide !

Nous accueillons également les contributions à notre [documentation](https://github.com/cline/cline/tree/main/docs). Que ce soit pour corriger des fautes, améliorer des guides existants ou créer de nouveaux contenus pédagogiques, nous voulons construire un référentiel de ressources géré par la communauté pour aider tout le monde à tirer le meilleur parti de Cline. Commence par explorer `/docs` et identifie les améliorations possibles.

Si tu envisages de travailler sur une fonctionnalité majeure, crée d’abord une [demande de fonctionnalité](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) afin que nous puissions discuter de sa pertinence pour la vision de Cline.

## Configurer l’environnement de développement

1. **Extensions VS Code**

    - À l’ouverture du projet, VS Code te proposera d’installer les extensions recommandées
    - Ces extensions sont essentielles au développement, accepte toutes les demandes d’installation
    - Si tu as refusé les demandes, installe-les manuellement depuis l’onglet des extensions

2. **Développement local**
    - Exécute `npm run install:all` pour installer les dépendances
    - Exécute `npm run test` pour exécuter les tests en local
    - Avant de soumettre un PR, exécute `npm run format:fix` pour formater ton code

## Écrire et soumettre du code

Tout le monde peut contribuer au code de Cline, mais nous te demandons de suivre ces directives pour garantir une intégration fluide de tes contributions :

1. **Garder les Pull Requests ciblées**

    - Limite chaque PR à une seule fonctionnalité ou correction de bug
    - Découpe les modifications majeures en plusieurs PRs cohérentes
    - Divise les changements en commits logiques, chacun pouvant être examiné indépendamment

2. **Qualité du code**

    - Exécute `npm run lint` pour vérifier le style du code
    - Exécute `npm run format` pour formater automatiquement le code
    - Tous les PRs doivent passer les vérifications CI, incluant linting et formatage
    - Corrige tous les avertissements ou erreurs ESLint avant de soumettre
    - Suis les bonnes pratiques TypeScript et respecte la sécurité des types

3. **Tests**

    - Ajoute des tests pour toute nouvelle fonctionnalité
    - Exécute `npm test` pour vérifier que tous les tests passent
    - Mets à jour les tests existants si tes modifications les affectent
    - Ajoute des tests unitaires et d’intégration lorsque c’est pertinent

4. **Règles de commits**

    - Rédige des messages de commit clairs et descriptifs
    - Utilise le format conventionnel des commits (ex. : "feat:", "fix:", "docs:")
    - Fais référence aux issues pertinentes dans les commits en utilisant #NuméroIssue

5. **Avant de soumettre**

    - Rebase ta branche avec la dernière version de `main`
    - Vérifie que ton code se compile correctement
    - Assure-toi que tous les tests passent
    - Passe en revue tes changements et supprime tout code de débogage ou logs inutiles

6. **Description du Pull Request**
    - Explique clairement les modifications apportées
    - Ajoute des étapes pour tester les changements
    - Liste les principales modifications
    - Ajoute des captures d’écran pour les modifications d’interface utilisateur

## Accord de contribution

En soumettant une Pull Request, tu acceptes que tes contributions soient licenciées sous la même licence que le projet ([Apache 2.0](LICENSE)).

N’oublie pas : contribuer à Cline, ce n’est pas seulement écrire du code, c’est aussi faire partie d’une communauté qui façonne l’avenir du développement assisté par IA. Construisons quelque chose d’incroyable ensemble ! 🚀
