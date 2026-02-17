# Drag-and-Drop Structure Overlay Implementation

## Overview
Replaced the `ReviewOverlay` component with a new `StructureDnDOverlay` that uses dnd-kit (drag-and-drop toolkit) to allow users to visually organize trading legs into structures.

## Key Files Added/Modified

### New Files Created

#### 1. **src/components/dndUtils.ts**
Contains data models and utility functions for the DnD feature:
- **LegItem**: Type representing a draggable leg item with stable ID and original row data
- **BoardState**: Type representing the entire board state (items, containers, structure metadata)
- **generateLegId()**: Creates stable unique IDs using trade_id > order_id > fallback
- **formatLegLabel()**: Formats individual leg labels as `±qty / Strike / DD-MM`
  - Example: `-1 / P60000 / 27-02`
- **aggregateStructureLegs()**: Aggregates legs by expiry/strike/optionType and computes net premium
- **formatStructureLabel()**: Formats structure headers with total qty, type, and aggregated legs
  - Example: `+1 / IC / +P60000 -C75000 / 27-02`
- **autoGroupByTime()**: Auto-groups rows by normalized timestamp (same-second grouping)
- **suggestStructureType()**: Heuristic to suggest IC/DS structure type based on leg composition

#### 2. **src/components/StructureDnDOverlay.tsx**
Main overlay component with full DnD functionality:

**Components:**
- `DraggableLegItem`: Individual leg item with dnd-kit sortable integration
- `StructureContainer`: Droppable container for each structure with type selector
- `UnassignedContainer`: Container for unassigned legs (amber when non-empty)
- `ExcludedContainer`: Container for non-option rows (red, read-only)
- `CreateStructureZone`: Special droppable zone that creates new structures on drop

**Features:**
- PointerSensor + KeyboardSensor for drag activation
- closestCorners collision detection
- DragOverlay for visual feedback while dragging
- Responsive grid layout (1/2/3 columns depending on screen size)
- Validation: Import disabled until all included legs are assigned or excluded

**Toolbar Actions:**
- Auto by time: Groups legs by timestamp (applied on mount by default)
- All → Unassigned: Clears all structure assignments
- + New structure: Creates empty structure for manual organization

**Type Selection:**
Each structure has a dropdown (IC / DS / Custom) to specify strategy type.

### Modified Files

#### src/DashboardApp.tsx
- Added import for `StructureDnDOverlay`
- Replaced `ReviewOverlay` render with `StructureDnDOverlay`
- Updated `finalizeImport()` signature to accept optional `unprocessedRows` parameter
- Simplified prop passing: removed unnecessary allocations/structures/duplicates props

### Updated File

#### package.json
Added dnd-kit dependencies:
- `@dnd-kit/core@^6.1.0`
- `@dnd-kit/sortable@^7.0.2`
- `@dnd-kit/utilities@^3.2.1`

## Data Flow

```
UploadBox
  → ColumnMapper
    → StructureDnDOverlay (NEW, replaces ReviewOverlay)
      → onConfirm(rows, unprocessedRows)
        → finalizeImport()
          → buildPositionsFromTransactions()
```

Each row is assigned a `structureId` (format: `structure:timestamp` or `structure:uniqueId`) before being passed to finalizeImport. The function's existing fallback logic handles any missing structureId.

## Behavior

### Initial State
- Auto-groups all legs by timestamp on mount
- Unassigned container shows empty (all legs assigned by default)
- Excluded container shows non-option rows (read-only)

### Drag & Drop Mechanics
- Drag leg from any container
- Drop into structure container, unassigned, excluded, or create-structure zone
- Within a container, legs can be reordered
- Dropping into "create-structure" automatically creates new structure:timestamp container

### Validation
- "Assign or exclude X legs" warning displayed when unassigned legs exist
- Import button disabled until validation passes
- Users can explicitly exclude legs by dragging to the Excluded container

### Structure Management
- Each structure shows aggregated summary (total premium, legs, expiries)
- Type selector (IC/DS/Custom) configurable per structure
- Delete button removes structure and returns its legs to Unassigned
- Heuristic suggests IC for 4-leg same-expiry spreads, DS for multi-expiry

## Backward Compatibility

The implementation maintains backward compatibility:
- `finalizeImport()` unchanged in behavior; accepts optional unprocessedRows
- No changes to `buildPositionsFromTransactions()` or position creation logic
- Existing structure numbering system still works (fallback in finalizeImport)
- All original data flows and validation preserved

## Styling

Uses Tailwind CSS with responsive design:
- Left column (unassigned/excluded) stacks on mobile
- Right grid (structures) adapts 1→2→3 columns based on breakpoints
- Visual feedback: border color changes on drag-over (amber, red, blue)
- Disabled states clearly indicated

## Testing Checklist

- [x] Build completes without errors
- [x] TypeScript compilation passes
- [x] Imports/dependencies resolved correctly
- [x] Component renders without runtime errors
- [x] DnD library integration working
- [x] Backward compatible with existing flow

## Future Enhancements (Phase 2)

- Advanced heuristics for strategy suggestion (butterflies, calendars, etc.)
- Bulk operations (move multiple legs at once)
- Keyboard shortcuts for accessibility
- Undo/redo for drag operations
- Save/load structure templates
- Duplicate leg detection and warnings
