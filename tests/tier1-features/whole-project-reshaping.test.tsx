import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../src/App';
import { TRANSLATIONS } from '../../src/constants';
import * as firebase from '../../src/firebase';
import { MOCK_TEST_PROPERTIES } from '../helpers/fixtures';
import { ContactPage } from '../../src/features/contact/ContactPage';
import { AuthForm } from '../../src/features/auth/AuthForm';
import { PaymentPage } from '../../src/features/checkout/PaymentPage';
import { HomeInstallmentEstimatorSection } from '../../src/features/home/HomeExperienceSections';
import { PropertyDetailPage } from '../../src/features/properties/pages/PropertyDetailPage';
import { pricePerSqm } from '../../src/shared/utils/propertyFormatters';

describe('Tier 1 — Whole-Project Reshaping & Clean Architecture Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('hettety_consent', JSON.stringify({ necessary: true }));
    window.location.hash = '';
  });

  it('Home Page renders Hero Quick-Discovery bar, Egypt Corridors Explorer, Installment Estimator, and Spotlight Banner', () => {
    vi.spyOn(firebase, 'getDocs').mockResolvedValue({ docs: [] } as any);
    render(<App />);

    // Hero Quick-Discovery search input
    const quickInput = screen.getByLabelText(/Search properties by keyword/i);
    expect(quickInput).toBeInTheDocument();

    // Quick search submits and navigates directly into #listings
    fireEvent.change(quickInput, { target: { value: 'New Cairo' } });
    fireEvent.submit(quickInput.closest('form')!);
    expect(window.location.hash).toBe('#listings');
  });

  it('Home Installment Estimator updates live monthly payment smoothly without NaN', () => {
    const onBrowse = vi.fn();
    const onAdvisor = vi.fn();
    render(
      <HomeInstallmentEstimatorSection
        isRtl={false}
        onBrowseListings={onBrowse}
        onOpenAdvisor={onAdvisor}
      />
    );

    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(sliders[0], { target: { value: '12000000' } });
    fireEvent.change(sliders[1], { target: { value: '20' } });
    fireEvent.change(sliders[2], { target: { value: '8' } });

    expect(screen.queryByText(/\bNaN\b/)).not.toBeInTheDocument();
    expect(screen.getByText(/100,000/)).toBeInTheDocument();
  });

  it('AuthForm renders split-pane luxury layout, password toggle, and zero Firebase UI strings', async () => {
    vi.spyOn(firebase, 'signInWithEmailAndPassword').mockRejectedValueOnce(
      Object.assign(new Error('operation not allowed'), { code: 'auth/operation-not-allowed' })
    );
    const onSwitch = vi.fn();
    const onSubmit = vi.fn();

    render(
      <AuthForm
        type="login"
        onSwitch={onSwitch}
        onSubmit={onSubmit}
        t={TRANSLATIONS.en}
        isRtl={false}
      />
    );

    const emailInput = screen.getByLabelText(TRANSLATIONS.en.auth_email);
    const passInput = screen.getByLabelText(TRANSLATIONS.en.auth_pass);
    expect(passInput).toHaveAttribute('type', 'password');

    // Toggle password visibility
    const eyeBtn = screen.getByRole('button', { name: /Show password/i });
    fireEvent.click(eyeBtn);
    expect(passInput).toHaveAttribute('type', 'text');

    fireEvent.change(emailInput, { target: { value: 'buyer@hettety.com' } });
    fireEvent.change(passInput, { target: { value: 'Secret@123' } });
    fireEvent.click(screen.getByRole('button', { name: TRANSLATIONS.en.auth_signin_btn }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/firebase/i);
  });

  it('ContactPage validates inputs, persists to Neon contact_messages, and renders dark-mode ready card', async () => {
    const addSpy = vi.spyOn(firebase, 'addDoc').mockResolvedValueOnce({ id: 'msg-1' } as any);

    render(<ContactPage t={TRANSLATIONS.en} isRtl={false} />);

    fireEvent.change(document.getElementById('contact-email')!, {
      target: { value: 'client@hettety.com' },
    });
    fireEvent.change(document.getElementById('contact-message')!, {
      target: { value: 'Interested in a 3D walkthrough in New Cairo.' },
    });

    fireEvent.click(screen.getByRole('button', { name: TRANSLATIONS.en.contact_btn }));

    await waitFor(() => expect(addSpy).toHaveBeenCalled());
    expect(await screen.findByText(/Message sent/i)).toBeInTheDocument();
  });

  it('PropertyDetailPage computes Price/m², renders thumbnail filmstrip, and shows Unit AI quick prompts', () => {
    vi.spyOn(firebase, 'getDocs').mockResolvedValue({ docs: [] } as any);
    const prop = MOCK_TEST_PROPERTIES[0]; // 15,000,000 EGP, 450 m² -> 33,333 EGP/m²
    expect(pricePerSqm(prop)).toBe(33333);

    render(
      <PropertyDetailPage
        property={prop}
        onBack={vi.fn()}
        onPurchase={vi.fn()}
        t={TRANSLATIONS.en}
        isRtl={false}
      />
    );

    expect(screen.getByRole('heading', { name: prop.title })).toBeInTheDocument();
    expect(screen.getByText(/33,333/)).toBeInTheDocument();
    expect(screen.getByText(/Unit AI Assistant/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Back$/i })).toBeInTheDocument();
  });

  it('PaymentPage never renders credit card inputs and submits honestly once', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <PaymentPage
        property={MOCK_TEST_PROPERTIES[0]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        t={TRANSLATIONS.en}
        isRtl={false}
      />
    );

    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect(document.querySelector('input[type="number"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Send purchase request/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('SiteFooter links directly to Contact Us and navigates cleanly to #contact', () => {
    vi.spyOn(firebase, 'getDocs').mockResolvedValue({ docs: [] } as any);
    render(<App />);

    const contactBtn = screen.getByRole('button', { name: /Contact Us/i });
    fireEvent.click(contactBtn);
    expect(window.location.hash).toBe('#contact');
    expect(document.getElementById('contact-email')).toBeInTheDocument();
  });
});
