import { describe, it, expect } from 'vitest';
import {
  createPropertyOffer,
  acceptOffer,
  submitReservationDepositRequest,
  confirmEscrowDeposit,
  finalizeClosing,
} from '../../src/services/transactions/reservation-service';
import { TransactionRecord } from '../../src/types';

describe('Tier 1 — Phase 3: Server-Controlled Reservations & Authoritative Payment States', () => {
  const baseOffer = createPropertyOffer({
    propertyId: 'prop-estate-505',
    propertyTitle: 'Zayed Heights Villa',
    agreedPrice: 20000000,
    buyer: { id: 'buyer-user-505', name: 'Karim', phone: '+201001122334' },
    seller: { id: 'seller-user-505', name: 'Amr' },
  });

  it('Requirement 1: Buyer deposit submission records deposit_pending without claiming held_in_escrow', () => {
    const accepted = acceptOffer(baseOffer, 'seller-user-505');

    const result = submitReservationDepositRequest(accepted, 'bank_transfer', 'buyer-user-505');

    expect(result.transaction.status).toBe('deposit_pending');
    expect(result.transaction.depositStatus).toBe('payment_pending');
    expect(result.escrowReference).toMatch(/^REQ-RES-[A-Z0-9]+$/);
    expect(result.escrowReference).not.toContain('ESCROW-CBE');
    expect(result.receiptNumber).toMatch(/^RCP-HET-\d+$/);
  });

  it('Requirement 2: Rejects non-compliance_admin attempting to confirm escrow deposit', () => {
    const accepted = acceptOffer(baseOffer, 'seller-user-505');
    const requested = submitReservationDepositRequest(accepted, 'instapay', 'buyer-user-505');

    expect(() => {
      confirmEscrowDeposit(requested.transaction, 'seller' as any, 'ESCROW-CBE-OFFICIAL-123');
    }).toThrow(/compliance_admin/i);

    expect(() => {
      confirmEscrowDeposit(requested.transaction, 'buyer' as any, 'ESCROW-CBE-OFFICIAL-123');
    }).toThrow(/compliance_admin/i);
  });

  it('Requirement 3: Authoritative compliance_admin confirms escrow upon verified bank settlement', () => {
    const accepted = acceptOffer(baseOffer, 'seller-user-505');
    const requested = submitReservationDepositRequest(accepted, 'bank_transfer', 'buyer-user-505');

    const confirmed = confirmEscrowDeposit(
      requested.transaction,
      'compliance_admin',
      'ESCROW-CBE-VERIFIED-98421'
    );

    expect(confirmed.transaction.status).toBe('deposit_escrowed');
    expect(confirmed.transaction.depositStatus).toBe('held_in_escrow');
    expect(confirmed.transaction.escrowReference).toBe('ESCROW-CBE-VERIFIED-98421');
    expect(confirmed.receiptNumber).toMatch(/^RCP-ESC-\d+$/);
  });

  it('Requirement 4: Title closing strictly requires compliance_admin authorization', () => {
    const accepted = acceptOffer(baseOffer, 'seller-user-505');
    const requested = submitReservationDepositRequest(accepted, 'bank_transfer', 'buyer-user-505');
    const confirmed = confirmEscrowDeposit(requested.transaction, 'compliance_admin', 'ESCROW-CBE-VERIFIED-98421');

    // Seller cannot close deed unilaterally
    expect(() => {
      finalizeClosing(confirmed.transaction, 'seller', 'DEED-CAIRO-99');
    }).toThrow(/compliance_admin/i);

    // Compliance admin authorizes closing
    const closed = finalizeClosing(confirmed.transaction, 'compliance_admin', 'DEED-CAIRO-99');
    expect(closed.status).toBe('completed');
    expect(closed.depositStatus).toBe('released_to_seller');
    expect(closed.closingDate).toBeTruthy();
  });

  describe('Control Plane API: Authoritative Escrow Settlement & Authorization', () => {
    it('Requirement 5: Rejects forged client x-compliance-token header with HTTP 403', async () => {
      const { default: handler, mockTransactionsStore } = await import('../../api/transactions');
      const txId = 'tx_forge_test_01';
      mockTransactionsStore.set(txId, {
        id: txId,
        propertyId: 'p-1',
        buyerId: 'buyer-regular',
        sellerId: 'seller-regular',
        agreedPrice: 10000000,
        depositAmount: 500000,
        currency: 'EGP',
        status: 'deposit_pending',
        depositStatus: 'payment_pending',
      } as any);

      let statusRes = 0;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return mockRes; },
        json: (j: any) => { jsonRes = j; return mockRes; },
      };

      // Attacker sends arbitrary user token and x-compliance-token: true
      await handler({
        method: 'POST',
        query: { action: 'confirm-escrow' },
        headers: {
          authorization: 'Bearer regular-user-token',
          'x-user-id': 'attacker-user',
          'x-compliance-token': 'true',
        },
        body: {
          transactionId: txId,
          verifiedEscrowReference: 'FORGED-ESCROW-001',
        },
      }, mockRes);

      expect(statusRes).toBe(403);
      expect(jsonRes.error).toContain('FORBIDDEN');
      expect(mockTransactionsStore.get(txId)?.status).toBe('deposit_pending');
    });

    it('Requirement 6: Cryptographically authenticates payment webhook and transitions state with audit log', async () => {
      const crypto = await import('crypto');
      const { default: handler, mockTransactionsStore } = await import('../../api/transactions');
      const txId = 'tx_webhook_test_02';
      mockTransactionsStore.set(txId, {
        id: txId,
        propertyId: 'p-2',
        buyerId: 'buyer-02',
        sellerId: 'seller-02',
        agreedPrice: 20000000,
        depositAmount: 1000000,
        currency: 'EGP',
        status: 'deposit_pending',
        depositStatus: 'payment_pending',
      } as any);

      const secret = 'test-escrow-webhook-secret-xyz';
      process.env.ESCROW_WEBHOOK_SECRET = secret;

      const body = {
        transactionId: txId,
        verifiedEscrowReference: 'ESCROW-CBE-OFFICIAL-8899',
        amount: 1000000,
        currency: 'EGP',
        settlementStatus: 'SETTLED',
      };
      const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

      let statusRes = 0;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return mockRes; },
        json: (j: any) => { jsonRes = j; return mockRes; },
      };

      await handler({
        method: 'POST',
        query: { action: 'confirm-escrow' },
        headers: {
          authorization: 'Bearer regular-client-caller',
          'x-webhook-signature': signature,
        },
        body,
      }, mockRes);

      expect(statusRes).toBe(200);
      expect(jsonRes.success).toBe(true);
      expect(jsonRes.transaction.status).toBe('deposit_escrowed');
      expect(jsonRes.transaction.depositStatus).toBe('held_in_escrow');
      expect(mockTransactionsStore.get(txId)?.status).toBe('deposit_escrowed');

      // Idempotent retry with same reference returns 200 idempotent: true
      await handler({
        method: 'POST',
        query: { action: 'confirm-escrow' },
        headers: {
          authorization: 'Bearer regular-client-caller',
          'x-webhook-signature': signature,
        },
        body,
      }, mockRes);

      expect(statusRes).toBe(200);
      expect(jsonRes.idempotent).toBe(true);

      delete process.env.ESCROW_WEBHOOK_SECRET;
    });

    it('Requirement 7: Rejects settlement with mismatched amount, currency, or non-settled status', async () => {
      const { default: handler, mockTransactionsStore } = await import('../../api/transactions');
      const txId = 'tx_mismatch_test_03';
      mockTransactionsStore.set(txId, {
        id: txId,
        propertyId: 'p-3',
        buyerId: 'buyer-03',
        sellerId: 'seller-03',
        agreedPrice: 10000000,
        depositAmount: 500000,
        currency: 'EGP',
        status: 'deposit_pending',
        depositStatus: 'payment_pending',
      } as any);

      let statusRes = 0;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return mockRes; },
        json: (j: any) => { jsonRes = j; return mockRes; },
      };

      // Mismatched amount
      await handler({
        method: 'POST',
        query: { action: 'confirm-escrow' },
        headers: { authorization: 'Bearer admin-test-token' },
        body: {
          transactionId: txId,
          verifiedEscrowReference: 'REF-03',
          amount: 100, // agreed is 500000
          currency: 'EGP',
        },
      }, mockRes);

      expect(statusRes).toBe(422);
      expect(jsonRes.error).toContain('AMOUNT_MISMATCH');

      // Mismatched currency
      await handler({
        method: 'POST',
        query: { action: 'confirm-escrow' },
        headers: { authorization: 'Bearer admin-test-token' },
        body: {
          transactionId: txId,
          verifiedEscrowReference: 'REF-03',
          amount: 500000,
          currency: 'USD', // agreed is EGP
        },
      }, mockRes);

      expect(statusRes).toBe(422);
      expect(jsonRes.error).toContain('CURRENCY_MISMATCH');

      // Non-settled status
      await handler({
        method: 'POST',
        query: { action: 'confirm-escrow' },
        headers: { authorization: 'Bearer admin-test-token' },
        body: {
          transactionId: txId,
          verifiedEscrowReference: 'REF-03',
          settlementStatus: 'FAILED',
        },
      }, mockRes);

      expect(statusRes).toBe(422);
      expect(jsonRes.error).toContain('PAYMENT_NOT_SETTLED');
    });

    it('Requirement 8: Fails closed with HTTP 503 when database persistence is unavailable in production', async () => {
      const { default: handler } = await import('../../api/transactions');
      const { setAdminServicesForTesting, resetAdminServicesForTesting } = await import('../../api/reconstruction');
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSecret = process.env.WORKER_SHARED_SECRET;
      process.env.NODE_ENV = 'production';
      process.env.WORKER_SHARED_SECRET = 'mock-worker-secret-for-test-32chars';

      const mockAdminAuth = {
        verifyIdToken: async () => ({ uid: 'user-token', admin: false }),
      };
      setAdminServicesForTesting(null, mockAdminAuth);

      let statusRes = 0;
      let jsonRes: any = null;
      const mockRes = {
        status: (s: number) => { statusRes = s; return mockRes; },
        json: (j: any) => { jsonRes = j; return mockRes; },
      };

      try {
        await handler({
          method: 'POST',
          query: { action: 'create-offer' },
          headers: { authorization: 'Bearer user-token' },
          body: {
            propertyId: 'p-prod',
            agreedPrice: 5000000,
            buyer: { id: 'user-token' },
            seller: { id: 'seller-prod' },
          },
        }, mockRes);

        expect(statusRes).toBe(503);
        expect(jsonRes.error).toContain('DATABASE_PERSISTENCE_FAILED');
      } finally {
        resetAdminServicesForTesting();
        process.env.NODE_ENV = originalNodeEnv;
        process.env.WORKER_SHARED_SECRET = originalSecret;
      }
    });
  });
});
