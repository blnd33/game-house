# Gaming House project instructions

- Read `docs/progress.md` and the relevant contract/session documents before work.
- Work one phase at a time. Update progress with actual verification and next steps.
- Keep this project separate. Original parent assets and any partner app are read-only.
- Preserve the supplied logo. The concept's game list is not a verified catalog.
- Desktop sends observations; only backend policy determines charging and paid start.
- Only cashier/backend may end billing. No player stop, pause, or reset capability.
- Never add production price/delay defaults, staff cookies, DB credentials, or remote shell.
- Use the supported interactive player session for games, never the Windows Service desktop.
- Edit `scripts/build-contract.mjs`, then regenerate OpenAPI/types and check examples.
- The player UI talks only to `StationClient`. Development sample code lives in
  `apps/desktop/src/dev/` and is reached only through `station/connect.ts`.
- Run `npm run verify` and `npm run test:desktop` before reporting UI changes.
- Run checks proportionate to the phase. Do not call schema/build tests native verification.
- Record missing hardware or partner inputs honestly. Do not request live secrets in chat.
- No deployment, venue enrollment, or system restriction without corresponding authorization.
