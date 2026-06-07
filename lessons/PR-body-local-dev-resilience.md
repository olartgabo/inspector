## What

Two local-dev resilience fixes so the inspector boots and stays up even when the signed-in identity has no backing account record (the situation against an employee-locked non-prod backend, where `ensureUser` is rejected and no `users`/org row exists):

1. **UserSetupError no longer blocks local dev.** `#1979` made the app require a backing account record before rendering, showing a full-screen "Could not finish setup" error whenever `currentUser === null`. That fired in local dev too. It's now gated behind `HOSTED_MODE` via a small pure helper (`shouldShowUserSetupError`), mirroring `resolveHostedShellGateState`. Hosted/cloud still requires the record (it backs orgs/projects/billing); local dev renders regardless. Downstream `currentUser` reads are already null-safe.

2. **Sidebar credit widget no longer crashes the app.** The credit-usage strip sits in the always-rendered sidebar and calls `billing:getCreditBalance`. Convex `useQuery` re-throws query errors during render, so a failed balance query (e.g. "organizationId is required for signed-in credit balance" when there's no org) bubbled to the route error boundary and took down the whole page. It's now wrapped in `<ErrorBoundary fallback={null}>`, matching the pattern already used around the billing-page credit widgets — a failed billing query now just hides the strip.

## Why

Before `#1979` the app started up regardless of the account record. The new gate, plus the credit query throwing on render, turned a missing/locked-out account into a full-app crash in local dev. These changes restore graceful startup without weakening hosted behavior.

## Scope / non-goals

Purely crash-resilience. Making guest sessions / LLM / evals *work* locally is out of scope — that's gated by the backend lockdown, not the inspector.

## Testing

- `client/src/lib/__tests__/user-setup-gate.test.ts` — 5 tests (hosted vs local gating).
- `client/src/components/sidebar/__tests__/sidebar-credit-usage.test.tsx` — added a regression test that mounts the widget with a throwing balance query and asserts it renders nothing instead of crashing (9 tests total).
- `npm run build` passes.
