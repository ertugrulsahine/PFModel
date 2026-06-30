# PF Modeler

PF Modeler is a browser-based, Excel-free project finance modeling application built with React, TypeScript, Vite, and a client-side TypeScript calculation engine. It is designed to be hosted as static files and used through a normal Chrome or Edge link without Python, Node.js, Excel, browser extensions, a local server, or administrator rights for end users.

## What is included

- Professional left-navigation UI with project setup, timeline, operating assumptions, funding sources, debt facilities, construction funding, debt sizing, sculpting, reserves, covenants, waterfall, scenarios, dashboard, financial statements, solver audit trail, and import/export screens.
- Modular project finance calculation engine in `src/engine`.
- Explicit iterative solver for circular debt-funded IDC, debt-funded fees, DSRA funding, sculpted repayments, cash sweep / restricted distributions, and refinancing sizing placeholders.
- Local-only JSON save/load and CSV results export. Model data is not sent to a backend.
- Integrated income statement, balance sheet, cash flow statement, covenant metrics, DSCR/LLCR/PLCR, IRR outputs, warnings, and validation messages.
- Unit tests covering the core MVP finance engine.

## Developer usage

```bash
npm install
npm run dev
npm test
npm run build
```

## End-user deployment

Run `npm run build` once in a development environment, then host the generated `dist/` folder on any static web host or internal document portal that serves static HTML/CSS/JS. End users only need a modern browser and the hosted link.

## Notes and limitations

This MVP contains a robust client-side framework and representative project finance logic, but it is not a substitute for legal, tax, accounting, or credit approval review. XLSX/PDF export is represented by CSV/JSON in this implementation to keep the app dependency-light and fully static.
