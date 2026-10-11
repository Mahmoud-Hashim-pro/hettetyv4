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
});
