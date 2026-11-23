import React, { useState } from 'react';
import { Building2 } from 'lucide-react';

export interface PropertyImageProps {
  src?: string;
  alt: string;
  className?: string;
  iconSize?: number;
  priority?: boolean;
}

/** A property photo that falls back gracefully to an architectural placeholder when absent or broken. */
export const PropertyImage: React.FC<PropertyImageProps> = ({
  src,
  alt,
  className = '',
  iconSize = 24,
  priority = false,
}) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`${className} flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 text-slate-400 dark:text-slate-500`}
      >
        <Building2 size={iconSize} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

export default PropertyImage;
