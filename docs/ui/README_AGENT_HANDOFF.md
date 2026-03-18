# Standardized UI Framework Handoff

## Purpose
This pack defines a shared UI framework for the Structure Management Dashboard style shown in the screenshots. It is meant to be given directly to an AI coding agent so the agent can implement a consistent design system across the web app without re-inventing styles screen by screen.

This handoff is intentionally opinionated. The goal is consistency first, customization second.

## Important implementation constraint
The current repo already runs on **React 18 + Vite + Tailwind CSS 3**, and already uses **CSS-variable backed theme tokens** in Tailwind plus `lucide-react` and `recharts`. The cleanest path is to **extend the existing token pattern instead of replacing it**. The repo already maps Tailwind colors to CSS variables and already uses variable-based radius tokens, so the new framework should preserve that architecture rather than introducing a second theming system. Existing grid/card usage also matches that direction. See `package.json`, `tailwind.config.ts`, `src/index.css`, `src/theme/tokens.tsx`, `src/components/ui/KpiGroupsGrid.tsx`, `src/components/ui/KpiCard.tsx`, and `src/components/ui/ControlsBar.tsx` for the current baseline. 

---

## 1) Visual language distilled from screenshots

### Brand character
- Dark-first, premium, architectural, slightly futuristic.
- Surfaces are almost black, not pure gray.
- Purple is the primary action and focus color.
- Cards are soft, rounded, dense, and layered.
- Borders are subtle and more important than hard shadows.
- The interface mixes dashboard density with product polish.

### Core composition patterns
- Left navigation rail is persistent.
- Contextual page header is slim and horizontal.
- Filters/search/date chips sit above the main content.
- Main content alternates between:
  - tables
  - kanban columns
  - gantt timelines
  - map/object canvases
  - summary cards
- Right-side profile/detail sheets are a repeated pattern.
- Pills, chips, badges, and segmented controls are foundational.

### What should feel consistent everywhere
- All screens must feel like one product line.
- All surfaces must come from the same token set.
- All spacing must use the same spacing scale.
- All typography must come from the same text roles.
- All interactive states must use the same rules for hover/focus/selected/disabled.

---

## 2) Non-negotiable framework rules

1. **Do not hardcode colors inside components.** Use semantic tokens only.
2. **Do not use one-off border radii.** Use the shared radius scale.
3. **Do not create per-screen spacing systems.** Use the shared spacing scale.
4. **Do not style components from page files.** Page files compose primitives; primitives own their visuals.
5. **Do not create multiple button, chip, or card patterns.** Shared components must absorb variations.
6. **Do not invent local text sizes.** Use typography roles only.
7. **Prefer semantic tokens over raw palette tokens in components.** Example: `text.primary`, not `purple.500`.
8. **Selection and focus must always be communicated with the accent system.**
9. **Dense data views still need a minimum tap target of 36px.**
10. **Any new screen must be built only from the shared primitives below unless there is a compelling reason not to.**

---

## 3) Recommended file structure

```text
src/
  design/
    tokens/
      color.ts
      spacing.ts
      radius.ts
      shadow.ts
      motion.ts
      typography.ts
      zIndex.ts
      componentSizing.ts
    theme.css
    theme.ts
    tailwind-preset.ts
    utils.ts
  components/
    ui/
      primitives/
        Button.tsx
        IconButton.tsx
        Surface.tsx
        Card.tsx
        Input.tsx
        SearchInput.tsx
        Select.tsx
        SegmentedControl.tsx
        Tabs.tsx
        Badge.tsx
        StatusBadge.tsx
        Chip.tsx
        Pill.tsx
        Avatar.tsx
        SidebarItem.tsx
        Topbar.tsx
        Sheet.tsx
        Modal.tsx
        Tooltip.tsx
        EmptyState.tsx
        Skeleton.tsx
        Divider.tsx
        Kbd.tsx
      patterns/
        AppShell.tsx
        PageHeader.tsx
        FilterBar.tsx
        DataTable.tsx
        KanbanBoard.tsx
        GanttTimeline.tsx
        DetailPanel.tsx
        ObjectCanvas.tsx
        CalendarStrip.tsx
        StatsCard.tsx
        MetricCard.tsx
        PlannerCard.tsx
```

