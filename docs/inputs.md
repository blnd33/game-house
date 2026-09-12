# Outstanding inputs

None of these blocked Phases 1–2. Phase 3 needs the game list and install paths
for this PC. Never send live secrets in chat.

| Input | Current evidence | Needed before |
| --- | --- | --- |
| Venue Windows edition/build and player account policy | Development PC is Windows 11 Pro x64, build 26200; this does not establish the 12 venue PCs | Native restriction design/Phase 3 |
| Actual game list, Steam AppIDs, paths, process/handoff profiles | None verified. Concept titles are illustrative only | Real launch tests/Phase 3 |
| Original logo | `IMG_4432.PNG` copied unchanged as `apps/desktop/public/brand/gaming-house-logo.png` | Available |
| Design concept | Supplied image copied unchanged to `assets/reference/library-concept.png` | Available; use as design reference |
| Per-game artwork and usage source | None supplied. Owner chose labeled placeholders for now (2026-09-11); drop-in path in `assets/README.md` | Phase 3 catalog / before pilot |
| UI language | English only (owner decision, 2026-09-11) | Decided |
| Venue monitor sizes/scaling | UI checked at 1920×1080, 1280×720 and 1024×640 CSS px on a 125%-scaled dev PC; venue monitors not verified | Venue pilot |
| Request Help delivery | Button exists in the UI and sample only; the contract has no help message | Before Phase 4 (add message or remove button) |
| Station labels/count and enrollment operator | PC-01…PC-12 planned; no assigned immutable IDs | Phase 3/6 setup |
| Pairing flow and auth agreement | Proposed one-time code plus station-scoped rotating credentials | Partner contract review |
| Partner API base URL/staging/certificate setup | No endpoint supplied; loopback simulator address is reserved only | Phase 6 |
| Delay/rate/currency/rounding/minimum policy | Backend-owned, configurable; no venue values selected | Simulator scenarios/partner review |
| Pending launch timeout, observation freshness, active offline lease | Explicit central configuration required; no unbounded offline play | Phases 3/4 |
| Actual restriction and release profile | Must validate supported Windows account/control approach with launchers/anti-cheat | Phases 3/5 |
| Signing identity, update distribution, recovery operator | Not supplied; foundation is unsigned development only | Phase 5/release |
| Partner acceptance of contract and retention rules | Proposal written; no agreement or external communication claimed | Phase 1 cross-team gate/Phase 6 integration |

Device setup will store credential references in protected local configuration.
The development example contains no secret, registered ID, price or grace fallback.
