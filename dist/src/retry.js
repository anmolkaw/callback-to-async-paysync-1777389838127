"use strict";
/**
 * Internal request helper.
 *
 * Wraps `httpClient.post` with the policy that's been baked into PaySync
 * since FB-201: transient transport failures get retried up to three
 * times with 100ms / 200ms / 400ms backoff before bubbling up.
 *
 * Transient failures are identified by `err._raw.transient === true`
 * on the raw error from the gateway.
 *
 * Optional `signal` short-circuits the retry chain: if the signal is
 * aborted before / between attempts, no further httpClient.post calls
 * fire and the callback is invoked with a CancellationError.
 *
 * The helper invokes its callback exactly once.
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
exports._doRequest = void 0;
const httpClient = __importStar(require("./httpClient"));
const errors_1 = require("./errors");
const BACKOFF_MS = [100, 200, 400];
const MAX_ATTEMPTS = 3;
function isTransient(err) {
    return !!err && err._raw?.transient === true;
}
function _doRequest(url, body, callback, signal) {
    let attempt = 0;
    let pendingTimer = null;
    let settled = false;
    let abortListenerAttached = false;
    const cleanup = () => {
        if (!abortListenerAttached)
            return;
        signal?.removeEventListener('abort', onAbort);
        abortListenerAttached = false;
    };
    const finish = (err, ...rest) => {
        if (settled)
            return;
        settled = true;
        cleanup();
        callback(err, ...rest);
    };
    const onAbort = () => {
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        finish(new errors_1.CancellationError());
    };
    if (signal?.aborted) {
        finish(new errors_1.CancellationError());
        return;
    }
    if (signal) {
        signal.addEventListener('abort', onAbort);
        abortListenerAttached = true;
    }
    const tryOnce = () => {
        if (settled)
            return;
        if (signal?.aborted) {
            finish(new errors_1.CancellationError());
            return;
        }
        attempt += 1;
        httpClient.post(url, body, (err, ...rest) => {
            if (settled)
                return;
            if (signal?.aborted) {
                finish(new errors_1.CancellationError());
                return;
            }
            if (isTransient(err)) {
                if (attempt < MAX_ATTEMPTS) {
                    const delay = BACKOFF_MS[attempt - 1];
                    pendingTimer = setTimeout(() => {
                        pendingTimer = null;
                        tryOnce();
                    }, delay);
                    return;
                }
                finish(new errors_1.NetworkTimeoutError({ attempts: attempt }));
                return;
            }
            finish(err, ...rest);
        });
    };
    tryOnce();
}
exports._doRequest = _doRequest;
