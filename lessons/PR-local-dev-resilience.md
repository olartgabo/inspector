# PR guide — local-dev resilience (UserSetupError gate + credit-widget crash)

Everything you need to land the branch `fix/local-dev-user-setup-error`:
what the PR says, what each commit says, which files go in, and the exact
commands to push it. **No co-author trailers anywhere** — these are your
commits.

---

## 0. Context (why this PR exists)

Local dev points `CONVEX_URL` at the employee-locked non-prod backend, but the
inspector's own lockdown flags aren't set. That hybrid state made the app
*crash* instead of degrading gracefully. This PR fixes two of those hard
crashes so the app boots and stays up regardless of the account/billing state:

1. **UserSetupError gate** — `#1979` made the app require a backing account
   record before rendering. With no record (`currentUser === null`) it showed a
   full-screen "Could not finish setup" error, even in local dev. Now gated
   behind `HOSTED_MODE`.
2. **Sidebar credit widget crash** — the always-rendered credit strip calls
   `billing:getCreditBalance`; Convex `useQuery` re-throws on error, which
   bubbled to the route error boundary and took down the whole app (e.g. a
   signed-in identity with no org → "organizationId is required for signed-in
   credit balance"). Now wrapped in `<ErrorBoundary fallback={null}>`.

> Note: making *guest sessions / LLM / evals* actually work locally is **not**
> in scope — that's blocked by the backend lockdown, not the inspector. This PR
> is purely about not crashing.

---

## 1. What goes IN this PR (and what stays OUT)

**Include only these files** (the credit-widget fix; the UserSetupError fix is
already committed):

- `mcpjam-inspector/client/src/components/sidebar/sidebar-credit-usage.tsx`
- `mcpjam-inspector/client/src/components/sidebar/__tests__/sidebar-credit-usage.test.tsx`

**Do NOT commit** (these belong to your AgentCore/Bedrock work or are stray):

- `sdk/src/ChatGptAppsRuntime.bundled.ts`
- `sdk/src/McpAppsOpenAICompatibleRuntime.bundled.ts`
- `package-lock.json`
- `mcpjam-inspector/bin/start.js`
- `examples/agentcore-inspector/`
- `mcpjam-inspector/client/public/aws_bedrock_logo.svg`
- `mcpjam-inspector/client/src/components/setting/BedrockConfigDialog.tsx`
- `lessons/` (including this file)

---

## 2. (Optional but recommended) Clean the existing commit

The already-made commit `eda30b10b` currently has a `Co-Authored-By: Claude`
trailer. The branch isn't pushed, so you can rewrite it safely. Do this
**before** adding the new commit (it must be HEAD). Run in your terminal:

```powershell
git commit --amend -m @'
fix(client): don't block local dev with UserSetupError on missing account record

PR #1979 made the app require a backing account record before rendering,
returning the full-screen UserSetupError whenever an authenticated identity
had no `users` row (`currentUser === null`). This fires in local dev too,
where the backend doesn't always create a record for the session, so the
app falls into the hard error screen instead of just loading (regression
from pre-#1979 startup behavior).

Gate the screen behind HOSTED_MODE via a small pure helper
(`shouldShowUserSetupError`), mirroring `resolveHostedShellGateState`.
Hosted/cloud still requires the record (it backs orgs/projects/billing);
local dev renders regardless. All downstream `currentUser` reads are
already null-safe.
'@
```

(The closing `'@` must be at column 0 — no leading spaces.)

If you don't care about the trailer on that commit, skip this step.

---

## 3. Stage + commit the credit-widget fix

```powershell
git add mcpjam-inspector/client/src/components/sidebar/sidebar-credit-usage.tsx mcpjam-inspector/client/src/components/sidebar/__tests__/sidebar-credit-usage.test.tsx

git commit -m @'
fix(client): keep the sidebar credit widget from crashing the whole app

The credit-usage strip lives in the always-rendered sidebar shell and calls
`billing:getCreditBalance` directly. Convex `useQuery` re-throws query errors
during render, so a failed query bubbled up to the route-level error boundary
and took the entire app down instead of just hiding the widget.

This bites in local dev: a signed-in identity with no backing org (the
non-prod lockdown blocks `ensureUser`, so no record is created) makes the
backend throw "organizationId is required for signed-in credit balance".

Wrap the query-running body in `<ErrorBoundary fallback={null}>` so a billing
query failure silently hides the strip instead of crashing the app — the same
pattern already used around the billing-page credit widgets. Covers both call
sites (guest strip + account menu) at once. Adds a regression test that mounts
the widget with a throwing balance query and asserts it renders nothing.
'@
```

---

## 4. Sanity check before pushing

```powershell
# only the two intended files should be in the last commit:
git show --stat HEAD

# tests green:
cd mcpjam-inspector ; npx vitest run client/src/components/sidebar/__tests__/sidebar-credit-usage.test.tsx client/src/lib/__tests__/user-setup-gate.test.ts ; cd ..
```

Expect: `sidebar-credit-usage` 9 passed, `user-setup-gate` 5 passed.

---

## 5. Push + open the PR

```powershell
git push -u origin fix/local-dev-user-setup-error
```

Then either open the PR in the browser link git prints, or with the GitHub CLI:

```powershell
gh pr create --base main --head fix/local-dev-user-setup-error --title "fix(client): stop local dev from crashing on missing account record / failed billing queries" --body-file lessons/PR-body-local-dev-resilience.md
```

(The body file is written for you in step 6. `gh` reads it but it lives in the
untracked `lessons/` dir, so it won't be part of the PR diff.)

---

## 6. PR body (copy/paste, or use the body file)

**Title:**
`fix(client): stop local dev from crashing on missing account record / failed billing queries`

**Body:**

```markdown
## What

Two local-dev resilience fixes so the inspector boots and stays up even when
the signed-in identity has no backing account record (the situation against an
employee-locked non-prod backend, where `ensureUser` is rejected and no
`users`/org row exists):

1. **UserSetupError no longer blocks local dev.** `#1979` made the app require
   a backing account record before rendering, showing a full-screen "Could not
   finish setup" error whenever `currentUser === null`. That fired in local dev
   too. It's now gated behind `HOSTED_MODE` via a small pure helper
   (`shouldShowUserSetupError`), mirroring `resolveHostedShellGateState`.
   Hosted/cloud still requires the record (it backs orgs/projects/billing);
   local dev renders regardless. Downstream `currentUser` reads are already
   null-safe.

2. **Sidebar credit widget no longer crashes the app.** The credit-usage strip
   sits in the always-rendered sidebar and calls `billing:getCreditBalance`.
   Convex `useQuery` re-throws query errors during render, so a failed balance
   query (e.g. "organizationId is required for signed-in credit balance" when
   there's no org) bubbled to the route error boundary and took down the whole
   page. It's now wrapped in `<ErrorBoundary fallback={null}>`, matching the
   pattern already used around the billing-page credit widgets — a failed
   billing query now just hides the strip.

## Why

Before `#1979` the app started up regardless of the account record. The new
gate, plus the credit query throwing on render, turned a missing/locked-out
account into a full-app crash in local dev. These changes restore graceful
startup without weakening hosted behavior.

## Scope / non-goals

Purely crash-resilience. Making guest sessions / LLM / evals *work* locally is
out of scope — that's gated by the backend lockdown, not the inspector.

## Testing

- `client/src/lib/__tests__/user-setup-gate.test.ts` — 5 tests (hosted vs local
  gating).
- `client/src/components/sidebar/__tests__/sidebar-credit-usage.test.tsx` —
  added a regression test that mounts the widget with a throwing balance query
  and asserts it renders nothing instead of crashing (9 tests total).
- `npm run build` passes.
```

---

## 7. If you'd rather split into two PRs

The two fixes are independent. To ship them separately, cherry-pick each commit
onto its own branch off `main` (e.g. `fix/user-setup-error-local-dev` and
`fix/sidebar-credit-widget-crash`) and open one PR each, reusing the matching
section of the body above. One combined PR is fine too — they share the
"don't crash local dev" theme.
