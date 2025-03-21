# Contribuire a Roo Code

Siamo entusiasti che tu sia interessato a contribuire a Roo Code. Che tu stia correggendo un bug, aggiungendo una funzionalità o migliorando la nostra documentazione, ogni contributo rende Roo Code più intelligente! Per mantenere la nostra comunità vivace e accogliente, tutti i membri devono aderire al nostro [Codice di Condotta](CODE_OF_CONDUCT.md).

## Unisciti alla Nostra Comunità

Incoraggiamo fortemente tutti i contributori a unirsi alla nostra [comunità Discord](https://discord.gg/roocode)! Far parte del nostro server Discord ti aiuta a:

- Ottenere aiuto e guida in tempo reale sui tuoi contributi
- Connetterti con altri contributori e membri del team principale
- Rimanere aggiornato sugli sviluppi e le priorità del progetto
- Partecipare a discussioni che modellano il futuro di Roo Code
- Trovare opportunità di collaborazione con altri sviluppatori

## Segnalare Bug o Problemi

Le segnalazioni di bug aiutano a migliorare Roo Code per tutti! Prima di creare un nuovo problema, per favore [cerca tra quelli esistenti](https://github.com/RooVetGit/Roo-Code/issues) per evitare duplicati. Quando sei pronto a segnalare un bug, vai alla nostra [pagina dei problemi](https://github.com/RooVetGit/Roo-Code/issues/new/choose) dove troverai un modello per aiutarti a compilare le informazioni rilevanti.

<blockquote class='warning-note'>
     🔐 <b>Importante:</b> Se scopri una vulnerabilità di sicurezza, utilizza lo <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">strumento di sicurezza Github per segnalarla privatamente</a>.
</blockquote>

## Decidere Su Cosa Lavorare

Cerchi un buon primo contributo? Controlla i problemi nella sezione "Issue [Unassigned]" del nostro [Progetto Github di Roo Code](https://github.com/orgs/RooVetGit/projects/1). Questi sono specificamente selezionati per nuovi contributori e aree in cui ci piacerebbe avere un po' di aiuto!

Accogliamo anche contributi alla nostra [documentazione](https://docs.roocode.com/)! Che si tratti di correggere errori di battitura, migliorare guide esistenti o creare nuovi contenuti educativi - ci piacerebbe costruire un repository di risorse guidato dalla comunità che aiuti tutti a ottenere il massimo da Roo Code. Puoi cliccare su "Edit this page" su qualsiasi pagina per arrivare rapidamente al punto giusto in Github per modificare il file, oppure puoi andare direttamente a https://github.com/RooVetGit/Roo-Code-Docs.

Se stai pianificando di lavorare su una funzionalità più grande, per favore crea prima una [richiesta di funzionalità](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) così possiamo discutere se si allinea con la visione di Roo Code. Puoi anche consultare la nostra [Roadmap del Progetto](#roadmap-del-progetto) qui sotto per vedere se la tua idea si adatta alla nostra direzione strategica.

## Roadmap del Progetto

Roo Code ha una chiara roadmap di sviluppo che guida le nostre priorità e la direzione futura. Comprendere la nostra roadmap può aiutarti a:

- Allineare i tuoi contributi con gli obiettivi del progetto
- Identificare aree in cui la tua esperienza sarebbe più preziosa
- Comprendere il contesto dietro certe decisioni di design
- Trovare ispirazione per nuove funzionalità che supportino la nostra visione

La nostra roadmap attuale si concentra su sei pilastri chiave:

### Supporto Provider

Miriamo a supportare quanti più provider possibile:

- Supporto più versatile per "OpenAI Compatible"
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Supporto migliorato per Ollama e LM Studio

### Supporto Modelli

Vogliamo che Roo funzioni al meglio su quanti più modelli possibile, inclusi i modelli locali:

- Supporto per modelli locali attraverso prompt di sistema personalizzati e flussi di lavoro
- Valutazioni di benchmark e casi di test

### Supporto Sistemi

Vogliamo che Roo funzioni bene sul computer di tutti:

- Integrazione del terminale multipiattaforma
- Supporto forte e coerente per Mac, Windows e Linux

### Documentazione

Vogliamo una documentazione completa e accessibile per tutti gli utenti e contributori:

- Guide utente e tutorial ampliati
- Documentazione API chiara
- Migliore orientamento per i contributori
- Risorse di documentazione multilingue
- Esempi interattivi e campioni di codice

### Stabilità

Vogliamo ridurre significativamente il numero di bug e aumentare i test automatizzati:

- Interruttore di registrazione debug
- Pulsante di copia "Informazioni Macchina/Attività" per l'invio con richieste di supporto/bug

### Internazionalizzazione

Vogliamo che Roo parli la lingua di tutti:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

Accogliamo particolarmente i contributi che fanno progredire gli obiettivi della nostra roadmap. Se stai lavorando su qualcosa che si allinea con questi pilastri, per favore menzionalo nella descrizione della tua PR.

## Configurazione per lo Sviluppo

1. **Clona** il repository:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Installa le dipendenze**:

```sh
npm run install:all
```

3. **Avvia la webview (app Vite/React con HMR)**:

```sh
npm run dev
```

4. **Debug**:
   Premi `F5` (o **Run** → **Start Debugging**) in VSCode per aprire una nuova sessione con Roo Code caricato.

Le modifiche alla webview appariranno immediatamente. Le modifiche all'estensione principale richiederanno un riavvio dell'host dell'estensione.

In alternativa puoi creare un file .vsix e installarlo direttamente in VSCode:

```sh
npm run build
```

Un file `.vsix` apparirà nella directory `bin/` che può essere installato con:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## Scrivere e Inviare Codice

Chiunque può contribuire con codice a Roo Code, ma ti chiediamo di seguire queste linee guida per assicurare che i tuoi contributi possano essere integrati senza problemi:

1. **Mantieni le Pull Request Focalizzate**

    - Limita le PR a una singola funzionalità o correzione di bug
    - Suddividi i cambiamenti più grandi in PR più piccole e correlate
    - Suddividi i cambiamenti in commit logici che possono essere revisionati indipendentemente

2. **Qualità del Codice**

    - Tutte le PR devono passare i controlli CI che includono sia linting che formattazione
    - Risolvi qualsiasi avviso o errore di ESLint prima di inviare
    - Rispondi a tutti i feedback da Ellipsis, il nostro strumento automatico di revisione del codice
    - Segui le migliori pratiche di TypeScript e mantieni la sicurezza dei tipi

3. **Testing**

    - Aggiungi test per le nuove funzionalità
    - Esegui `npm test` per assicurarti che tutti i test passino
    - Aggiorna i test esistenti se le tue modifiche li influenzano
    - Includi sia test unitari che test di integrazione dove appropriato

4. **Linee Guida per i Commit**

    - Scrivi messaggi di commit chiari e descrittivi
    - Fai riferimento ai problemi rilevanti nei commit usando #numero-problema

5. **Prima di Inviare**

    - Fai il rebase del tuo branch sull'ultimo main
    - Assicurati che il tuo branch si costruisca con successo
    - Ricontrolla che tutti i test stiano passando
    - Rivedi le tue modifiche per qualsiasi codice di debug o log della console

6. **Descrizione della Pull Request**
    - Descrivi chiaramente cosa fanno le tue modifiche
    - Includi passaggi per testare le modifiche
    - Elenca eventuali breaking changes
    - Aggiungi screenshot per modifiche UI

## Accordo di Contribuzione

Inviando una pull request, accetti che i tuoi contributi saranno concessi in licenza con la stessa licenza del progetto ([Apache 2.0](../LICENSE)).
