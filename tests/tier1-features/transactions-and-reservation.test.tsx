import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  calculateReservationDeposit,
  createPropertyOffer,
  acceptOffer,
  placeReservationDeposit,
  finalizeClosing,
  cancelTransaction,
  getTransactionStatusLabel,
} from '../../src/services/transactions/reservation-service';
import { ReservationModal } from '../../src/components/transactions/ReservationModal';
import { TransactionManagementCard } from '../../src/components/transactions/TransactionManagementCard';
import { Property, TransactionRecord } from '../../src/types';

describe('Tier 1 — Phase 7: Transactions & Reservation Domain', () => {
  describe('Reservation Engine & Business Rules', () => {
    it('calculates 5% standard escrow deposit amount correctly', () => {
      const { depositAmount, depositPercent } = calculateReservationDeposit(10000000, 5);
      expect(depositAmount).toBe(500000);
      expect(depositPercent).toBe(5);
    });

    it('rejects offer if buyer and seller are the same user', () => {
      expect(() => {
        createPropertyOffer({
          propertyId: 'p-1',
          propertyTitle: 'Sheikh Zayed Villa',
          agreedPrice: 15000000,
          buyer: { id: 'user-same', name: 'Buyer', phone: '123' },
          seller: { id: 'user-same', name: 'Seller' },
        });
      }).toThrow(/seller cannot place an offer on their own property/i);
    });

    it('rejects offer with non-positive price', () => {
      expect(() => {
        createPropertyOffer({
          propertyId: 'p-1',
          propertyTitle: 'Sheikh Zayed Villa',
          agreedPrice: -500,
          buyer: { id: 'buyer-1', name: 'Buyer', phone: '123' },
          seller: { id: 'seller-1', name: 'Seller' },
        });
      }).toThrow(/must be greater than zero/i);
    });

    it('creates formal offer with unique idempotency key and initial unpaid status', () => {
      const tx = createPropertyOffer({
        propertyId: 'p-100',
        propertyTitle: 'New Cairo Penthouse',
        agreedPrice: 8000000,
        buyer: { id: 'buyer-99', name: 'Omar Sherif', phone: '+201012345678' },
        seller: { id: 'seller-88', name: 'Tarek Nour' },
        depositPercent: 5,
      });

      expect(tx.status).toBe('offer_submitted');
      expect(tx.depositStatus).toBe('unpaid');
      expect(tx.depositAmount).toBe(400000);
      expect(tx.idempotencyKey).toBeTruthy();
    });

    it('allows seller to accept offer and blocks unauthorized users', () => {
      const tx = createPropertyOffer({
        propertyId: 'p-100',
        propertyTitle: 'New Cairo Penthouse',
        agreedPrice: 8000000,
        buyer: { id: 'buyer-99', name: 'Omar Sherif', phone: '+201012345678' },
        seller: { id: 'seller-88', name: 'Tarek Nour' },
      });

      // Unauthorized acceptance attempt
      expect(() => acceptOffer(tx, 'random-intruder')).toThrow(/Unauthorized/i);

      // Legitimate seller accepts
      const accepted = acceptOffer(tx, 'seller-88');
      expect(accepted.status).toBe('offer_accepted');
    });

    it('funds reservation deposit into escrow and issues receipt number', () => {
      const tx = createPropertyOffer({
        propertyId: 'p-100',
        propertyTitle: 'New Cairo Penthouse',
        agreedPrice: 8000000,
        buyer: { id: 'buyer-99', name: 'Omar Sherif', phone: '+201012345678' },
        seller: { id: 'seller-88', name: 'Tarek Nour' },
      });
      const accepted = acceptOffer(tx, 'seller-88');

      const escrow = placeReservationDeposit(accepted, 'instapay', 'buyer-99');
      expect(escrow.transaction.status).toBe('deposit_escrowed');
      expect(escrow.transaction.depositStatus).toBe('held_in_escrow');
      expect(escrow.receiptNumber).toContain('RCP-HET');
      expect(escrow.escrowReference).toContain('ESCROW-CBE');
    });

    it('finalizes contract closing and title transfer', () => {
      const tx: TransactionRecord = {
        id: 'tx-closing-1',
        propertyId: 'p-100',
        propertyTitle: 'New Cairo Penthouse',
        agreedPrice: 8000000,
        currency: 'EGP',
        buyerId: 'buyer-99',
        buyerName: 'Omar',
        buyerPhone: '123',
        sellerId: 'seller-88',
        sellerName: 'Tarek',
        depositAmount: 400000,
        depositPercent: 5,
        depositStatus: 'held_in_escrow',
        status: 'deposit_escrowed',
        idempotencyKey: 'idemp-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const closed = finalizeClosing(tx, 'compliance_admin', 'DEED-9842');
      expect(closed.status).toBe('completed');
      expect(closed.depositStatus).toBe('released_to_seller');
      expect(closed.closingDate).toBeTruthy();
    });

    it('refunds escrow deposit to buyer when transaction cancelled by seller', () => {
      const tx: TransactionRecord = {
        id: 'tx-cancel-1',
        propertyId: 'p-100',
        propertyTitle: 'New Cairo Penthouse',
        agreedPrice: 8000000,
        currency: 'EGP',
        buyerId: 'buyer-99',
        buyerName: 'Omar',
        buyerPhone: '123',
        sellerId: 'seller-88',
        sellerName: 'Tarek',
        depositAmount: 400000,
        depositPercent: 5,
        depositStatus: 'held_in_escrow',
        status: 'deposit_escrowed',
        idempotencyKey: 'idemp-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const cancellation = cancelTransaction(tx, 'seller', 'Seller unable to deliver on time');
      expect(cancellation.refundGranted).toBe(true);
      expect(cancellation.refundAmount).toBe(400000);
      expect(cancellation.transaction.status).toBe('refunded');
      expect(cancellation.transaction.depositStatus).toBe('refunded_to_buyer');
    });
  });

  describe('UI Integration — Reservation Modal & Management Card', () => {
    const mockProperty: Property = {
      id: 'prop-res-1',
      title: 'Waterway Penthouse',
      price: 12000000,
      location: 'New Cairo',
      bedrooms: 3,
      bathrooms: 3,
      area: 250,
      imageUrl: 'https://cdn.hettety.com/waterway.jpg',
      authorUid: 'seller-ww',
      developer: 'Equity Real Estate',
      status: 'For Sale',
      isVerified: true,
    };

    it('navigates through 3-step ReservationModal and completes escrow hold', () => {
      const onCompleteMock = vi.fn();

      render(
        <ReservationModal
          isOpen={true}
          onClose={vi.fn()}
          property={mockProperty}
          currentUserId="buyer-user-77"
          currentUserName="Hossam Ghaly"
          currentUserPhone="+201122334455"
          onReservationComplete={onCompleteMock}
          isRtl={false}
        />
      );

      expect(screen.getByTestId('reservation-modal')).toBeInTheDocument();
      expect(screen.getByText('Official Escrow Property Reservation')).toBeInTheDocument();

      // Step 1: Proceed to Secured Payment
      const proceedBtn = screen.getByRole('button', { name: /Proceed to Secured Payment/i });
      fireEvent.click(proceedBtn);

      // Step 2: Confirm & Fund
      expect(screen.getByText(/Select your preferred payment method/i)).toBeInTheDocument();
      const fundBtn = screen.getByRole('button', { name: /Confirm & Fund/i });
      fireEvent.click(fundBtn);

      // Step 3: Receipt View
      expect(screen.getByTestId('escrow-receipt-view')).toBeInTheDocument();
      expect(screen.getByText('Escrow Deposit Successfully Secured!')).toBeInTheDocument();
      expect(onCompleteMock).toHaveBeenCalled();
    });

    it('renders TransactionManagementCard with status badge and seller action', () => {
      const mockTx: TransactionRecord = {
        id: 'tx-card-1',
        propertyId: 'prop-res-1',
        propertyTitle: 'Waterway Penthouse',
        agreedPrice: 12000000,
        currency: 'EGP',
        buyerId: 'buyer-user-77',
        buyerName: 'Hossam Ghaly',
        buyerPhone: '+201122334455',
        sellerId: 'seller-ww',
        sellerName: 'Equity Real Estate',
        depositAmount: 600000,
        depositPercent: 5,
        depositStatus: 'unpaid',
        status: 'offer_submitted',
        idempotencyKey: 'idemp-card-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const acceptMock = vi.fn();

      render(
        <TransactionManagementCard
          transaction={mockTx}
          currentUserId="seller-ww"
          onAcceptOffer={acceptMock}
          isRtl={false}
        />
      );

      expect(screen.getByTestId('transaction-management-card')).toBeInTheDocument();
      expect(screen.getByText('Offer Submitted')).toBeInTheDocument();
      expect(screen.getByText(/12,000,000 EGP/i)).toBeInTheDocument();
      expect(screen.getByText(/600,000 EGP/i)).toBeInTheDocument();

      const acceptBtn = screen.getByRole('button', { name: /Accept Offer/i });
      fireEvent.click(acceptBtn);
      expect(acceptMock).toHaveBeenCalledWith('tx-card-1');
    });
  });
});
