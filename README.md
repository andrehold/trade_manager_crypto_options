# Deribit Options Trade Manager (Frontend-Only)

This multi-file Vite + React (TypeScript) project mirrors your canvas app but avoids the single-document size limit.

## Run locally
1. Ensure Node.js 18+ is installed.
2. In this folder, run:
   ```bash
   npm install
   npm run dev
   ```
3. Open the printed local URL.
4. Upload your Deribit CSV, map columns, review, and import.

Notes:
- Tailwind is loaded via CDN in `index.html` to keep the project light.
- All existing behaviors are preserved: 08:00:00 row removal, Included/Excluded tabs, permissive open/close semantics, and “trade kit” grouping by second.
- Data persists to `localStorage` as in the canvas version.
