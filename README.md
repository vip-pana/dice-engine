# Poker di Dadi — Prototipo (MVP)

Prototipo giocabile di un poker di dadi 1v1 a turni (Best of 3) contro un bot.
Serve a validare se il loop di gioco è divertente.

**Demo live:** https://vip-pana.github.io/dice-engine/ (deploy automatico via GitHub
Actions a ogni push su `main`).

**Report probabilità:** [docs/montecarlo-report.md](docs/montecarlo-report.md).

## Architettura

Barriera netta tra due livelli:

- **`src/engine/`** — rules engine **puro**, framework-agnostic e portabile (un domani
  in Godot / GDScript-C#). Nessun import da React/DOM/Vite, nessun uso di
  `Date`/`window`/`Math.random`. Tutta la casualità passa da un'interfaccia `Rng`
  iniettata, così i test sono deterministici.
- **`src/ui/`** — presentazione React usa-e-getta. Consuma l'engine, disegna lo stato,
  invia azioni. **Nessuna regola di gioco** vive qui.
- **`src/sim/`** — simulatore Monte Carlo per verificare le probabilità.

Codice, tipi e commenti in **inglese**; testi visibili all'utente in **italiano**.

## Comandi

```bash
npm install        # dipendenze

npm run dev        # dev server UI (Vite)
npm test           # test unitari (Vitest)
npm run typecheck  # type-check TypeScript strict
npm run sim        # simulatore Monte Carlo (tsx)
```

Il simulatore accetta due variabili d'ambiente opzionali:

```bash
SIM_TRIALS=200000 SIM_SEED=42 pnpm sim
```

Stampa la distribuzione delle categorie prodotta dalla strategia condivisa
(furto greedy + reroll euristico fino a 4 dadi), da confrontare con i target
del GDD. Divergenze sono materiale di bilanciamento: la strategia euristica è
tarabile, non è un bug delle regole.

## Come giocare

`pnpm dev`, poi apri il link (di solito http://localhost:5173). Prima componi il
tuo **mazzo** (vedi sotto), poi giochi un match Best of 3 contro il bot. Ogni mano
segue la sequenza fissa:

1. **Tiro iniziale** — tu e il bot tirate un dado: chi fa più alto è il primario
   (pareggio → si ritira).
2. **Scommessa iniziale** — il primario apre puntando l'importo che vuole
   (≥ minimo); l'altro deve vedere o rilanciare (niente check, niente fold).
3. **Furto** — clicca un dado comune per rubarlo (il primario ruba per primo).
4. **Scelta rilancio** — seleziona quali dei tuoi 4 dadi rilanciare (tutti tranne
   il rubato), poi conferma.
5. **Seconda scommessa** — il primario punta ≥ della prima; l'altro vede,
   rilancia o **lascia la mano** (il fold è possibile solo qui, e solo se stai
   affrontando una puntata: chi lascia cede piatto e punto).
6. **Showdown** — si confrontano le mani; il vincitore incassa il piatto.

Se nessuno dei due ha più monete da puntare, le finestre di scommessa vengono
**saltate**: la mano si gioca comunque per il punto del Bo3.

I dadi del bot sono sempre visibili. Il badge accanto ai dadi mostra la categoria
della mano attuale in tempo reale.

### Mazzo

Prima del match scegli i **12 dadi** del tuo mazzo, che resta fisso per tutta la
partita. A ogni mano ne vengono pescati **4 a caso**: quelli sono i tuoi dadi.

- Puoi mettere **al massimo un dado di ogni tipo speciale**; gli slot restanti
  sono d6 normali. Quindi in una mano non trovi mai due speciali identici.
- Un dado speciale nel mazzo esce in circa **33%** delle mani (4 su 12).
- Il bot riceve un mazzo generato con lo **stesso numero di dadi speciali** del
  tuo. Nota che un malus (il D4) conta come uno speciale, quindi sceglierlo ti
  costa due volte.
- I **dadi comuni** non fanno parte di nessun mazzo: continuano a poter uscire
  speciali col loro tasso.
- A fine match: *Nuova partita* tiene il mazzo (e ripesca quello del bot),
  *Cambia mazzo* torna alla schermata di composizione.
