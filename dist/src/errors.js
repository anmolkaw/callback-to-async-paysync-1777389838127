"use strict";
/**
 * PaySync error subclasses.
 *
 * These classes were added incrementally as the API surface grew. Each
 * carries a small payload describing the failure so callers can branch
 * on the failure mode without parsing message strings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationError = exports.NetworkTimeoutError = exports.ValidationError = exports.InsufficientFundsError = exports.RateLimitError = void 0;
class RateLimitError extends Error {
    retryAfterMs;
    constructor(opts) {
        super(opts.message ?? 'Rate limit exceeded');
        this.name = 'RateLimitError';
        this.retryAfterMs = opts.retryAfterMs;
        Object.setPrototypeOf(this, RateLimitError.prototype);
    }
}
exports.RateLimitError = RateLimitError;
class InsufficientFundsError extends Error {
    availableBalance;
    constructor(opts) {
        super(opts.message ?? 'Insufficient funds');
        this.name = 'InsufficientFundsError';
        this.availableBalance = opts.availableBalance;
        Object.setPrototypeOf(this, InsufficientFundsError.prototype);
    }
}
exports.InsufficientFundsError = InsufficientFundsError;
class ValidationError extends Error {
    fieldErrors;
    constructor(opts) {
        super(opts.message ?? 'Validation failed');
        this.name = 'ValidationError';
        this.fieldErrors = opts.fieldErrors;
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
exports.ValidationError = ValidationError;
class NetworkTimeoutError extends Error {
    attempts;
    constructor(opts) {
        super(opts.message ?? 'Network timeout');
        this.name = 'NetworkTimeoutError';
        this.attempts = opts.attempts;
        Object.setPrototypeOf(this, NetworkTimeoutError.prototype);
    }
}
exports.NetworkTimeoutError = NetworkTimeoutError;
class CancellationError extends Error {
    cancelledAt;
    constructor(opts) {
        super(opts?.message ?? 'Request cancelled');
        this.name = 'CancellationError';
        this.cancelledAt = opts?.cancelledAt ?? Date.now();
        Object.setPrototypeOf(this, CancellationError.prototype);
    }
}
exports.CancellationError = CancellationError;
