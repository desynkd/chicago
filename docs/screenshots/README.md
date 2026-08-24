# Screenshots

The three PNGs in this folder are **rendered**, not captured from a running
vault. They come from the design workbench built for the M8/M9 styling pass,
which loads the shipped [`styles.css`](../../styles.css) verbatim over markup
matching what [`board-view.ts`](../../src/view/board-view.ts) builds, rendered
headless in Chrome at 2× on a 900px pane with Obsidian's default dark theme
tokens and Inter.

| File | What it shows |
|---|---|
| `board.png` | The whole dashboard. Three active cards two-up, a populated ideas inbox, and Suspended grouped under Home / Writing / Uncategorised. |
| `wip-limit.png` | The refusal. Limit at 3, three active, a fourth activation rejected, with the notice on screen. |
| `inbox-triage.png` | The ideas inbox with a row's menu open on Promote and Discard. |

## What is real and what is reconstructed

Everything inside the board — every surface, radius, dot, pill and hairline —
is the real stylesheet resolving against real theme variables. Nothing about
the board itself is drawn by hand.

Two pieces are **not** the real thing, because the plugin does not render them:

- The refusal in `wip-limit.png` is an Obsidian `Notice`
  ([`board-view.ts:369`](../../src/view/board-view.ts#L369)), a toast Obsidian
  draws at the top-right of the window, outside the plugin's pane entirely.
- The Promote / Discard popup in `inbox-triage.png` is an Obsidian `Menu`
  ([`board-view.ts:176`](../../src/view/board-view.ts#L176)), styled by
  Obsidian's own `.menu` CSS, which is not in this repository.

Both were rebuilt in the harness from Obsidian's default token values. The
message text and the menu items are exactly what the code produces, but the
padding, radius, border and shadow around them are approximations. They will
be close, not pixel-exact, and a future Obsidian restyle will not carry into
them. If either ever needs to be exact, recapture that one from a real vault
and drop it in place — the filenames are what the main README links by.
