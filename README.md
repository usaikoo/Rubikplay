# Muddle Puzzle

A browser colour-matching twisty cube (2×2 to 5×5) built with [Three.js](https://threejs.org/). No build step and no install: Three.js loads from the jsDelivr CDN through an import map.

## Run

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Play

- Drag on a sticker to turn that row or column
- Drag on the background to spin the cube; scroll or pinch to zoom
- Keys: `U D L R F B` turn a face clockwise, `Shift` + key turns it anticlockwise, `Ctrl/⌘+Z` undoes
- **Scramble** starts a game. The timer starts on your first move, and the best time for each size is saved in the browser.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page layout, HUD and dialogs, import map |
| `style.css` | UI styling (responsive down to phone width) |
| `main.js` | Scene setup, cube model, turn animation, drag and keyboard input, solve check |
# Rubikplay
