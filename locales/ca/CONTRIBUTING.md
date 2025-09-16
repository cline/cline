<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • <b>Català</b> • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Contribuir a Roo Code

Roo Code és un projecte impulsat per la comunitat i valorem profundament cada contribució. Per agilitzar la col·laboració, operem sobre una base de [primer la incidència](#enfocament-de-primera-incidència), la qual cosa significa que totes les [sol·licituds d'extracció (PR)](#enviament-duna-sollicitud-dextracció) primer han d'estar enllaçades a una incidència de GitHub. Si us plau, reviseu aquesta guia amb atenció.

## Taula de continguts

- [Abans de contribuir](#abans-de-contribuir)
- [Trobar i planificar la vostra contribució](#trobar-i-planificar-la-vostra-contribució)
- [Procés de desenvolupament i submissió](#procés-de-desenvolupament-i-submissió)
- [Legal](#legal)

## Abans de contribuir

### 1. Codi de Conducta

Tots els col·laboradors han de complir el nostre [Codi de Conducta](./CODE_OF_CONDUCT.md).

### 2. Full de ruta del projecte

El nostre full de ruta guia la direcció del projecte. Alineeu les vostres contribucions amb aquests objectius clau:

### La fiabilitat primer

- Assegureu-vos que l'edició de diferències i l'execució d'ordres siguin fiables de manera consistent.
- Reduïu els punts de fricció que desincentiven l'ús habitual.
- Garantiu un funcionament fluid en tots els llocs i plataformes.
- Amplieu el suport robust per a una àmplia varietat de proveïdors i models d'IA.

### Experiència d'usuari millorada

- Agilitzeu la interfície d'usuari/experiència d'usuari per a més claredat i intuïtivitat.
- Milloreu contínuament el flux de treball per satisfer les altes expectatives que els desenvolupadors tenen de les eines d'ús diari.

### Liderant en rendiment d'agents

- Establir punts de referència d'avaluació complets (evals) per mesurar la productivitat del món real.
- Feu que sigui fàcil per a tothom executar i interpretar aquestes avaluacions.
- Envieu millores que demostrin augments clars en les puntuacions d'avaluació.

Mencioneu l'alineació amb aquestes àrees a les vostres sol·licituds d'extracció.

### 3. Uniu-vos a la comunitat de Roo Code

- **Principal:** Uniu-vos al nostre [Discord](https://discord.gg/roocode) i envieu un missatge directe a **Hannes Rudolph (`hrudolph`)**.
- **Alternativa:** Els col·laboradors experimentats poden participar directament a través de [Projectes de GitHub](https://github.com/orgs/RooCodeInc/projects/1).

## Trobar i planificar la vostra contribució

### Tipus de contribucions

- **Correccions d'errors:** abordar problemes de codi.
- **Noves característiques:** afegir funcionalitats.
- **Documentació:** millorar les guies i la claredat.

### Enfocament de primera incidència

Totes les contribucions comencen amb una incidència de GitHub utilitzant les nostres plantilles bàsiques.

- **Comproveu les incidències existents**: cerqueu a [Incidències de GitHub](https://github.com/RooCodeInc/Roo-Code/issues).
- **Creeu una incidència** utilitzant:
    - **Millores:** plantilla "Sol·licitud de millora" (llenguatge senzill centrat en el benefici per a l'usuari).
    - **Errors:** plantilla "Informe d'error" (reproducció mínima + esperat vs real + versió).
- **Voleu treballar-hi?** Comenteu "Reclamant" a la incidència i envieu un missatge directe a **Hannes Rudolph (`hrudolph`)** a [Discord](https://discord.gg/roocode) per ser assignat. L'assignació es confirmarà al fil.
- **Les sol·licituds d'extracció han d'enllaçar a la incidència.** Les sol·licituds d'extracció no enllaçades es poden tancar.

### Decidir en què treballar

- Consulteu el [Projecte de GitHub](https://github.com/orgs/RooCodeInc/projects/1) per a incidències "Incidència [No assignada]".
- Per a documents, visiteu [Documents de Roo Code](https://github.com/RooCodeInc/Roo-Code-Docs).

### Informar d'errors

- Comproveu primer si hi ha informes existents.
- Creeu un error nou utilitzant la [plantilla "Informe d'error"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) amb:
    - Passos de reproducció clars i numerats
    - Resultat esperat vs real
    - Versió de Roo Code (obligatori); proveïdor/model d'API si és rellevant
- **Problemes de seguretat**: informeu de manera privada a través d' [avisos de seguretat](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Procés de desenvolupament i submissió

### Configuració del desenvolupament

1. **Bifurcació i clonació:**

```
git clone https://github.com/EL_TEU_NOM_USUARI/Roo-Code.git
```

2. **Instal·leu les dependències:**

```
pnpm install
```

3. **Depuració:** Obriu amb VS Code (`F5`).

### Directrius per escriure codi

- Una sol·licitud d'extracció centrada per característica o correcció.
- Seguiu les millors pràctiques d'ESLint i TypeScript.
- Escriviu confirmacions clares i descriptives que facin referència a incidències (p. ex., `Soluciona #123`).
- Proporcioneu proves exhaustives (`npm test`).
- Rebaseu a la branca `main` més recent abans de la submissió.

### Enviament d'una sol·licitud d'extracció

- Comenceu com a **PR d'esborrany** si busqueu comentaris primerencs.
- Descriviu clarament els vostres canvis seguint la plantilla de sol·licitud d'extracció.
- Enllaceu la incidència a la descripció/títol de la PR (p. ex., "Soluciona #123").
- Proporcioneu captures de pantalla/vídeos per a canvis a la interfície d'usuari.
- Indiqueu si calen actualitzacions de la documentació.

### Política de sol·licitud d'extracció

- Ha de fer referència a una incidència de GitHub assignada. Per ser assignat: comenteu "Reclamant" a la incidència i envieu un missatge directe a **Hannes Rudolph (`hrudolph`)** a [Discord](https://discord.gg/roocode). L'assignació es confirmarà al fil.
- Les sol·licituds d'extracció no enllaçades es poden tancar.
- Les sol·licituds d'extracció han de passar les proves de CI, alinear-se amb el full de ruta i tenir una documentació clara.

### Procés de revisió

- **Triatge diari:** revisions ràpides per part dels mantenidors.
- **Revisió setmanal en profunditat:** avaluació completa.
- **Itereu ràpidament** en funció dels comentaris.

## Legal

En contribuir, accepteu que les vostres contribucions es llicenciaran sota la llicència Apache 2.0, d'acord amb la llicència de Roo Code.