---

## 4) Design tokens

### 4.1 Semantic color system
Use these token names in components. Raw palette values exist only in the theme layer.

#### Background and surfaces
- `bg.canvas`
- `bg.canvasElevated`
- `bg.surface.1`
- `bg.surface.2`
- `bg.surface.3`
- `bg.surface.4`
- `bg.overlay`
- `bg.inverse`

#### Borders
- `border.subtle`
- `border.default`
- `border.strong`
- `border.accent`
- `border.danger`
- `border.success`
- `border.warning`

#### Text
- `text.primary`
- `text.secondary`
- `text.tertiary`
- `text.disabled`
- `text.inverse`
- `text.accent`
- `text.success`
- `text.warning`
- `text.danger`

#### Accent/action
- `accent.300`
- `accent.400`
- `accent.500`
- `accent.600`
- `accent.700`
- `accent.glow`

#### Status
- `status.success`
- `status.warning`
- `status.danger`
- `status.info`
- `status.waiting`
- `status.approved`
- `status.active`
- `status.completed`
- `status.occupied`
- `status.available`

### 4.2 Suggested palette derived from screenshots
These values are inferred from the visuals and should be treated as the first-pass standard.

```json
{
  "raw": {
    "black": "#050505",
    "neutral-950": "#0A0A0B",
    "neutral-925": "#101013",
    "neutral-900": "#141418",
    "neutral-850": "#1A1A20",
    "neutral-800": "#202029",
    "neutral-750": "#262631",
    "neutral-700": "#2E2E3A",
    "neutral-600": "#4A4A59",
    "neutral-500": "#6C6C7C",
    "neutral-400": "#9696A6",
    "neutral-300": "#B7B7C5",
    "neutral-200": "#D7D7E2",
    "neutral-100": "#F4F4F8",

    "purple-300": "#B895FF",
    "purple-400": "#A16EFF",
    "purple-500": "#8B5CF6",
    "purple-600": "#7C3AED",
    "purple-700": "#6D28D9",
    "purple-800": "#5A1FC7",

    "green-500": "#22C55E",
    "amber-500": "#F59E0B",
    "red-500": "#EF4444",
    "sky-500": "#38BDF8",
    "pink-500": "#EC4899"
  },
  "semantic": {
    "bg.canvas": "#050505",
    "bg.canvasElevated": "#0A0A0B",
    "bg.surface.1": "#101013",
    "bg.surface.2": "#141418",
    "bg.surface.3": "#1A1A20",
    "bg.surface.4": "#202029",
    "bg.overlay": "rgba(5, 5, 5, 0.78)",
    "bg.inverse": "#F4F4F8",

    "border.subtle": "rgba(255, 255, 255, 0.06)",
    "border.default": "rgba(255, 255, 255, 0.10)",
    "border.strong": "rgba(255, 255, 255, 0.18)",
    "border.accent": "#8B5CF6",

    "text.primary": "#F4F4F8",
    "text.secondary": "#B7B7C5",
    "text.tertiary": "#8A8A98",
    "text.disabled": "#626270",
    "text.inverse": "#101013",
    "text.accent": "#A16EFF",

    "accent.300": "#B895FF",
    "accent.400": "#A16EFF",
    "accent.500": "#8B5CF6",
    "accent.600": "#7C3AED",
    "accent.700": "#6D28D9",
    "accent.glow": "rgba(139, 92, 246, 0.36)",

    "status.success": "#22C55E",
    "status.warning": "#F59E0B",
    "status.danger": "#EF4444",
    "status.info": "#38BDF8",
    "status.waiting": "#8B5CF6",
    "status.approved": "#F59E0B",
    "status.active": "#22C55E",
    "status.completed": "#6C6C7C",
    "status.occupied": "#6C6C7C",
    "status.available": "#22C55E"
  }
}
```

### 4.3 Typography scale
The screenshots already show the intended scale. Use it.

