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

| Tailwind Class | Purpose | Light | Dark |
|---|---|---|---|
| `border-default` | Standard borders (cards, sections, dividers) | `#E2E8F0` | `#27272a` |
| `border-strong` | Stronger / emphasized borders | `#CBD5E1` | `#3f3f46` |
| `border-accent` | Accent / interactive borders, focus rings | `#94A3B8` | `#52525b` |

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
className="border-default hover:border-accent"

// Active / pressed
className="bg-surface-hover active:bg-surface-active"
```

### Focus rings

```tsx
// Standard focus ring
className="focus:outline-none focus:ring-2 focus:ring-border-accent"

// With border change
className="focus:outline-none focus:ring-1 focus:ring-border-accent focus:border-accent"
```

### Buttons

**Primary button** (inverted contrast):
```tsx
<button className="bg-surface-primary-btn text-on-primary-btn hover:bg-surface-hover">
  Save
</button>
```

**Accent buttons** (emerald, sky, etc.) — use accent color tokens directly:
```tsx
<button className="bg-emerald-500 text-white hover:bg-emerald-600">
  Add Trade
</button>
```

**Ghost / outline buttons**:
```tsx
<button className="border border-strong text-body hover:bg-surface-card">
  Cancel
</button>
```

## Theme Scoping

### `.dark-dashboard`
Applied to the main dashboard container. Overrides all semantic tokens to dark zinc equivalents.
All children automatically inherit dark colors through CSS custom properties.

### `.scheme-light`
Pins tokens to light-mode values even when nested inside `.dark-dashboard` or when the OS prefers dark mode.
Used on the sidebar (`<aside class="scheme-light">`) and light overlays/modals that appear over the dark dashboard.

### `@media (prefers-color-scheme: dark)`
Responds to OS-level dark mode preference. Overrides the base `@theme` tokens with dark equivalents.
`.scheme-light` resets these back to light values.

## Rules

1. **Never use raw color classes** in `.tsx` files: no `bg-zinc-*`, `text-slate-*`, `border-zinc-*`, or hex values.
2. **Always use semantic tokens**: `bg-surface-card`, `text-body`, `border-default`, etc.
3. **Accent colors are allowed**: `bg-emerald-*`, `text-rose-*`, `bg-sky-*`, etc. are intentionally NOT tokenized — they represent semantic meaning (success, error, info) and don't change between themes.
4. **`bg-white` is theme-aware**: It maps to `var(--color-surface-0)` via CSS override, so it works in both light and dark contexts.
5. **Add new tokens in `utilities.css`** if a use case doesn't fit existing ones. Define light default in `@theme`, override in `.dark-dashboard`, `.scheme-light`, and `@media (prefers-color-scheme: dark)`.

## File Reference

| File | Role |
|---|---|
| `src/styles/utilities.css` | Token definitions, theme overrides, type scale |
| `src/DashboardApp.tsx` | Main dashboard (uses `.dark-dashboard` scope) |
| `src/components/Sidebar.tsx` | Always-dark sidebar (uses `.scheme-light` to pin light slate tokens) |
| `src/components/StructureEntryOverlay.tsx` | Light overlay within dark dashboard |
