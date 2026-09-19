# Design Brief

## Direction

**Field Ledger** — a campaign-map command table: weathered parchment documents and riveted iron HUD plates laid over a living, earthy battlefield.

## Tone

Gritty, grounded, industrial-utilitarian — the visual language of a quartermaster's field ledger rather than a glossy fantasy interface; every surface looks handled, stained, and load-bearing.

## Differentiation

The HUD is rendered as **riveted iron plate over parchment grain** — real inset/outset shadows, stencil lettering, and hairline hatching — so the overlay reads as physical campaign furniture instead of floating glass panels.

## Color Palette

| Token      | OKLCH (dark)  | Role                                     |
| ---------- | ------------- | ---------------------------------------- |
| background | 0.155 0.016 58 | Sooty earth — the world behind the canvas |
| foreground | 0.925 0.014 78 | Lamplit parchment text                    |
| card       | 0.205 0.02 58  | Raised panel / dossier surface            |
| primary    | 0.735 0.135 78 | Ochre pigment — commands, active states   |
| accent     | 0.735 0.135 78 | Same ochre, used sparingly                |
| muted      | 0.265 0.024 58 | Recessed wells, disabled chrome           |

| Domain token   | OKLCH (dark)   | Role                                  |
| -------------- | -------------- | ------------------------------------- |
| resource-food  | 0.755 0.13 128 | Food — moss/crop green                |
| resource-wood  | 0.615 0.105 58 | Wood — umber bark                     |
| resource-gold  | 0.8 0.15 88    | Gold — burnished brass                |
| resource-stone | 0.68 0.02 250  | Stone — cold granite blue-grey        |
| resource-money | 0.71 0.11 168  | Money — verdigris coin                |
| resource-energy| 0.745 0.165 305| Energy — arcane violet flux           |
| faction-1      | 0.575 0.19 28  | Ember Legion banner — dried blood     |
| faction-2      | 0.585 0.13 232 | Tide Concord banner — deep indigo     |
| faction-3      | 0.625 0.14 142 | Verdant Pact banner — moss green      |
| health-full    | 0.63 0.155 142 | Full health                           |
| health-mid     | 0.755 0.145 78 | Wounded (amber)                       |
| health-low     | 0.565 0.19 28  | Critical (dried blood)                |
| selection      | 0.835 0.14 92  | Selection ring — lamplight gold       |
| valid          | 0.72 0.155 145 | Valid placement / green ghost         |
| invalid        | 0.6 0.2 28     | Invalid placement / red ghost         |
| rally          | 0.745 0.135 200| Rally point & move marker             |

## Typography

- Display: **Fraunces** — headings, faction names, age titles, game-over result; tight tracking, high optical weight
- Body: **Satoshi** — labels, tooltips, descriptions, menu copy
- Mono: **JetBrains Mono** — resource counts, clock, population, hotkeys, stencil labels
- Scale: hero `text-5xl md:text-7xl font-display font-semibold tracking-tight`, h2 `text-2xl md:text-3xl font-display font-semibold`, label `label-stencil text-[11px]`, body `text-sm md:text-base`

## Elevation & Depth

Depth is physical, never glowy: recessed wells (`shadow-inset-plate`), raised plates (`shadow-elevated`), and a hard 1px top highlight plus 1px bottom shade on every bar and button — no blur-heavy drop shadows, no neon.

## Structural Zones

| Zone            | Background                        | Border                          | Notes                                                                 |
| --------------- | --------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| Game canvas     | `bg-background` + terrain swatches| —                               | Full-viewport; canvas draws with literal terrain tokens              |
| Top HUD bar     | `bg-gradient-hud` + `texture-hud` | `border-b border-hud-border`    | Resources, clock, age, population; mono numerals, 36–44px tall        |
| Bottom command  | `panel-iron` + `texture-hud`      | `border-t border-hud-border`    | Selection portrait, unit grid, stance + order buttons                 |
| Side panels     | `panel-iron`                      | `border border-hud-border`      | Minimap, objectives, event log; collapsible                          |
| Menus / dialogs | `panel-parchment` + `texture-grain`| `border border-border`         | New Skirmish, faction select, game-over; ink-on-parchment            |
| Notifications   | `panel-iron` + `texture-hatch`    | `border-l-2 border-hud-accent`  | Attack / construction / age-up events; slide in, auto-dismiss         |

## Spacing & Rhythm

Dense and utilitarian: 4px base unit, 8px panel padding, 12px control gaps, 2px hairline separators between HUD rows; information is packed tight and separated by rules, not whitespace.

## Component Patterns

- Buttons: near-square (`rounded-sm`, 4px), iron plate with 1px top highlight, ochre fill only for the primary action, `active:translate-y-px` press
- Cards: `rounded-sm` parchment or iron panels with hairline borders and inset top light; never pill-shaped, never glassy
- Badges: rectangular stencil chips — faction banner swatch + mono label, `rounded-[2px]`, uppercase 0.18em tracking
- Bars: 6–8px tall recessed tracks; health switches full→mid→low color by threshold; resource bars use their own accent

## Motion

- Entrance: panels fade + 4px rise over 180ms ease-out; menus settle with a single 220ms fade, no bounce
- Hover: 120ms color/edge shift only; press states translate 1px down
- Decorative: `pulse-ring` on selected units, `order-ping` on move/attack markers, `hit-flash` on damage, `ember-rise` on burning structures, `alert-sweep` on under-attack banners

## Constraints

- Never use raw hex/rgb in components — only semantic tokens; canvas code may use literal terrain values
- HUD text must stay legible over any terrain: pair dark plates with `text-hud-foreground`, min 4.5:1
- Faction banner colors must remain distinguishable at minimap scale and under color-vision deficiency
- Keep radii at 2–6px; anything rounder breaks the period-industrial tone
- No gradients as full-page backgrounds and no glow/neon shadows

## Signature Detail

**Riveted iron plate over parchment grain** — every HUD surface carries an inset top highlight, hard bottom shade, and hairline hatch texture, so the interface feels hammered together rather than drawn.