```json
{
  "fontFamily": {
    "sans": "Inter, SF Pro Display, ui-sans-serif, system-ui, sans-serif",
    "mono": "ui-monospace, SFMono-Regular, Menlo, monospace"
  },
  "fontWeight": {
    "medium": 500,
    "semibold": 600,
    "bold": 700
  },
  "textStyles": {
    "display.l": { "fontSize": 40, "lineHeight": 44, "fontWeight": 700, "letterSpacing": -0.03 },
    "display.m": { "fontSize": 32, "lineHeight": 36, "fontWeight": 700, "letterSpacing": -0.025 },
    "title.l":   { "fontSize": 24, "lineHeight": 30, "fontWeight": 600, "letterSpacing": -0.02 },
    "title.m":   { "fontSize": 20, "lineHeight": 26, "fontWeight": 600, "letterSpacing": -0.015 },
    "headline":  { "fontSize": 16, "lineHeight": 22, "fontWeight": 600, "letterSpacing": -0.01 },
    "body":      { "fontSize": 14, "lineHeight": 20, "fontWeight": 500, "letterSpacing": -0.005 },
    "subhead":   { "fontSize": 14, "lineHeight": 18, "fontWeight": 500, "letterSpacing": 0 },
    "caption":   { "fontSize": 12, "lineHeight": 16, "fontWeight": 500, "letterSpacing": 0.01 },
    "micro":     { "fontSize": 11, "lineHeight": 14, "fontWeight": 500, "letterSpacing": 0.015 }
  }
}
```

#### Text role rules
- Page title: `display.m`
- Modal title / big card title: `title.l`
- Section title: `title.m`
- Table header / field label: `caption` or `micro`
- Primary data label: `headline`
- Standard body copy: `body`
- Secondary metadata: `caption`
- Numbers in finance/KPI/table columns: `body` or `headline` with tabular numerals

### 4.4 Spacing scale
Use a 4px base.

```json
{
  "0": 0,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "10": 40,
  "12": 48,
  "14": 56,
  "16": 64,
  "20": 80,
  "24": 96
}
```

### 4.5 Radius scale

```json
{
  "xs": 8,
  "sm": 10,
  "md": 12,
  "lg": 16,
  "xl": 20,
  "2xl": 24,
  "pill": 999,
  "round": 9999
}
```

### 4.6 Shadow + glow system
The screenshots rely more on borders and glow than heavy drop shadows.

```json
{
  "shadow.none": "none",
  "shadow.soft": "0 8px 24px rgba(0, 0, 0, 0.22)",
  "shadow.card": "0 0 0 1px rgba(255,255,255,0.05), 0 10px 30px rgba(0,0,0,0.22)",
  "shadow.overlay": "0 24px 80px rgba(0,0,0,0.5)",
  "glow.accent.sm": "0 0 0 1px rgba(139,92,246,0.85), 0 0 0 4px rgba(139,92,246,0.12)",
  "glow.accent.md": "0 0 0 1px rgba(139,92,246,0.9), 0 0 18px rgba(139,92,246,0.28)",
  "glow.accent.lg": "0 0 0 1px rgba(139,92,246,0.9), 0 0 28px rgba(139,92,246,0.32)"
}
```

### 4.7 Motion
Keep motion restrained and product-like.

```json
{
  "duration.fast": 120,
  "duration.normal": 180,
  "duration.slow": 260,
  "easing.standard": "cubic-bezier(0.2, 0, 0, 1)",
  "easing.emphasized": "cubic-bezier(0.2, 0, 0, 1.05)"
}
```

---

## 5) Layout system

### 5.1 App shell
- Left rail width: **72px** collapsed icon rail.
- Optional secondary sidebar width: **240px to 280px**.
- Top utility/header bar height: **64px**.
- Page content padding: **24px desktop**, **16px tablet**, **12px mobile**.
- Max content width: avoid a narrow website max-width; this is an application. Use full-width with internal grids.

