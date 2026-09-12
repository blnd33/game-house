# Gaming House

Separate Windows station application for the Gaming House lounge at Padel House,
Duhok. **Development release 0.4.0: player UI, real game launching, session
lifecycle against a development backend, and packaging scaffolding.** Not yet
done: any real game or Steam title, Windows restriction on a venue PC,
installation on a venue PC, and the partner's real backend. Screens and reports
say which parts are simulated.

The original logo is included unchanged. Game covers are labeled placeholders,
and the sample games are illustrative, not the venue's installed catalog.
Nothing outside this project needs to be modified to build or run it.

## Run on this Windows development PC

Prerequisites: Node.js 24 (at least 24.14.1), npm 11, .NET 10 SDK.

```powershell
cd 'C:\Users\rand\Desktop\padel house game app\gaming-house'
npm ci
npm run verify
```

`verify` lints the contract, runs 75 Node tests and 53 .NET tests, type-checks
and builds everything, runs the agent's honest self-check, and runs both
integration tests: the agent's session lifecycle against the development backend,
and the real launch chain using a stand-in test program. It never launches a real
game and never restricts Windows.

```powershell
npm run simulator        # development backend, loopback only (separate terminal)
npm run start:native     # desktop plus its development agent; the catalog starts empty
npm run start:sample     # isolated UI demo with a fake cashier; cannot launch real games
npm run test:desktop     # 18 UI checks, screenshots in artifacts/ui/
```

`docs/operator-setup.md` covers enrollment, the cashier commands and recovery.
`docs/game-setup.md` covers adding and testing real games, one at a time.

## Files to read

- `docs/progress.md`: completed work, evidence, missing inputs, next phase.
- `docs/architecture.md`: responsibilities and security boundaries.
- `docs/session-rules.md`: lifecycle, timing, recovery, and restriction semantics.
- `contracts/openapi.json`: generated, versioned **proposed** OpenAPI 3.1 contract.
- `scripts/build-contract.mjs`: contract source; run `npm run contract:generate` after edits.
- `packages/contracts/src/`: generated types plus the renderer and agent interfaces.
- `apps/desktop/src/`: player UI. `station/` holds the display rules; `dev/` holds
  the development sample, which production builds must exclude.
- `docs/partner-handoff.md`, `docs/contract-test-plan.md`, `docs/inputs.md`.

`apps/backend-simulator/` is the development backend: it owns all billing
arithmetic and the cashier actions, and it is never part of a station package.
`services/station-agent/` is the Windows agent, and `release/` holds unsigned
development packages — not a venue-ready release.

When continuing, read `docs/progress.md` first. The next step is adding real
games one at a time (`docs/game-setup.md`), then Windows restriction testing on
an authorized PC. Do not modify or run the partner's Padel House app.
