# probability-practice

**Marble Machine** is an interactive simulation of independent, dependent, mutually exclusive and not mutually exclusive events.

Marbles fall through two gates, and each door's width is its probability. Each marble lands at random, so counts vary from run to run around the probability.

- **Independent (A and B):** stacked gates with a shuffler between them, so passing A has no effect on B. Multiply. `0.5 × 0.5 = 0.25`
- **Dependent (A and B):** no shuffler, and Gate B is shifted so 40% lines up with Gate A. Multiply by P(B | A). `0.5 × 0.8 = 0.4`
- **Mutually exclusive (A or B):** two doors side by side in one wall. Add. `0.5 + 0.3 = 0.8`
- **Not mutually exclusive (A or B):** the doors overlap. Add, then subtract the overlap. `0.5 + 0.3 – 0.1 = 0.7`

## Run it

Open `index.html` in a browser. There is no build step, and it works offline.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | Page content and structure |
| `styles.css` | Visual design |
| `js/model.js` | Plans each run from the probabilities, with no DOM code |
| `js/machine.js` | Draws and animates a machine on a canvas |
| `js/explosions.js` | Optional full-screen explosions with fire, shake, and lasting damage that eventually breaks the machine. Off by default; the "your estimate" diamond in the legend is the hidden on/off checkbox, and unchecking it repairs everything |
| `js/scenarios.js` | Practice questions |
| `js/app.js` | Runs the sequence of screens and connects each to its machine |
| `tests/model.test.js` | Tests for the run planning |
| `tests/scenarios.test.js` | Checks every practice question: its math, its machine, and equal numbers of each kind |

## Test

Requires Node 18 or later:

```
node --test
```
