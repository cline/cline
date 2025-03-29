# Architecture de l'extension Cline

Ce répertoire contient la documentation architecturale pour l'extension VSCode de Cline.

## Diagramme de l'architecture de l'extension

Le fichier [extension-architecture.mmd](./extension-architecture.mmd) contient un diagramme Mermaid montrant l'architecture de haut niveau de l'extension Cline. Le diagramme illustre :

1. **Extension de base**
   - Point d'entrée de l'extension et classes principales
   - Gestion de l'état via l'état global et le stockage des secrets de VSCode
   - Logique métier principale dans la classe Cline

2. **Interface utilisateur Webview**
   - Interface utilisateur basée sur React
   - Gestion de l'état via ExtensionStateContext
   - Hiérarchie des composants

3. **Stockage**
   - Stockage spécifique aux tâches pour l'historique et l'état
   - Système de points de contrôle basé sur Git pour les modifications de fichiers

4. **Flux de données**
   - Flux de données de l'extension de base entre les composants
   - Flux de données de l'interface utilisateur Webview
   - Communication bidirectionnelle entre le noyau et le webview

## Affichage du diagramme

Pour afficher le diagramme :
1. Installez une extension de visionneuse de diagrammes Mermaid dans VSCode
2. Ouvrez extension-architecture.mmd
3. Utilisez la fonction de prévisualisation de l'extension pour rendre le diagramme

Vous pouvez également afficher le diagramme sur GitHub, qui prend en charge le rendu Mermaid intégré.

## Schéma de couleurs

Le diagramme utilise un schéma de couleurs à contraste élevé pour une meilleure visibilité :
- Rose (#ff0066) : Composants de l'état global et du stockage des secrets
- Bleu (#0066ff) : Contexte de l'état de l'extension
- Vert (#00cc66) : Fournisseur Cline
- Tous les composants utilisent du texte blanc pour une lisibilité maximale