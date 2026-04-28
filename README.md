# PaySync — Migrate Callback API to Async/Await

## Objective

Migrate `src/paysync.ts` from a callback-style API to async/await. The four public methods on the `PaySync` class — `charge`, `refund`, `lookup`, and `cancelTransaction` — must become async functions. Existing public tests must pass.

## API contract

The new API is async-only. Each method returns a `Promise`. No callback parameter.

```ts
const paySync = new PaySync();
const result = await paySync.charge(amount, opts);
```

Cancellation moves from the legacy `opts.cancellationToken` to a standard `opts.signal?: AbortSignal`. The legacy token interface is removed from the new API surface.

## Time

60 minutes.

## Constraints

- All four methods must be async functions (not regular functions returning promises).
- All custom error classes defined in `src/errors.ts` must continue to be thrown or rejected with their existing fields preserved.
- Existing module exports — the four methods on `PaySync`, the error classes, and the `PaySync` class itself — must remain importable with the same names from `./src/index`.
- Public tests in `tests/` must pass on your refactored code.

## Getting started

```sh
npm install
npm test
```

The public tests are written against the new async API. They will fail on the unmodified codebase. They pass once the refactor is complete.

## Suggested workflow

1. Read `src/paysync.ts` end-to-end. It is the only file whose surface API needs to change. Understand what each method does before you start moving code.
2. Read the other modules under `src/` — they each contribute to the behavior the legacy module relies on.
3. Plan a refactor that preserves every behavior the existing implementation relies on.
4. Refactor incrementally; keep the public tests as your check.

## Evaluation

A hidden test suite verifies behavior preservation across the refactor. Edge cases matter. Read the existing implementation carefully — there's more going on than the surface API suggests.
