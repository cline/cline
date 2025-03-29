### Prise en charge de .clineignore

Pour vous donner plus de contrôle sur les fichiers accessibles à Cline, nous avons implémenté la fonctionnalité `.clineignore`, similaire à `.gitignore`. Cela vous permet de spécifier les fichiers et répertoires que Cline ne doit **pas** accéder ou traiter. Cela est utile pour :

*   **Confidentialité :** Empêcher Cline d'accéder à des fichiers sensibles ou privés dans votre espace de travail.
*   **Performance :** Exclure de grands répertoires ou fichiers qui sont sans rapport avec vos tâches, ce qui peut améliorer l'efficacité de Cline.
*   **Gestion du contexte :** Concentrer l'attention de Cline sur les parties pertinentes de votre projet.

**Comment utiliser `.clineignore`**

1.  **Créer un fichier `.clineignore` :** Dans le répertoire racine de votre espace de travail (au même niveau que votre dossier `.vscode`, ou le dossier de niveau supérieur que vous avez ouvert dans VS Code), créez un nouveau fichier nommé `.clineignore`.

2.  **Définir des motifs d'ignorance :** Ouvrez le fichier `.clineignore` et spécifiez les motifs pour les fichiers et répertoires que vous voulez que Cline ignore. La syntaxe est la même que pour `.gitignore` :

    *   Chaque ligne du fichier représente un motif.
    *   **Les motifs glob standard sont pris en charge :**
        *   `*` correspond à zéro ou plusieurs caractères
        *   `?` correspond à un caractère
        *   `[]` correspond à une plage de caractères
        *   `**` correspond à un nombre quelconque de répertoires et sous-répertoires.

    *   **Motifs de répertoire :** Ajoutez `/` à la fin d'un motif pour spécifier un répertoire.
    *   **Motifs de négation :** Commencez un motif par `!` pour annuler (ne pas ignorer) un motif précédemment ignoré.
    *   **Commentaires :** Commencez une ligne par `#` pour ajouter des commentaires.

    **Exemple de fichier `.clineignore` :**

    ```
    # Ignorer les fichiers de log
    *.log

    # Ignorer le répertoire 'node_modules' entier
    node_modules/

    # Ignorer tous les fichiers dans le répertoire 'temp' et ses sous-répertoires
    temp/**

    # Mais NE PAS ignorer 'important.log' même s'il est à la racine
    !important.log

    # Ignorer tout fichier nommé 'secret.txt' dans n'importe quel sous-répertoire
    **/secret.txt
    ```

3.  **Cline respecte votre `.clineignore` :** Une fois que vous avez enregistré le fichier `.clineignore`, Cline reconnaîtra et appliquera automatiquement ces règles.

    *   **Contrôle d'accès aux fichiers :** Cline ne pourra pas lire le contenu des fichiers ignorés en utilisant des outils comme `read_file`. Si vous essayez d'utiliser un outil sur un fichier ignoré, Cline vous informera que l'accès est bloqué en raison des paramètres de `.clineignore`.
    *   **Liste de fichiers :** Lorsque vous demandez à Cline de lister les fichiers dans un répertoire (par exemple, en utilisant `list_files`), les fichiers et répertoires ignorés seront toujours listés, mais ils seront marqués d'un symbole **🔒** à côté de leur nom pour indiquer qu'ils sont ignorés. Cela vous aide à comprendre quels fichiers Cline peut et ne peut pas interagir avec.

4.  **Mises à jour dynamiques :** Cline surveille votre fichier `.clineignore` pour les changements. Si vous modifiez, créez ou supprimez votre fichier `.clineignore`, Cline mettra automatiquement à jour ses règles d'ignorance sans avoir besoin de redémarrer VS Code ou l'extension.

**En résumé**

Le fichier `.clineignore` offre un moyen puissant et flexible de contrôler l'accès de Cline aux fichiers de votre espace de travail, améliorant la confidentialité, la performance et la gestion du contexte. En utilisant une syntaxe familière de `.gitignore`, vous pouvez facilement adapter l'attention de Cline aux parties les plus pertinentes de vos projets.