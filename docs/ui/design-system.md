# Trade Management Desk — Design System & UI Guidelines

## Semantic Token Reference

All UI colors are controlled through semantic CSS custom properties defined in `src/styles/utilities.css`.
**Never use raw color classes** (`bg-zinc-*`, `text-slate-*`, `border-zinc-*`, hex values) in component files.

### Surface Tokens (backgrounds)

| Tailwind Class | Purpose | Light | Dark (.dark-dashboard) |
|---|---|---|---|
| `bg-surface-page` | Page background | `#F7F9FC` | `#0a0a0a` |
| `bg-surface-section` | Section containers, grouped areas | `#FFFFFF` | `#0f0f0f` |
| `bg-surface-card` | Cards, panels, table rows | `#FFFFFF` | `#181818` |
| `bg-surface-chip` | Chips, tags, input backgrounds | `#EEF2F7` | `#262626` |
| `bg-surface-hover` | Hover state backgrounds | `#E2E8F0` | `#3f3f46` |
| `bg-surface-active` | Pressed / active state | `#CBD5E1` | `#52525b` |
| `bg-surface-primary-btn` | Primary button background | `#0B1220` | `#f4f4f5` |

### Text Tokens

| Tailwind Class | Purpose | Light | Dark |
|---|---|---|---|
| `text-heading` | Page titles, section headings | `#0B1220` | `#fafafa` |
| `text-strong` | Emphasized body, sub-headings, card titles | `#1E293B` | `#f4f4f5` |
| `text-body` | Normal body text, descriptions | `#334155` | `#e4e4e7` |
| `text-subtle` | Secondary info, less important text | `#475569` | `#d4d4d8` |
| `text-muted` | Labels, hints, placeholders | `#64748B` | `#a1a1aa` |
| `text-faint` | Disabled text, very subtle indicators | `#94A3B8` | `#71717a` |
| `text-on-primary-btn` | Text on primary buttons | `#FFFFFF` | `#18181b` |

### Border Tokens

> **Tailwind v4 naming note**: Border *color* utilities follow the pattern
> `border-{color-name}`. Since the CSS variables are `--color-border-*`,
> the correct utility classes are `border-border-*` (the first `border-`
> sets the border, the second `border-` is part of the color name).
> Writing `border-default` will **not** resolve — it looks for
> `--color-default` which does not exist, causing the border to fall back
> to `currentColor` (often near-white in dark mode).
>
> For **focus rings**, `ring-border-accent` is correct because `ring-*`
> also resolves via `--color-*`.

| Tailwind Class | Purpose | Light | Dark |
|---|---|---|---|
| `border-border-default` | Standard borders (cards, sections, dividers) | `#E2E8F0` | `#1F2A3A` |
| `border-border-strong` | Stronger / emphasized borders | `#CBD5E1` | `#2D3D52` |
| `border-border-accent` | Accent / interactive borders, focus rings | `#94A3B8` | `#4A5A70` |
| `border-border-subtle` | Very subtle borders (6% white opacity) | — | `rgba(255,255,255,0.06)` |
| `border-border-danger` | Danger/error borders | — | `#EF4444` |
| `border-border-success` | Success borders | — | `#22C55E` |
| `border-border-warning` | Warning borders | — | `#F59E0B` |

## Usage Guidelines

### Choosing the right surface level

Surfaces stack from darkest (page) to lightest (chip):

```
Page → Section → Card → Chip
```

- **Page**: The outermost background. Use for `<body>`, full-page containers.
- **Section**: Groups of related content within a page.
- **Card**: Individual items, table rows, panels.
- **Chip**: Small inline elements, tags, input fields within cards.

### Text hierarchy

Pick the text token that matches the content's importance:

```
Heading → Strong → Body → Subtle → Muted → Faint
```

- **Heading**: Reserve for `<h1>`, `<h2>`, page titles.
- **Strong**: Card titles, bold labels, sub-headings.
- **Body**: Default paragraph text, table cell values.
- **Subtle**: Secondary descriptions, metadata.
- **Muted**: Form labels, hints, timestamps.
- **Faint**: Disabled states, decorative text.

### Hover and interaction states

```tsx
// Background hover
className="bg-surface-card hover:bg-surface-hover"

// Text hover (brighten)
className="text-muted hover:text-strong"

// Border hover (strengthen)
className="border-border-default hover:border-border-accent"

// Active / pressed
className="bg-surface-hover active:bg-surface-active"
```

### Focus rings

```tsx
// Standard focus ring
className="focus:outline-none focus:ring-2 focus:ring-border-accent"

// With border change
className="focus:outline-none focus:ring-1 focus:ring-border-accent focus:border-border-accent"
```

### Buttons

**Primary button** (inverted contrast):
```tsx
<button className="bg-surface-primary-btn text-on-primary-btn hover:bg-surface-hover">
  Save
</button>
```

