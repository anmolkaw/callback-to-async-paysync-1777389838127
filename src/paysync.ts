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

import { EventEmitter } from 'node:events';
import * as httpClient from './httpClient';
import { _doRequest } from './retry';
import {
  RateLimitError,
  InsufficientFundsError,
  ValidationError,
  NetworkTimeoutError,
  CancellationError,
} from './errors';
import type { RawError } from './httpClient';

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

export interface ChargeOptions {
  currency?: string;
  customerId?: string;
  signal?: AbortSignal;
}

export interface RefundOptions {
  reason?: string;
  signal?: AbortSignal;
}

export interface LookupOptions {
  signal?: AbortSignal;
}

export interface CancelTransactionOptions {
  signal?: AbortSignal;
}

export interface Receipt {
  amountCents: number;
  currency: string;
  capturedAt: number;
}

export interface RequestMetadata {
  requestId: string;
  serverTimeMs: number;
}

export interface Transaction {
  txnId: string;
  amountCents: number;
  currency: string;
  status: 'authorized' | 'captured' | 'refunded' | 'cancelled';
  createdAt: number;
}

export interface ChargeResult {
  txnId: string;
  receipt: Receipt;
  metadata: RequestMetadata;
}

export interface RefundResult {
  refundId: string;
  receipt: Receipt;
  metadata: RequestMetadata;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Translate a raw gateway error into the typed PaySync subclass. The
 * gateway tags structured failures with an `_raw` diagnostic; we map
 * that to the right error class. NetworkTimeoutError is constructed by
 * `_doRequest` directly when retries exhaust, so we pass it through.
 */
function translateRawError(err: RawError | null): Error | null {
  if (!err) return null;
  if (err instanceof RateLimitError) return err;
  if (err instanceof InsufficientFundsError) return err;
  if (err instanceof NetworkTimeoutError) return err;
  if (err instanceof CancellationError) return err;

  const raw = err._raw;
  if (raw?.code === 429) {
    return new RateLimitError({ retryAfterMs: raw.retryAfter ?? 1000 });
  }
  if (raw?.code === 402) {
    return new InsufficientFundsError({ availableBalance: raw.balance ?? 0 });
  }
  return err;
}

function request<T>(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  toResult: (values: unknown[]) => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    _doRequest(
      url,
      body,
      (err, ...rest) => {
        const translated = translateRawError(err);
        if (translated) {
          reject(translated);
          return;
        }
        resolve(toResult(rest));
      },
      signal
    );
  });
}

// ---------------------------------------------------------------------------
// PaySync class
// ---------------------------------------------------------------------------

export class PaySync extends EventEmitter {
  async charge(
    amount: number,
    opts: ChargeOptions = {}
  ): Promise<ChargeResult> {
    // Synchronous validation — predates the callback-error pattern.
    const fieldErrors: Record<string, string> = {};
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      fieldErrors.amount = 'must be a finite number';
    } else if (amount <= 0) {
      fieldErrors.amount = 'must be positive';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const body = {
      amount,
      currency: opts.currency ?? 'USD',
      customerId: opts.customerId,
    };

    return request('/v1/charges', body, opts.signal, (rest) => {
      // Gateway delivers (txnId, receipt, metadata) as positional args.
      const [txnId, receipt, metadata] = rest as [
        string,
        Receipt,
        RequestMetadata
      ];
      return { txnId, receipt, metadata };
    });
  }

  async refund(
    txnId: string,
    opts: RefundOptions = {}
  ): Promise<RefundResult> {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const body = { txnId, reason: opts.reason };

    return request('/v1/refunds', body, opts.signal, (rest) => {
      const [refundId, receipt, metadata] = rest as [
        string,
        Receipt,
        RequestMetadata
      ];
      return { refundId, receipt, metadata };
    });
  }

  async lookup(
    txnId: string,
    opts: LookupOptions = {}
  ): Promise<Transaction> {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    return request('/v1/lookup', { txnId }, opts.signal, (rest) => {
      const [txn] = rest as [Transaction];
      return txn;
    });
  }

  /**
   * cancelTransaction - submits a cancellation order. The returned promise
   * resolves on submission. Server-side completion is signaled via the
   * `'cancelled'` event on this PaySync instance with payload
   * `{ txnId: string }`.
   */
  async cancelTransaction(
    txnId: string,
    opts: CancelTransactionOptions = {}
  ): Promise<void> {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    return new Promise<void>((resolve, reject) => {
      const signal = opts.signal;
      let settled = false;
      let abortListenerAttached = false;

      const onAbort = (): void => {
        settle(new CancellationError());
      };

      const cleanup = (): void => {
        if (!abortListenerAttached) return;
        signal?.removeEventListener('abort', onAbort);
        abortListenerAttached = false;
      };

      const settle = (err: Error | null = null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      if (signal?.aborted) {
        settle(new CancellationError());
        return;
      }

      if (signal) {
        signal.addEventListener('abort', onAbort);
        abortListenerAttached = true;
      }

      httpClient.post('/v1/cancellations', { txnId }, (err) => {
        if (settled) return;
        if (signal?.aborted) {
          settle(new CancellationError());
          return;
        }
        settle(translateRawError(err));
      });
    });
  }
}