### 5.2 Grid rules
- Core content grid: **12 columns**, 24px gaps on desktop.
- Card grid minimum width: **280px**.
- Dense dashboard grid: `repeat(auto-fit, minmax(280px, 1fr))`.
- Table + side panel layouts: `minmax(0, 1fr) 360px` or `minmax(0, 1fr) 420px`.
- Mobile: stack to one column.

### 5.3 Standard content zones
1. **Page header**
   - title left
   - contextual actions right
2. **Filter row**
   - search
   - date range
   - view switcher
   - secondary filters
3. **Primary content**
   - table / kanban / gantt / canvas / dashboard cards
4. **Secondary detail panel**
   - right sheet, fixed panel, or modal depending on density

---

## 6) Component inventory to standardize

### 6.1 Foundational primitives

#### `Button`
Variants:
- `primary`
- `secondary`
- `ghost`
- `danger`
- `success`
- `link`

Sizes:
- `sm` = 32px
- `md` = 40px
- `lg` = 48px

Rules:
- Primary button uses accent fill.
- Secondary uses raised surface + border.
- Ghost uses transparent background.
- Disabled opacity = 0.45 and cursor not-allowed.

#### `IconButton`
Variants:
- `neutral`
- `accent`
- `ghost`

Sizes:
- `32`, `36`, `40`

#### `Surface`
Variants:
- `base`
- `raised`
- `elevated`
- `interactive`
- `selected`

#### `Card`
Variants:
- `default`
- `interactive`
- `metric`
- `panel`
- `kanban`
- `sheetSection`

#### `Input`
States:
- default
- hover
- focus
- invalid
- disabled

#### `SearchInput`
- left search icon
- clear button optional
- compact and default heights

#### `Select` / `Combobox`
- same visual shell as input
- option list uses the same surface tokens as sheets

#### `SegmentedControl`
- used for `Table / Kanban / Gantt`
- also used for `Standard / Resources`
- selected segment gets accent border or accent fill depending on density

#### `Tabs`
- underline-less pill tabs for product style
- active state uses surface contrast + accent text or border

#### `Badge`
Types:
- neutral
- accent
- success
- warning
- danger
- info

#### `StatusBadge`
Statuses:
- waiting
- approved
- active
- cancelled
- completed
- occupied
- available

#### `Chip`
- filter chip
- date chip
- tag chip
- removable chip

#### `Avatar`
- image
- initials
- presence dot optional

#### `Divider`
- subtle only

#### `Sheet`
Variants:
- right detail panel
- left object picker
- centered floating panel on smaller screens

#### `Modal`
- for blocking flows only

#### `Tooltip`
- small dark floating helper with 10–12px text

#### `Skeleton`
- pulse shimmer minimal; do not use bright skeletons

### 6.2 Product patterns

#### `AppShell`
Contains:
- rail nav
- optional secondary tree/sidebar
- top header
- page container
- optional right detail panel slot

#### `PageHeader`
Contains:
- title
- subtitle optional
- breadcrumb optional
- primary action slot
- secondary action slot

#### `FilterBar`
Contains:
- search
- date range
- segmented view switcher
- dropdown filters
- location selector

#### `DataTable`
Capabilities:
- sticky header optional
- sortable columns
- row hover
- row selection
- status tags
- trailing actions menu
- compact and comfortable density

#### `KanbanBoard`
Capabilities:
- column header
- count badge
- card slots
- overflow handling
- horizontal scroll on smaller widths

#### `GanttTimeline`
Capabilities:
- grouped rows
- hourly scale
- event bars
- striped/blocked segments
- pinned left object column

#### `DetailPanel`
Used for:
- object profile
- booking details
- application details
- storage file preview metadata

#### `ObjectCanvas`
Used for:
- seating/floor plan views
- object state visualization
- selectable nodes/shapes
- right-side linked detail panel

#### `CalendarStrip`
Used for:
- top date scroller with day chips
- active day outlined or filled with accent

#### `MetricCard`
Used for:
- workload
- finance summaries
- small trend cards
- KPI cards

---

## 7) Detailed component behavior spec

### 7.1 Buttons