**Brand accent buttons** (purple) — use `accent-*` tokens:
```tsx
<button className="bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800">
  Add Trade
</button>
```

**Status accent buttons** (emerald, sky, etc.) — use status color tokens directly:
```tsx
<button className="bg-emerald-500 text-white hover:bg-emerald-600">
  Confirm
</button>
```

**Ghost / outline buttons**:
```tsx
<button className="border border-border-strong text-body hover:bg-surface-card">
  Cancel
</button>
```

## Theme Scoping

### `.dark-dashboard`
Applied to the main dashboard container. Overrides all semantic tokens to dark zinc equivalents.
All children automatically inherit dark colors through CSS custom properties.

### `.scheme-light`
Pins tokens to light-mode values even when nested inside `.dark-dashboard` or when the OS prefers dark mode.
Used on light overlays/modals (e.g. login card) that appear over the dark dashboard.

### `@media (prefers-color-scheme: dark)`
Responds to OS-level dark mode preference. Overrides the base `@theme` tokens with dark equivalents.
`.scheme-light` resets these back to light values.

## Layout Primitives

### Page Card

Every full-page view rendered inside the main content area **must** be wrapped in a page card. This provides consistent visual containment across all feature pages.

```
bg-bg-surface-1 rounded-2xl border border-border-default
```

Add `overflow-hidden` when the card contains tables or scrollable content. Add `p-6` (or `p-5`) for inner padding when content is not edge-to-edge.

Used in: `MapCSVPage`, `StructureDetailPage`, `ClientDashboardPage`, `AddClientPage`.

## Rules

1. **Never use raw color classes** in `.tsx` files: no `bg-zinc-*`, `text-slate-*`, `border-zinc-*`, or hex values.
2. **Always use semantic tokens**: `bg-surface-card`, `text-body`, `border-border-default`, etc. (note the double `border-` for border colors — see Border Tokens section).
3. **Accent colors are allowed**: `bg-emerald-*`, `text-rose-*`, `bg-sky-*`, `bg-accent-*`, etc. are intentionally NOT tokenized — they represent semantic meaning (success, error, info, brand) and don't change between themes. The `accent-*` tokens (`accent-300` through `accent-800`) are the brand purple used for branding, active nav states, and primary action buttons.
4. **`bg-white` is theme-aware**: It maps to `var(--color-surface-0)` via CSS override, so it works in both light and dark contexts.
5. **Add new tokens in `utilities.css`** if a use case doesn't fit existing ones. Define light default in `@theme`, override in `.dark-dashboard`, `.scheme-light`, and `@media (prefers-color-scheme: dark)`.

6. **No `dark:` prefix overrides**: The token system is dark-first. All semantic tokens already have dark values by default. Do **not** use `dark:text-*` or `dark:border-*` — just use the base semantic class. The `.scheme-light` class is the only mechanism for light overrides.

## File Reference

| File | Role |
|---|---|
| `src/styles/utilities.css` | Token definitions, theme overrides, type scale |
| `src/DashboardApp.tsx` | Main dashboard (uses `.dark-dashboard` scope) |
| `src/components/Sidebar.tsx` | Always-dark sidebar (inherits dark-first semantic tokens) |
| `src/components/DashboardHeader.tsx` | Top header bar with nav arrows, title, portfolio greeks |
| `src/components/ExpiryDatePicker.tsx` | Horizontal expiry chip selector |
| `src/components/ViewSelector.tsx` | Table / Kanban / Gantt pill toggle + search input |
| `src/components/KanbanBoard.tsx` | Kanban lane board (4 lanes: New / Near Profit / Near Loss / Near DTE) |
| `src/components/PositionRow.tsx` | Table row for positions |
| `src/components/PlaybookDrawer.tsx` | Slide-out drawer for program playbook details |
| `src/components/TradeJsonExportOverlay.tsx` | Overlay for exporting trade JSON |
| `src/components/ReviewOverlay.tsx` | Review overlay for structure creation |
| `src/components/StructureEntryOverlay.tsx` | Overlay for creating/editing structures |
| `src/components/ui/Button.tsx` | Shared button primitive |
| `src/components/ui/Surface.tsx` | Shared surface card primitive |
| `src/components/ui/Modal.tsx` | Shared modal primitive |
| `src/components/ui/Sheet.tsx` | Shared slide-out sheet primitive |
| `src/components/ui/Input.tsx` | Shared input primitive |
| `src/components/ui/IconButton.tsx` | Shared icon button primitive |
| `src/components/ui/Kbd.tsx` | Keyboard shortcut badge |
| `src/components/ui/Chip.tsx` | Chip / tag component |
| `src/features/auth/SupabaseLogin.tsx` | Login form (uses `.scheme-light` scope) |
