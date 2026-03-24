# UI Components

Isolated component dev in `ui/`, not yet wired into the main app.

## Toggle Group (`toggle-buttons.html`)

### Parts
- **toggle group** — container (`.toggle-group`). Holds a caption + a row of buttons.
- **toggle button** — individual on/off button (`.toggle-btn`). Depresses visually when on.
- **caption** — label above the button row (`.toggle-group-caption`). Optional.

### Modes
- **multi-select** (`exclusive: false`, default) — any combination of buttons can be on. Replaces checkboxes.
- **single-select** (`exclusive: true`) — only one button on at a time. Replaces radio buttons.
- **allowNone** (`allowNone: true`) — in single-select, clicking the active button deselects it.

### Styling
- Buttons in a group share borders with rounding only on the ends.
- Active button uses inset shadow (physically depressed look) + accent border.
- Uses app color variables (`--accent`, `--dim`, `--text`, etc.)

### JS API
```js
const group = createToggleGroup(container, {
  exclusive,   // boolean
  allowNone,   // boolean (only with exclusive)
  caption,     // string, optional
  buttons,     // [{ label, value?, on? }]
  onChange,     // (value, isOn, allActiveValues) => void
});

group.getValues()        // string[] of active values
group.setValue(val, on)   // programmatic set
group.getButtons()       // button DOM elements
```

## Rotate Control (`rotate-control.html`)

### Parts
- **dial** — the barrel-shaped canvas element (`.dial-wrap`). Draggable left/right to change angle.
- **tick** — foreshortened lines on the dial surface. Bunched at edges, spaced at center (cylindrical projection).
- **barrel outline** — curved border that narrows toward the edges, following the same cosine foreshortening as the ticks.
- **readout** — label below the dial (`.angle-readout`). Shows "Rotate" at rest, angle in degrees while dragging.