#### Primary button
- Background: `accent.500`
- Text: `text.primary`
- Hover: `accent.600`
- Active: `accent.700`
- Focus ring: accent glow
- Radius: `xl`
- Height: 40px default
- Horizontal padding: 16px

#### Secondary button
- Background: `bg.surface.3`
- Border: `border.default`
- Text: `text.primary`
- Hover: `bg.surface.4`

#### Ghost button
- Background: transparent
- Hover: `bg.surface.2`

### 7.2 Inputs
- Height: 44px default, 36px compact
- Background: `bg.surface.2`
- Border: `border.default`
- Placeholder: `text.tertiary`
- Focus: accent border + glow, never browser default blue ring
- Icons use `text.tertiary`

### 7.3 Cards

#### Default card
- Background: `bg.surface.1`
- Border: `border.subtle`
- Radius: `2xl`
- Padding: 20px desktop, 16px compact

#### Interactive card
- Hover: raise to `bg.surface.2`
- Border becomes `border.default`
- Cursor pointer

#### Selected card
- Border: accent
- Glow: `glow.accent.sm`
- Background stays dark; do not flood entire card with bright purple unless it is an object tile

### 7.4 Status badges
Status badges must be consistent across tables, kanban, detail panels, and object maps.

Suggested mapping:
- waiting = purple tint background + purple text
- approved = amber tint background + amber text
- active = green tint background + green text
- cancelled = red tint background + red text
- completed = neutral tint background + muted text
- available = green tint background + green text
- occupied = neutral tint background + muted text

### 7.5 Tables
- Header row height: 44px
- Data row height: 52px default, 44px compact
- Header text: uppercase caption or micro style with increased tracking
- Row hover: `bg.surface.2`
- Selected row: accent border overlay or tinted surface
- Numeric columns use tabular numerals
- Do not use heavy zebra striping

### 7.6 Kanban cards
- Card radius: `xl`
- Padding: 16px
- Top metadata first, main entity second, date/time third, chips at bottom
- Max 3 visible chips then `+N`

### 7.7 Gantt bars
- Bar radius: `md`
- Default bar background: `bg.surface.4`
- Active/important bars can use accent tint
- Labels must stay readable at small widths

### 7.8 Sheets and panels
- Width: 360px standard, 420px large
- Background: `bg.surface.1`
- Border-left: `border.default`
- Internal sections separated by subtle dividers
- CTA pinned to bottom when appropriate

### 7.9 Object map tiles
Used in floor plans, restaurant maps, coworking maps.
- Default state: dark tile, muted label
- Hover: slightly brighter surface
- Selected: accent fill or accent border depending on object type
- Occupied objects can show timer + price pills inside the tile
- Tile shapes may vary, but label and metadata styling must remain standard

---

## 8) Standard sizes

### Control heights
- `control.sm` = 32px
- `control.md` = 40px
- `control.lg` = 48px
- `input.default` = 44px
- `header.bar` = 64px

### Common panel/card paddings
- compact card = 16px
- standard card = 20px
- large sheet section = 24px

### Icon sizes
- xs = 14px
- sm = 16px
- md = 18px
- lg = 20px
- xl = 24px

---

## 9) Accessibility rules

- Minimum body text contrast must meet AA.
- Accent-on-dark text must still be readable; use accent text mainly for emphasis, not full paragraphs.
- Focus styles must be visible on keyboard navigation.
- Icon-only buttons require `aria-label`.
- Do not communicate status by color alone; every status needs text.
- Dense screens still need 36px minimum interactive target sizes.

---

## 10) Tailwind integration strategy

The repo already has Tailwind colors bound to CSS variables and radius tokens bound in `tailwind.config.ts`. Keep that pattern and expand it.

### Required implementation approach
1. Move from the small current token set to a fuller semantic token map.
2. Keep CSS custom properties as the source of truth.
3. Extend Tailwind so utilities point to semantic tokens.
4. Create reusable primitives first.
5. Migrate screens to primitives after the primitives are stable.

### Add these semantic groups to Tailwind
- background
- surface levels
- text roles
- border roles
- accent levels
- status colors
- shadow aliases
- radius aliases

