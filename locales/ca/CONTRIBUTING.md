# Contribuir a Roo Code

Estem entusiasmats que estigueu interessats en contribuir a Roo Code. Ja sigui arreglant un error, afegint una funcionalitat o millorant la nostra documentació, cada contribució fa que Roo Code sigui més intel·ligent! Per mantenir la nostra comunitat vibrant i acollidora, tots els membres han de complir el nostre [Codi de Conducta](CODE_OF_CONDUCT.md).

## Uniu-vos a la nostra comunitat

Encoratgem fortament a tots els col·laboradors a unir-se a la nostra [comunitat de Discord](https://discord.gg/roocode)! Formar part del nostre servidor de Discord us ajuda a:

- Obtenir ajuda i orientació en temps real sobre les vostres contribucions
- Connectar amb altres col·laboradors i membres de l'equip principal
- Mantenir-vos al dia sobre els desenvolupaments i prioritats del projecte
- Participar en discussions que configuren el futur de Roo Code
- Trobar oportunitats de col·laboració amb altres desenvolupadors

## Informar d'errors o problemes

Els informes d'errors ajuden a millorar Roo Code per a tothom! Abans de crear un nou informe, si us plau [cerqueu entre els existents](https://github.com/RooVetGit/Roo-Code/issues) per evitar duplicats. Quan estigueu a punt per informar d'un error, dirigiu-vos a la nostra [pàgina d'incidències](https://github.com/RooVetGit/Roo-Code/issues/new/choose) on trobareu una plantilla per ajudar-vos a completar la informació rellevant.

<blockquote class='warning-note'>
     🔐 <b>Important:</b> Si descobriu una vulnerabilitat de seguretat, utilitzeu l'<a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">eina de seguretat de Github per informar-ne privadament</a>.
</blockquote>

## Decidir en què treballar

Buscant una bona primera contribució? Consulteu les incidències a la secció "Issue [Unassigned]" del nostre [Projecte de Github de Roo Code](https://github.com/orgs/RooVetGit/projects/1). Aquestes estan específicament seleccionades per a nous col·laboradors i àrees on ens encantaria rebre ajuda!

També donem la benvinguda a contribucions a la nostra [documentació](https://docs.roocode.com/)! Ja sigui corregint errors tipogràfics, millorant guies existents o creant nou contingut educatiu - ens encantaria construir un repositori de recursos impulsat per la comunitat que ajudi a tothom a aprofitar al màxim Roo Code. Podeu fer clic a "Editar aquesta pàgina" a qualsevol pàgina per arribar ràpidament al lloc correcte a Github per editar el fitxer, o podeu anar directament a https://github.com/RooVetGit/Roo-Code-Docs.

Si esteu planejant treballar en una funcionalitat més gran, si us plau creeu primer una [sol·licitud de funcionalitat](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) perquè puguem discutir si s'alinea amb la visió de Roo Code.

## Configuració de desenvolupament

1. **Cloneu** el repositori:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Instal·leu les dependències**:

```sh
npm run install:all
```

3. **Inicieu la vista web (aplicació Vite/React amb HMR)**:

```sh
npm run dev
```

4. **Depuració**:
   Premeu `F5` (o **Execució** → **Inicia la depuració**) a VSCode per obrir una nova sessió amb Roo Code carregat.

Els canvis a la vista web apareixeran immediatament. Els canvis a l'extensió principal requeriran reiniciar l'amfitrió de l'extensió.

Alternativament, podeu crear un .vsix i instal·lar-lo directament a VSCode:

```sh
npm run build
```

Apareixerà un fitxer `.vsix` al directori `bin/` que es pot instal·lar amb:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## Escriure i enviar codi

Qualsevol persona pot contribuir amb codi a Roo Code, però us demanem que seguiu aquestes directrius per assegurar que les vostres contribucions puguin ser integrades sense problemes:

1. **Mantingueu les Pull Requests enfocades**

    - Limiteu les PR a una sola funcionalitat o correcció d'error
    - Dividiu els canvis més grans en PR més petites i relacionades
    - Dividiu els canvis en commits lògics que puguin ser revisats independentment

2. **Qualitat del codi**

    - Totes les PR han de passar les comprovacions de CI que inclouen tant anàlisi com formatació
    - Solucioneu qualsevol advertència o error d'ESLint abans d'enviar
    - Responeu a tots els comentaris d'Ellipsis, la nostra eina automatitzada de revisió de codi
    - Seguiu les millors pràctiques de TypeScript i mantingueu la seguretat de tipus

3. **Proves**

    - Afegiu proves per a noves funcionalitats
    - Executeu `npm test` per assegurar que totes les proves passin
    - Actualitzeu les proves existents si els vostres canvis les afecten
    - Incloeu tant proves unitàries com proves d'integració quan sigui apropiat

4. **Directrius de commits**

    - Escriviu missatges de commit clars i descriptius
    - Feu referència a incidències rellevants als commits utilitzant #número-incidència

5. **Abans d'enviar**

    - Rebaseu la vostra branca sobre l'última main
    - Assegureu-vos que la vostra branca es construeix amb èxit
    - Comproveu doblement que totes les proves passen
    - Reviseu els vostres canvis per qualsevol codi de depuració o registres de consola

6. **Descripció de la Pull Request**
    - Descriviu clarament què fan els vostres canvis
    - Incloeu passos per provar els canvis
    - Enumereu qualsevol canvi important
    - Afegiu captures de pantalla per a canvis d'interfície d'usuari

## Acord de contribució

En enviar una pull request, accepteu que les vostres contribucions estaran sota la mateixa llicència que el projecte ([Apache 2.0](../LICENSE)).
