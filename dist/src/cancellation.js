"use strict";
/**
 * Legacy cancellation token.
 *
 * The original PaySync client predates the AbortController standard; it
 * shipped a hand-rolled cancellation token in the same release as the
 * callback API. The interface is intentionally minimal:
 *
 *     const token = createCancellationToken();
 *     paySync.charge(amount, { cancellationToken: token }, cb);
 *     // later...
 *     token.cancel();
 *
 * If `cancel()` is called while a request is in flight, the request's
 * callback fires once with a `CancellationError` and any subsequent
 * `httpClient` callbacks are dropped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCancellationToken = void 0;
function createCancellationToken() {
    let cancelled = false;
    const listeners = [];
    return {
        cancel() {
            if (cancelled)
                return;
            cancelled = true;
            for (const fn of listeners) {
                try {
                    fn();
                }
                catch {
                    // Swallow — listener exceptions must not block other listeners.
                }
            }
        },
        isCancelled() {
            return cancelled;
        },
        onCancel(fn) {
            if (cancelled) {
                try {
                    fn();
                }
                catch {
                    // ignore
                }
                return;
            }
            listeners.push(fn);
        },
    };
}
exports.createCancellationToken = createCancellationToken;
