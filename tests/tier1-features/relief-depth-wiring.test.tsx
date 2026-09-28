import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../../src/App';
import * as firebase from '../../src/firebase';
import { Property } from '../../src/types';

/** Captures what the property page hands the 3D viewer. */
const seen: Record<string, any>[] = [];
vi.mock('../../src/components/Property3DViewer', () => ({
  default: (props: Record<string, any>) => {
    seen.push(props);
    return <div data-testid="viewer" />;
  },
}));

const unit = (over: Partial<Property> = {}): Property => ({
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
  images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'],
  depthMaps: ['data:image/png;base64,DDDD', 'data:image/png;base64,EEEE'],
  ...over,
});

const open3D = async (p: Property) => {
  seen.length = 0;
  vi.spyOn(firebase, 'getDocs').mockImplementation(
    async () => ({ docs: [{ id: p.id, data: () => p }] }) as any
  );
  window.location.hash = `#property/${p.id}`;
  render(<App />);
  // Generous: these render the whole App and run alongside every other suite.
  fireEvent.click(await screen.findByRole('button', { name: /View in 3D|360° Tour/ }, { timeout: 10000 }));
  await screen.findByTestId('viewer', {}, { timeout: 10000 });
  return seen[seen.length - 1];
};

describe('Tier 1 — the property page hands the viewer everything it has', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('hettety_consent', JSON.stringify({ necessary: true }));
  });

  it('passes the stored depth maps, index-matched to the photos', async () => {
    // displacementScale falls to 0 when depth is absent, so omitting these did
    // not fail loudly — it silently turned the relief off. The order matters as
    // much as the presence: map [1] belongs to photo [1].
    const props = await open3D(unit());
    expect(props.depthMaps).toEqual(['data:image/png;base64,DDDD', 'data:image/png;base64,EEEE']);
    expect(props.depthMaps).toHaveLength(props.images.length);
  }, 20000);

  it('passes a real walkthrough through so the viewer can offer it', async () => {
    const props = await open3D(unit({ digitalTwinUrl: 'https://my.matterport.com/show/?m=abc' }));
    expect(props.tourUrl).toBe('https://my.matterport.com/show/?m=abc');
  }, 20000);

  it('passes no tour URL when the link is not one we allow', async () => {
    const props = await open3D(unit({ digitalTwinUrl: 'javascript:alert(1)' }));
    expect(props.tourUrl).toBeFalsy();
  }, 20000);
});
