You are integrating a standardized UI framework into an existing React + Vite + Tailwind web app.

Use the attached handoff files as the source of truth.

Implementation rules:
- Preserve the existing Tailwind + CSS variable theming architecture.
- Do not introduce another UI framework.
- Do not hardcode colors, spacing, radii, shadows, or text sizes in screen components.
- Implement semantic tokens first.
- Implement shared primitives second.
- Implement layout/pattern components third.
- Refactor page-level modules only after the primitives are stable.
- Keep the visual style dark-first, premium, dense, rounded, and purple-accented.
- Reuse primitives everywhere.
- Keep components typed, composable, and accessible.

Required deliverables:
1. Theme variables in CSS.
2. Tailwind semantic token mapping.
3. Shared primitive components.
4. Shared layout/pattern components.
5. Representative migrated screens.
6. Cleanup of duplicated styles.

Do not stop after token setup. Continue until at least one full screen in each major pattern family uses the new framework:
- dashboard cards
- table
- kanban
- gantt
- detail panel
- object canvas
