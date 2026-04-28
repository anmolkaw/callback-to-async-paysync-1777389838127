"use strict";
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
const httpClient = __importStar(require("../src/httpClient"));
const paysync_1 = require("../src/paysync");
describe('PaySync (public, async-style)', () => {
    let post;
    beforeEach(() => {
        post = jest.spyOn(httpClient, 'post');
    });
    afterEach(() => {
        post.mockRestore();
        jest.useRealTimers();
    });
    test('P1: charge is awaitable and resolves to a truthy value', async () => {
        post.mockImplementation((_url, _body, cb) => {
            cb(null, 'txn_p1', { amountCents: 10000, currency: 'USD', capturedAt: 1 }, { requestId: 'req_p1', serverTimeMs: 1 });
        });
        const paySync = new paysync_1.PaySync();
        const result = await paySync.charge(100, {});
        expect(result).toBeTruthy();
    });
    test('P2: refund is awaitable', async () => {
        post.mockImplementation((_url, _body, cb) => {
            cb(null, 'rf_p2', { amountCents: 10000, currency: 'USD', capturedAt: 1 }, { requestId: 'req_p2', serverTimeMs: 1 });
        });
        const paySync = new paysync_1.PaySync();
        const result = await paySync.refund('txn_old', {});
        expect(result).toBeTruthy();
    });
    test('P3: lookup is awaitable', async () => {
        post.mockImplementation((_url, _body, cb) => {
            cb(null, {
                txnId: 'txn_p3',
                amountCents: 100,
                currency: 'USD',
                status: 'captured',
                createdAt: 1,
            });
        });
        const paySync = new paysync_1.PaySync();
        const result = await paySync.lookup('txn_p3');
        expect(result).toBeTruthy();
    });
    test('P4: cancelTransaction is awaitable (resolves on completion event)', async () => {
        post.mockImplementation((_url, _body, cb) => {
            cb(null);
        });
        const paySync = new paysync_1.PaySync();
        const promise = paySync.cancelTransaction('txn_p4');
        setImmediate(() => paySync.emit('cancelled', { txnId: 'txn_p4' }));
        await expect(promise).resolves.toBeUndefined();
    });
    test('P5: invalid input rejects', async () => {
        const paySync = new paysync_1.PaySync();
        await expect(paySync.charge(-1, {})).rejects.toThrow();
    });
});
