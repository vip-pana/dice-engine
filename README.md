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
npm run sim:abilities  # forza relativa dei dadi speciali
npm run sim:optimal    # gioco ottimale come tetto teorico
```

I simulatori accettano due variabili d'ambiente opzionali:

```bash
SIM_TRIALS=200000 SIM_SEED=42 pnpm sim
```

`sim:abilities` a 20.000 mani richiede qualche minuto: la scelta del rilancio
campiona ogni keep-set, quindi il costo cresce col numero di mani. Per un giro
veloce basta `SIM_TRIALS=2000`, tenendo presente che sotto le ~10.000 mani il
rumore è dello stesso ordine delle differenze che stai cercando.

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
   il rubato), poi conferma. Qui si punta anche il **Dado Torpedo** (obbligatorio,
   se lo hai) e si scelge il bersaglio del **Dado Spugna** (facoltativo). Quando
   entrambi hanno scelto **i dadi vengono tirati subito**: da qui in poi la mano è
   definita.
5. **Mulinello** — solo se uno dei due ha quel dado speciale: avendo visto il
   risultato, decide se tirarlo una terza volta. Se nessuno ce l'ha, questo passo
   **non esiste**.
6. **Seconda scommessa** — il primario punta ≥ della prima; l'altro vede,
   rilancia o **lascia la mano** (il fold è possibile solo qui, e solo se stai
   affrontando una puntata: chi lascia cede piatto e punto). Nota che a questo
   punto **conosci già i tuoi dadi definitivi**: la seconda puntata è una scelta
   informata, non un azzardo.
7. **Showdown** — si confrontano le mani, si applicano i Dado Torpedo, il
   vincitore incassa il piatto.

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

### Dadi speciali

Ogni speciale è una voce del registro in
[`src/engine/abilities.ts`](src/engine/abilities.ts); la schermata del mazzo ne
mostra nome, icona e regola.

| Dado | Effetto | Se resta tra i comuni |
| --- | --- | --- |
| ✵ Stella Essiccata | Tira 3 dadi e tiene il più alto | Vale per chi lo ruba |
| ▲ D4 | Esce sempre 1–4: è un **malus** | Vale per chi lo ruba |
| 🦑 Nero di Seppia | Nasconde un dado dell'avversario fino allo showdown | Acceca **entrambi** |
| 🪙 Dado d'Oro | Il vincitore incassa il doppio | Raddoppia per **chiunque** vinca |
| ⚡ Dado Torpedo | Un dado scelto dell'avversario perde 1 allo showdown; 10% il campo si elettrizza e un tuo dado **a caso** perde 1 | Colpisce **entrambi** a caso |
| ⚙ Mulinello | Un terzo tiro **opzionale** di quel dado, deciso dopo aver visto il rilancio | **Non fa nulla** finché non lo rubi |
| ⬡ Dado Spugna | Annulla **un'abilità** dell'avversario a tua scelta, per questa mano | **Non fa nulla** finché non lo rubi |

Il Mulinello è l'unico che cambia la sequenza della mano (vedi il passo 5 sopra):
serve un momento in cui il risultato esiste già ma la mano non è chiusa.
Il Torpedo colpisce **dopo** il terzo tiro, quindi il Mulinello non può annullare
il -1.

#### Cosa può assorbire la Spugna

Scegli il bersaglio durante la **scelta rilancio** (passo 4), assieme ai dadi da
rilanciare. È facoltativo: puoi non spugnare niente.

Funziona su **Torpedo, Dado d'Oro, Mulinello e Nero di Seppia**. Non funziona su
**Stella Essiccata e D4**, e non è un limite arbitrario: quelle due decidono la
loro faccia *nel momento in cui il dado viene lanciato*, e a quel punto le facce
scartate non esistono più — non c'è niente da annullare. E una Spugna non può
assorbire un'altra Spugna.

Il Nero di Seppia è un caso a parte: scatta a **inizio mano**, prima che tu possa
scegliere un bersaglio. Quindi la Spugna non lo previene, lo **annulla a
posteriori** restituendoti la vista. Da qui una conseguenza legata al ruolo: il
primario agisce per primo, quindi rivede i suoi dadi **prima** di scegliere il
rilancio; il non-primario invia le due scelte insieme, quindi recupera la vista
solo per la seconda scommessa. Il primario ne ricava di più — coerente col
vantaggio che ha già altrove, ma è bene saperlo.

#### Forza misurata

`pnpm sim:abilities` fa giocare un loadout con **1 dado speciale** contro quattro
dadi normali, stessa strategia da entrambe le parti: l'unica variabile sono i
dadi, quindi lo scostamento da 50% è il contributo dell'abilità.

Misura a **20.000 mani per scenario**, seed di default:

| Dado | Winrate vs 4 normali |
| --- | --- |
| ⚙ Mulinello | 53,2% |
| ✵ Stella Essiccata | 52,8% |
| 🦑 Nero di Seppia | 49,9% * |
| 🪙 Dado d'Oro | 49,9% * |
| ⚡ Dado Torpedo | 49,9% * |
| ▲ D4 | 48,3% |

Controllo (normali vs normali): **49,4%**, cioè ≈50% a meno del rumore di
campionamento. Quel ±0,5% è anche il margine d'errore da tenere presente
leggendo la tabella.

**\* Quei tre valori sono identici, e non per caso.** Il simulatore misura solo la
**forza della mano di 5 dadi**, e Nero di Seppia, Dado d'Oro e Dado Torpedo non
toccano il valore dei dadi di chi li possiede: nascondono informazione,
raddoppiano il piatto, o colpiscono l'avversario in un punto che il simulatore non
modella. Per il simulatore sono d6 normali — infatti riportano tutti e tre
esattamente lo stesso conteggio del controllo. **Il loro valore reale non è
misurato qui**: va valutato a partita intera (piatto, monete, informazione), non
su una mano singola.

**Il Dado Spugna non è in tabella affatto, ed è la stessa ragione al quadrato.**
`playHeuristicHand` tira **una mano isolata**: non c'è avversario, non c'è piatto,
non c'è cecità, non passa dal reducer. La Spugna non ha nulla da annullare lì,
quindi misurerebbe esattamente 0,00 — e annulla proprio le abilità che l'harness
già non sa modellare. Metterla in tabella con un 49,9% significherebbe presentare
come misura un artefatto del simulatore.

Renderlo misurabile vuol dire un simulatore a **due posti** (contesa sul furto,
interazione dei rilanci, modello di scommessa) o pilotare il reducer vero dal sim:
un lavoro separato e grosso. Finché non esiste, il Dado Spugna e i tre con
l'asterisco **si bilanciano a giudizio, non a numeri** — e questo README lo dice
invece di far finta di avere i dati.

Le due abilità che il simulatore misura davvero sono quindi il Mulinello e la
Stella, e stanno entrambe intorno a **+3 punti** sopra il controllo. Il Mulinello
è nella stessa fascia della Stella, non oltre: un terzo tiro su **un** dado vale
circa quanto tenere il migliore di tre. Il D4 è sotto il controllo, come si
aspetta da un malus.
