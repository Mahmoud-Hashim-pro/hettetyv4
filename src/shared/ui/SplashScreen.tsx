import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BrandMonogram } from '../../components/BrandLogo';

export interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowButton(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      className="fixed inset-0 z-[9999] bg-white dark:bg-slate-950 flex flex-col items-center justify-center overflow-hidden transition-colors duration-500"
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
        className="relative flex flex-col items-center gap-10"
      >
        <div className="relative">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.12, 0.28, 0.12],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-[-50%] bg-brand-500/20 blur-[100px] rounded-full"
          />
          <BrandMonogram className="h-32 md:h-44 w-auto relative z-10 text-brand-900 dark:text-white transition-colors" />
        </div>

        <div className="text-center space-y-6">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
          >
            <h1 className="text-5xl md:text-7xl font-black text-brand-900 dark:text-white tracking-widest mb-4 uppercase font-heading">
              HETTETY
            </h1>
            <div className="flex items-center justify-center gap-4">
              <div className="h-0.5 w-12 bg-accent-300 dark:bg-accent-900/50" />
              <p className="text-accent-500 font-black uppercase tracking-[0.3em] text-xs md:text-sm">
                FIND. TRUST. OWN.
              </p>
              <div className="h-0.5 w-12 bg-accent-300 dark:bg-accent-900/50" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: showButton ? 1 : 0 }}
            className="pt-8"
          >
            <button
              type="button"
              onClick={onFinish}
              className="px-10 py-4 bg-brand-600 text-white font-black uppercase tracking-[0.2em] text-sm rounded-full hover:bg-brand-700 shadow-2xl shadow-brand-600/30 transform hover:-translate-y-1 active:scale-95 transition-all cursor-pointer border border-brand-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              Enter HETTETY
            </button>
          </motion.div>
        </div>
      </motion.div>

      {!showButton && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 3, ease: 'linear' }}
          className="absolute bottom-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-600 via-accent-500 to-brand-600 origin-left"
        />
      )}
    </motion.div>
  );
};

export default SplashScreen;
