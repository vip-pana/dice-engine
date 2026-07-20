# Report Monte Carlo — Gioco ottimale (livello 1)

Questo report misura la distribuzione delle categorie quando ogni decisione di
**costruzione della mano** (quale comune rubare, quali dadi rilanciare) è presa in
modo **ottimale**, non con l'euristica del bot. È il "livello 1" del ragionamento:
il **tetto teorico** di quanto forte può diventare una mano giocando perfettamente,
senza modellare l'avversario.

## Cosa vuol dire "ottimale" qui

Il solver [src/engine/optimal.ts](../src/engine/optimal.ts) sceglie, a ogni bivio, la
mossa che **massimizza il valore atteso della forza finale della mano** (`handScore`,
coerente con `compareHands`). Due differenze cruciali rispetto all'euristica del bot:

1. **EV esatto, non campionato.** Per ogni possibile scelta di reroll, i dadi rilanciati
   sono uniformi su 6 facce: il valore atteso si calcola **enumerando tutti i 6^k esiti**
   (k = numero di dadi rilanciati, ≤ 4 → ≤ 1296 combinazioni). Nessun rumore statistico.
2. **Non è miope.** Valuta il risultato *finale* di ogni keep-set, quindi riconosce i
   progetti di scala: con `2,3,4,5` + un `2` rubato, rompe il doppione e insegue la
   scala di sei — cosa che l'euristica greedy non fa.

> Nota: "livello 1" ignora l'avversario. Massimizza la propria forza attesa, non la
> probabilità di battere il bot (quello sarebbe il livello 2/3). I dadi del bot,
> pur visibili nel gioco, qui non entrano nella decisione.

## Come è stato prodotto

```bash
SIM_TRIALS=50000 SIM_SEED=20260719 pnpm sim:optimal
```

- **Prove per run:** 50.000 mani (il solver è pesante: valuta ~20k mani per decisione,
  quindi si usa un numero di prove inferiore ai report euristici — resta statisticamente
  solido, i due seed concordano entro ~0,4 pp).
- **Seed usati:** `20260719` (run A) e `1` (run B).
- **Reroll:** fino a 4 (regola attuale del gioco).

## Risultati (gioco ottimale)

| Categoria | Run A (seed 20260719) | Run B (seed 1) | Media | Target GDD | Δ vs GDD |
|---|---:|---:|---:|---:|---:|
| Carta alta | 0,07% | 0,09% | **0,08%** | — | — |
| Coppia | 10,58% | 10,86% | **10,72%** | — | — |
| Doppia coppia | 23,21% | 23,44% | **23,33%** | — | — |
| Tris | 22,01% | 22,02% | **22,02%** | — | — |
| Full house | 21,37% | 21,02% | **21,20%** | 16,50% | **+4,70 pp** |
| Quattro uguali | 12,11% | 12,08% | **12,10%** | — | — |
| Cinque uguali | 1,69% | 1,54% | **1,62%** | — | — |
| Scala di cinque | 4,33% | 4,41% | **4,37%** | 6,00% | **−1,63 pp** |
| Scala di sei | 4,63% | 4,54% | **4,59%** | 6,00% | **−1,41 pp** |

## Confronto: ottimale vs euristica del bot

| Categoria | Ottimale | Euristica (bot) | Differenza |
|---|---:|---:|---:|
| Carta alta | 0,08% | 0,67% | −0,59 pp |
| Coppia | 10,72% | 11,82% | −1,10 pp |
| Doppia coppia | 23,33% | 22,90% | +0,43 pp |
| Tris | 22,02% | 22,06% | −0,04 pp |
| Full house | 21,20% | 20,75% | +0,45 pp |
| Quattro uguali | 12,10% | 11,69% | +0,41 pp |
| Cinque uguali | 1,62% | 1,57% | +0,05 pp |
| Scala di cinque | 4,37% | 3,97% | +0,40 pp |
| Scala di sei | 4,59% | 4,57% | +0,02 pp |

> I valori "euristica" vengono dal report principale (200k mani, media 2 seed).

## Lettura dei risultati — la conclusione importante

**Giocare in modo ottimale NON avvicina la distribuzione ai target del GDD.** Le
differenze rispetto all'euristica sono piccole (quasi tutte sotto ~1 pp):

- Il gioco ottimale spreme quasi zero "carta alta" (0,08% vs 0,67%): perfeziona sempre
  qualcosa. Riduce un po' le coppie "morte" e alza marginalmente full, quaterne e
  **le scale (+0,4 pp sulla scala di cinque)**.
- Ma **le scale restano intorno al 4,4%, non al 6%.** Anche col miglior gioco possibile
  non si arriva ai target del GDD.

### Perché è un risultato che conta

Fino a qui non sapevamo se le scale fossero rare per colpa del **bot** (strategia miope)
o per colpa delle **regole** (con 4 dadi + 1 rubato, le scale sono semplicemente
difficili). Questo report risolve il dubbio:

> Anche giocando **perfettamente**, le scale valgono ~4,4% e i full ~21%. Lo scostamento
> dai target del GDD (scale al 6%, full al 16,5%) è **strutturale delle regole**, non un
> difetto della strategia.

La ragione è combinatoria: con 4 dadi propri + 1 rubato fisso, per fare una scala servono
5 valori tutti distinti e consecutivi, mentre le combinazioni "a set" (coppie→tris→full)
si costruiscono molto più facilmente rerollando verso un valore ripetuto. Nessuna
strategia può ribaltare questa asimmetria: può solo limarla.

## Implicazioni

Se vogliamo davvero le scale al ~6% e i full al ~16,5%, non basta un bot più bravo:
bisogna **cambiare le regole o i target**. Opzioni da valutare in playtest:

- **Ricalibrare i target del GDD** su questa baseline (full ~21%, scale ~4,5%): forse
  è già un bilanciamento accettabile, e i numeri del GDD erano solo una stima ottimistica.
- **Rendere le scale più raggiungibili** — es. permettere di rubare più di un comune, o
  contare le scale con un valore "jolly", o dare un quinto dado proprio invece del rubato.
- **Aumentare il premio delle scale** (già data-driven in `STRAIGHT_PRIORITY`): se restano
  rare ma pagano tanto, l'equilibrio può funzionare comunque.

## Nota di metodo

Il solver è verificato dai test in [tests/optimal.test.ts](../tests/optimal.test.ts):
l'EV riportato coincide con un'enumerazione brute-force indipendente, e l'EV ottimale
è sempre ≥ di quello della scelta euristica sullo stesso spot (dominanza). Quindi questo
report è un limite superiore affidabile per il livello 1.