---

## 11) Screen-by-screen composition guidance

### Dashboard / home
Use:
- `AppShell`
- `PageHeader`
- responsive metric card grid
- chart card
- planner/task card
- data table card
- calendar card

### Applications / booking table
Use:
- `PageHeader`
- `CalendarStrip`
- `SegmentedControl`
- `FilterBar`
- `DataTable`

### Booking requests / kanban
Use:
- `PageHeader`
- `CalendarStrip`
- `SegmentedControl`
- `FilterBar`
- `KanbanBoard`

### Gantt planning
Use:
- `PageHeader`
- `CalendarStrip`
- `SegmentedControl`
- `FilterBar`
- `GanttTimeline`

### Objects picker / library
Use:
- `Sheet`
- `Tabs`
- `SearchInput`
- grouped grid of `Card interactive selectable`

### Floor/object map with detail panel
Use:
- `AppShell`
- `ObjectCanvas`
- `DetailPanel`
- shared object tile states

### Storage / files
Use:
- `AppShell`
- secondary sidebar tree
- header action cluster
- folder cards
- data table with file icons and actions menu

---

## 12) Migration order for the AI agent

### Phase 1: Foundation
- Add theme tokens
- Add Tailwind semantic mapping
- Add typography utilities
- Add spacing/radius/shadow utilities

### Phase 2: Primitives
- Button
- IconButton
- Input / SearchInput
- Badge / StatusBadge / Chip
- Surface / Card
- Sheet / Modal / Tabs / SegmentedControl

### Phase 3: Patterns
- AppShell
- PageHeader
- FilterBar
- DataTable
- DetailPanel

### Phase 4: High-complexity modules
- KanbanBoard
- GanttTimeline
- ObjectCanvas
- CalendarStrip

### Phase 5: Screen migration
- dashboard
- applications table
- requests kanban
- gantt
- object map
- storage

---

## 13) Acceptance criteria

A migration is done only if all of the below are true:

- No hardcoded hex colors remain in screen components.
- No ad hoc border-radius values remain in screen components.
- Buttons, chips, badges, and cards are reused instead of copied.
- Table, kanban, gantt, and detail-panel screens feel visually related.
- Search fields and filter bars look identical across modules.
- Selected states always use the same accent logic.
- Hover and focus states are consistent across components.
- Typography roles are consistent across all screens.
- Dark mode looks intentional, not inverted.
- The UI is responsive down to tablet width.

---

## 14) Copy-paste prompt for the AI coding agent

```md
You are integrating a standardized UI framework into an existing React + Vite + Tailwind web app.

Use the attached UI framework handoff as the source of truth.

Rules:
1. Preserve the existing React + Tailwind + CSS-variable theming architecture.
2. Do not introduce a second styling system.
3. Do not hardcode colors, spacing, radii, or text sizes inside product screens.
4. First implement tokens and shared primitives.
5. Then refactor screens to consume those primitives.
6. Prefer semantic design tokens over raw colors.
7. Keep the app dark-first and consistent with the screenshots: premium black surfaces, purple accent, soft borders, rounded cards, dense dashboard layout.
8. Make components reusable, typed, and composable.
9. Use lucide-react for icons where needed.
10. Preserve accessibility and keyboard focus behavior.

Deliverables:
- theme token files
- Tailwind token wiring
- shared primitive components
- composed layout patterns
- migrated representative screens
- no visual regressions against the intended style

Start with Phase 1 and Phase 2 before touching page-level screens.
```

---

## 15) What the agent should not do

- Do not add Material UI, Chakra, Ant, or another component library.
- Do not use arbitrary per-component inline style objects unless unavoidable.
- Do not introduce bright backgrounds or glassmorphism.
- Do not use neon effects everywhere; accent glow should be selective.
- Do not mix multiple typography systems.
- Do not create different card styles for every page.

---

## 16) Final note
This framework is designed to match the screenshots while fitting the current repo architecture. The values are consistent enough to implement now, and easy to fine-tune later after a first integrated pass.
