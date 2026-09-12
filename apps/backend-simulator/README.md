# Development backend simulator (Phase 4)

Reserved for a small localhost-only server implementing `contracts/openapi.json`.
No server is implemented or started in Phase 1. `127.0.0.1:4317` is a proposed
development address. The desktop foundation does not connect to it.

Phase 4 must add a clearly labeled development control panel or CLI for cashier
authorization, policy configuration, cashier stop, and fault injection. Require
explicit delay/rate/rounding settings, including valid zero delay. Snapshot them
per session. Implement automatic paid-start independently of any open UI.

The control surface and all pricing arithmetic stay here, excluded from the
production station bundle and installer. Use `docs/contract-test-plan.md` as the
acceptance suite. No real Padel House code, database, credentials, or staff cookies.
