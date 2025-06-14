<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • <b>Català</b> • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuir a Roo Code

Roo Code és un projecte impulsat per la comunitat i valorem molt cada contribució. Per simplificar la col·laboració, treballem amb un enfoc [Issue-First](#enfoc-issue-first), que significa que tots els [Pull Requests (PRs)](#enviar-un-pull-request) han d'estar primer vinculats a una Issue de GitHub. Si us plau, llegeix aquesta guia amb atenció.

## Taula de continguts

- [Abans de contribuir](#abans-de-contribuir)
- [Trobar i planificar la teva contribució](#trobar-i-planificar-la-teva-contribució)
- [Procés de desenvolupament i enviament](#procés-de-desenvolupament-i-enviament)
- [Legal](#legal)

## Abans de contribuir

### 1. Codi de conducta

Tots els col·laboradors han de complir el nostre [Codi de conducta](./CODE_OF_CONDUCT.md).

### 2. Fulla de ruta del projecte

La nostra fulla de ruta orienta la direcció del projecte. Alinea les teves contribucions amb aquests objectius clau:

### Fiabilitat primer

- Garantir que l'edició de diferències i l'execució de comandes siguin consistentment fiables
- Reduir els punts de fricció que desanimen l'ús regular
- Garantir un funcionament fluid en tots els idiomes i plataformes
- Ampliar el suport robust per a una àmplia varietat de proveïdors i models d'IA

### Experiència d'usuari millorada

- Simplificar la interfície d'usuari per a més claredat i intuïció
- Millorar contínuament el flux de treball per satisfer les altes expectatives dels desenvolupadors

### Lideratge en rendiment dels agents

- Establir punts de referència d'avaluació (evals) complets per mesurar la productivitat real
- Facilitar que tothom pugui executar i interpretar aquestes avaluacions fàcilment
- Proporcionar millores que demostrin increments clars en les puntuacions d'avaluació

Esmenta la relació amb aquestes àrees als teus PRs.

### 3. Uneix-te a la comunitat Roo Code

- **Principal:** Uneix-te al nostre [Discord](https://discord.gg/roocode) i envia un DM a **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Els col·laboradors experimentats poden participar directament via [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1).

## Trobar i planificar la teva contribució

### Tipus de contribucions

- **Correcció d'errors:** Solucionar problemes en el codi.
- **Noves funcionalitats:** Afegir noves capacitats.
- **Documentació:** Millorar guies i claredat.

### Enfoc Issue-First

Totes les contribucions han de començar amb una Issue de GitHub.

- **Revisar issues existents:** Cerca a [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Crear una issue:** Utilitza les plantilles adequades:
    - **Errors:** Plantilla "Bug Report".
    - **Funcionalitats:** Plantilla "Detailed Feature Proposal". Es requereix aprovació abans de començar.
- **Reclamar issues:** Comenta i espera l'assignació oficial.

**Els PRs sense issues aprovades poden ser tancats.**

### Decidir en què treballar

- Consulta el [Projecte GitHub](https://github.com/orgs/RooCodeInc/projects/1) per trobar "Good First Issues" no assignades.
- Per a documentació, visita [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Informar d'errors

- Comprova primer els informes existents.
- Crea nous informes d'errors utilitzant la [plantilla "Bug Report"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Vulnerabilitats de seguretat:** Informa de manera privada via [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Procés de desenvolupament i enviament

### Configuració de desenvolupament

1. **Fork & Clona:**

```
git clone https://github.com/EL_TEU_USUARI/Roo-Code.git
```

2. **Instal·la dependències:**

```
npm run install:all
```

3. **Depuració:** Obre amb VS Code (`F5`).

### Guia per escriure codi

- Un PR centrat per funcionalitat o correcció.
- Segueix les millors pràctiques d'ESLint i TypeScript.
- Escriu missatges de commit clars i descriptius que facin referència a issues (ex: `Fixes #123`).
- Proporciona proves completes (`npm test`).
- Rebaseja a la branca `main` més recent abans d'enviar.

### Enviar un Pull Request

- Comença com a **PR en esborrany** si busques feedback primerenc.
- Descriu clarament els teus canvis seguint la Plantilla de Pull Request.
- Proporciona captures de pantalla/vídeos per a canvis d'UI.
- Indica si es necessiten actualitzacions de documentació.

### Política de Pull Request

- Ha de fer referència a issues preaprovades i assignades.
- Els PRs que no segueixen la política poden ser tancats.
- Els PRs han de passar els tests de CI, alinear-se amb la fulla de ruta i tenir documentació clara.

### Procés de revisió

- **Triatge diari:** Comprovacions ràpides pels mantenidors.
- **Revisió setmanal detallada:** Avaluació exhaustiva.
- **Itera ràpidament** en base al feedback.

## Legal

En enviar un pull request, acceptes que les teves contribucions es llicenciïn sota la Llicència Apache 2.0, d'acord amb la llicència de Roo Code.
