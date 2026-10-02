import React from 'react';
import { motion } from 'motion/react';

export interface BrandLogoProps {
  variant?: 'horizontal' | 'full' | 'mark';
  color?: string;
  className?: string;
  isDark?: boolean;
  isRtl?: boolean;
  showTagline?: boolean;
  size?: 'sm' | 'md' | 'lg' | string;
}

/**
 * Slanted HT monogram:
 * - Slant: -14 degrees (forward italic)
 * - Letter H: Navy #0A2042 in light mode / Crisp White #FFFFFF in dark mode
 * - Letter T: Vibrant Orange #FF5722
 */
export const BrandMonogram: React.FC<{
  className?: string;
  color?: string;
  isWhite?: boolean;
  size?: number | string;
}> = ({ className = 'h-10 w-auto', color, isWhite = false, size }) => {
  const navyColor = isWhite ? '#FFFFFF' : (color && color !== 'currentColor' ? color : 'currentColor');
  const orangeColor = '#FF5722';
  const inlineStyle = size ? { width: size, height: size } : undefined;

  return (
    <motion.svg
      viewBox="80 90 290 180"
      className={className}
      style={inlineStyle}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      initial={{ opacity: 0.95 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      aria-label="HETTETY Monogram"
    >
      <defs>
        <filter id="ht-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.15" />
        </filter>
      </defs>

      <g transform="translate(230, 180) skewX(-14) translate(-230, -180)" filter="url(#ht-shadow)">
        {/* Letter H */}
        <path
          d="M 115 110 L 155 110 L 155 165 L 235 165 L 235 250 L 195 250 L 195 195 L 155 195 L 155 250 L 115 250 Z"
          fill={navyColor}
          className="transition-colors duration-300"
        />

        {/* Letter T */}
        <path
          d="M 175 110 L 350 110 L 350 145 L 295 145 L 295 250 L 255 250 L 255 145 L 175 145 Z"
          fill={orangeColor}
        />
      </g>
    </motion.svg>
  );
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'horizontal',
  color = 'currentColor',
  className = 'h-12 w-auto',
  isDark = false,
  isRtl = false,
  showTagline = true,
  size
}) => {
  const isWhite = color === 'white' || color === '#ffffff' || isDark;
  const navyTextColor = isWhite ? '#FFFFFF' : (color === 'currentColor' ? 'currentColor' : '#0A2042');
  const orangeColor = '#FF5722';
  const tagline = isRtl ? 'ابحث. ثق. امتلك.' : 'FIND. TRUST. OWN.';

  if (variant === 'mark') {
    return <BrandMonogram className={className} color={color} isWhite={isWhite} size={size} />;
  }

  if (variant === 'full') {
    // 1:1 Stacked Logo (for Splash Screen, About, etc.)
    return (
      <div className={`flex flex-col items-center justify-center text-center select-none ${className}`}>
        <BrandMonogram className="h-24 sm:h-28 w-auto mb-2" color={color} isWhite={isWhite} />
        <span
          className="text-2xl sm:text-3xl font-black tracking-[0.25em] font-sans block leading-tight transition-colors duration-300"
          style={{ color: navyTextColor }}
        >
          HETTETY
        </span>
        {showTagline && (
          <span
            className="text-[10px] sm:text-xs font-extrabold tracking-[0.2em] uppercase block mt-1"
            style={{ color: orangeColor }}
          >
            {tagline}
          </span>
        )}
      </div>
    );
  }

  // Default: Horizontal Variant (Monogram + Wordmark inline)
  return (
    <div className={`flex items-center gap-2.5 sm:gap-3 select-none ${className}`}>
      <BrandMonogram className="h-10 sm:h-12 w-auto shrink-0" color={color} isWhite={isWhite} />
      <div className="flex flex-col justify-center leading-none text-start">
        <span
          className="text-lg sm:text-xl font-black tracking-[0.2em] font-sans block leading-none transition-colors duration-300"
          style={{ color: navyTextColor }}
        >
          HETTETY
        </span>
        {showTagline && (
          <span
            className="text-[8px] sm:text-[9px] font-extrabold tracking-[0.18em] uppercase block mt-1 leading-none"
            style={{ color: orangeColor }}
          >
            {tagline}
          </span>
        )}
      </div>
    </div>
  );
};

export default BrandLogo;
