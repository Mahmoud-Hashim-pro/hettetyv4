import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../../src/App';
import * as firebase from '../../src/firebase';
import { Property } from '../../src/types';

// The viewer chunk is gone, exactly as it is for anyone whose page was open
// when a deploy replaced it.
vi.mock('../../src/components/Property3DViewer', () => {
  throw new TypeError(
    'Failed to fetch dynamically imported module: /assets/Property3DViewer-ChvvJEOd.js'
  );
});

const unit: Property = {
  id: 'p1',
  title: 'ONE33 — Apartment Fully Finished',
  price: 0,
  location: 'Sheikh Zayed',
  bedrooms: 2,
  bathrooms: 2,
  area: 133,
  propertyType: 'Apartment',
  status: 'For Sale',
  isVerified: false,
  verificationStatus: 'Pending',
  imageUrl: 'data:image/jpeg;base64,AAAA',
  images: ['data:image/jpeg;base64,AAAA'],
};

describe('Tier 1 — a viewer that cannot load says so', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hettety_consent', JSON.stringify({ necessary: true }));
    // Pretend the one reload has already been spent, so we see what the reader
    // is left with when refreshing did not bring the chunk back.
    sessionStorage.setItem('hettety_chunk_reload_viewer3d', '1');
    vi.spyOn(firebase, 'getDocs').mockImplementation(
      async () => ({ docs: [{ id: unit.id, data: () => unit }] }) as any
    );
    window.location.hash = `#property/${unit.id}`;
  });

  it('shows a way out instead of a spinner that never stops', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /View in 3D/ }, { timeout: 15000 }));

      const dialog = await screen.findByRole('alertdialog', {}, { timeout: 15000 });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh the page/ })).toBeInTheDocument();
    } finally {
      err.mockRestore();
    }
  }, 20000);

  it('leaves the property page underneath intact so nothing is lost', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /View in 3D/ }, { timeout: 15000 }));
      await screen.findByRole('alertdialog', {}, { timeout: 15000 });

      fireEvent.click(screen.getByRole('button', { name: /Close/ }));
      expect(await screen.findByRole('heading', { name: unit.title }, { timeout: 10000 })).toBeInTheDocument();
    } finally {
      err.mockRestore();
    }
  }, 20000);
});
