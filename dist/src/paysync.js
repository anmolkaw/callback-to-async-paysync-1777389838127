"use strict";
/**
 * paysync.ts - PaySync client.
 *
 * The PaySync class exposes four async methods over the
 * fictional payments processor:
 *
 *   await paySync.charge(amount, opts)
 *   await paySync.refund(txnId, opts)
 *   await paySync.lookup(txnId, opts)
 *   await paySync.cancelTransaction(txnId, opts)
 *
 * History notes (see CHANGELOG):
 *   - v0.1 (2017-03)   shipped charge/refund/lookup with the callback
 *                      interface that's still in place today
 *   - v0.4 (2017-08)   added per-call cancellation tokens because
 *                      operators were complaining about hung pages
 *   - v0.7 (2018-01)   added internal retry on transport failures
 *                      (FB-201) so callers stopped seeing transient
 *                      network blips
 *   - v0.9 (2018-06)   added the variadic receipt + metadata returns to
 *                      charge/refund so dashboards could display the
 *                      full server response without a follow-up lookup
 *   - v1.0 (2018-11)   cancelTransaction shipped with the
 *                      EventEmitter-based completion notification —
 *                      the request callback fires on submission, but
 *                      "the cancellation actually completed" is signaled
 *                      asynchronously via the 'cancelled' event.
 *   - v1.2 (2019-03)   gateway started returning structured error
 *                      payloads with a `_raw` diagnostic blob. We
 *                      translate those into typed subclasses at the
 *                      response handler so callers can branch on
 *                      err instanceof RateLimitError / etc.
 *
 * All four methods accept `opts.signal` for request cancellation.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaySync = void 0;
const node_events_1 = require("node:events");
const httpClient = __importStar(require("./httpClient"));
const retry_1 = require("./retry");
const errors_1 = require("./errors");
// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/**
 * Translate a raw gateway error into the typed PaySync subclass. The
 * gateway tags structured failures with an `_raw` diagnostic; we map
 * that to the right error class. NetworkTimeoutError is constructed by
 * `_doRequest` directly when retries exhaust, so we pass it through.
 */
function translateRawError(err) {
    if (!err)
        return null;
    if (err instanceof errors_1.RateLimitError)
        return err;
    if (err instanceof errors_1.InsufficientFundsError)
        return err;
    if (err instanceof errors_1.NetworkTimeoutError)
        return err;
    if (err instanceof errors_1.CancellationError)
        return err;
    const raw = err._raw;
    if (raw?.code === 429) {
        return new errors_1.RateLimitError({ retryAfterMs: raw.retryAfter ?? 1000 });
    }
    if (raw?.code === 402) {
        return new errors_1.InsufficientFundsError({ availableBalance: raw.balance ?? 0 });
    }
    return err;
}
function request(url, body, signal, toResult) {
    return new Promise((resolve, reject) => {
        (0, retry_1._doRequest)(url, body, (err, ...rest) => {
            const translated = translateRawError(err);
            if (translated) {
                reject(translated);
                return;
            }
            resolve(toResult(rest));
        }, signal);
    });
}
// ---------------------------------------------------------------------------
// PaySync class
// ---------------------------------------------------------------------------
class PaySync extends node_events_1.EventEmitter {
    async charge(amount, opts = {}) {
        // Synchronous validation — predates the callback-error pattern.
        const fieldErrors = {};
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
            fieldErrors.amount = 'must be a finite number';
        }
        else if (amount <= 0) {
            fieldErrors.amount = 'must be positive';
        }
        if (Object.keys(fieldErrors).length > 0) {
            throw new errors_1.ValidationError({ fieldErrors });
        }
        const body = {
            amount,
            currency: opts.currency ?? 'USD',
            customerId: opts.customerId,
        };
        return request('/v1/charges', body, opts.signal, (rest) => {
            // Gateway delivers (txnId, receipt, metadata) as positional args.
            const [txnId, receipt, metadata] = rest;
            return { txnId, receipt, metadata };
        });
    }
    async refund(txnId, opts = {}) {
        const fieldErrors = {};
        if (typeof txnId !== 'string' || txnId.length === 0) {
            fieldErrors.txnId = 'must be a non-empty string';
        }
        if (Object.keys(fieldErrors).length > 0) {
            throw new errors_1.ValidationError({ fieldErrors });
        }
        const body = { txnId, reason: opts.reason };
        return request('/v1/refunds', body, opts.signal, (rest) => {
            const [refundId, receipt, metadata] = rest;
            return { refundId, receipt, metadata };
        });
    }
    async lookup(txnId, opts = {}) {
        const fieldErrors = {};
        if (typeof txnId !== 'string' || txnId.length === 0) {
            fieldErrors.txnId = 'must be a non-empty string';
        }
        if (Object.keys(fieldErrors).length > 0) {
            throw new errors_1.ValidationError({ fieldErrors });
        }
        return request('/v1/lookup', { txnId }, opts.signal, (rest) => {
            const [txn] = rest;
            return txn;
        });
    }
    /**
     * cancelTransaction - submits a cancellation order. The returned promise
     * resolves on submission. Server-side completion is signaled via the
     * `'cancelled'` event on this PaySync instance with payload
     * `{ txnId: string }`.
     */
    async cancelTransaction(txnId, opts = {}) {
        const fieldErrors = {};
        if (typeof txnId !== 'string' || txnId.length === 0) {
            fieldErrors.txnId = 'must be a non-empty string';
        }
        if (Object.keys(fieldErrors).length > 0) {
            throw new errors_1.ValidationError({ fieldErrors });
        }
        return new Promise((resolve, reject) => {
            const signal = opts.signal;
            let settled = false;
            let abortListenerAttached = false;
            const onAbort = () => {
                settle(new errors_1.CancellationError());
            };
            const cleanup = () => {
                if (!abortListenerAttached)
                    return;
                signal?.removeEventListener('abort', onAbort);
                abortListenerAttached = false;
            };
            const settle = (err = null) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            };
            if (signal?.aborted) {
                settle(new errors_1.CancellationError());
                return;
            }
            if (signal) {
                signal.addEventListener('abort', onAbort);
                abortListenerAttached = true;
            }
            httpClient.post('/v1/cancellations', { txnId }, (err) => {
                if (settled)
                    return;
                if (signal?.aborted) {
                    settle(new errors_1.CancellationError());
                    return;
                }
                settle(translateRawError(err));
            });
        });
    }
}
exports.PaySync = PaySync;
