import React from 'react';

export interface BrandButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'accent' | 'outline' | 'ghost' | 'white' | 'black';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  ariaLabel?: string;
}

export const BrandButton: React.FC<BrandButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled = false,
  type = 'button',
  ariaLabel,
}) => {
  const base =
    'px-6 py-3 rounded-xl font-bold transition-all duration-300 inline-flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:active:scale-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950';
  const variants = {
    primary:
      'bg-brand-600 dark:bg-accent-500 text-white hover:bg-brand-700 dark:hover:bg-accent-600 hover:shadow-lg shadow-brand-600/20 dark:shadow-accent-500/25',
    accent: 'bg-accent-500 text-white hover:bg-accent-600 hover:shadow-lg shadow-accent-500/25',
    outline:
      'border-2 border-brand-600 dark:border-brand-400 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30',
    ghost:
      'text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800',
    white: 'bg-white text-brand-900 hover:bg-brand-50 hover:shadow-xl',
    black:
      'bg-slate-900 dark:bg-accent-500 text-white hover:bg-slate-800 dark:hover:bg-accent-600 hover:shadow-xl dark:shadow-accent-500/25',
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${base} ${variants[variant]} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
};

export default BrandButton;
