import React from 'react';
import {
  Sparkles,
  Sun,
  Moon,
  Bell,
  ChevronRight,
  Shield,
  User,
  PlusCircle,
  LogOut,
  Menu,
  X,
  CheckCheck,
  Home,
  Building2,
  Waves,
  Box,
  FileCheck,
  Info,
  Mail,
} from 'lucide-react';
import BrandLogo from '../../components/BrandLogo';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Notification, Page } from '../../types';

export interface SiteNavbarProps {
  currentPage: Page;
  lang: 'en' | 'ar';
  isRtl: boolean;
  isDarkMode: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  userEmail: string | null;
  userName: string | null;
  notifications: Notification[];
  mobileMenuOpen: boolean;
  showNotifications: boolean;
  showProfileMenu: boolean;
  t: any;
  onNavigate: (page: Page) => void;
  onToggleDarkMode: () => void;
  onToggleLanguage: () => void;
  onToggleMobileMenu: () => void;
  onCloseMobileMenu: () => void;
  onToggleNotifications: () => void;
  onMarkAllRead?: () => void;
  onToggleProfileMenu: () => void;
  onCloseMenus: () => void;
  onLogout: () => void;
}

export const SiteNavbar: React.FC<SiteNavbarProps> = ({
  currentPage,
  lang,
  isRtl,
  isDarkMode,
  isAdmin,
  isSuperAdmin,
  userEmail,
  userName,
  notifications,
  mobileMenuOpen,
  showNotifications,
  showProfileMenu,
  t = {},
  onNavigate,
  onToggleDarkMode,
  onToggleLanguage,
  onToggleMobileMenu,
  onCloseMobileMenu,
  onToggleNotifications,
  onMarkAllRead,
  onToggleProfileMenu,
  onCloseMenus,
  onLogout,
}) => {
  const mobileMenuRef = useFocusTrap<HTMLDivElement>(mobileMenuOpen, onCloseMobileMenu);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const DesktopNavLink = ({ page, label }: { page: Page; label: string }) => {
    const isActive = currentPage === page;
    return (
      <button
        type="button"
        onClick={() => onNavigate(page)}
        aria-current={isActive ? 'page' : undefined}
        className={`relative text-xs 2xl:text-sm font-bold transition-all duration-200 cursor-pointer py-2 px-2.5 2xl:px-3 rounded-xl whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-brand-500 ${
          isActive
            ? 'text-[#1b2c4d] dark:text-white font-black bg-brand-50/90 dark:bg-slate-800/90'
            : 'text-slate-600 dark:text-slate-300 hover:text-[#1b2c4d] dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
        }`}
      >
        <span>{label}</span>
        {isActive && (
          <span
            className="absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-accent-500"
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  const handleMobileNav = (page: Page) => {
    onCloseMobileMenu();
    onNavigate(page);
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full max-w-full">
        <nav
          aria-label={isRtl ? 'التنقل الرئيسي' : 'Main Navigation'}
          className="bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 text-slate-900 dark:text-white shadow-[0_6px_28px_rgba(27,44,77,0.05)] dark:shadow-[0_6px_28px_rgba(0,0,0,0.45)] transition-all duration-300 w-full max-w-full"
        >
          <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 h-20 flex items-center justify-between min-w-0 gap-2">
            {/* Brand Logo */}
            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                aria-label="HETTETY Home"
                className="cursor-pointer transform hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl p-1"
              >
                <BrandLogo
                  variant="horizontal"
                  color="currentColor"
                  isDark={isDarkMode}
                  isRtl={isRtl}
                  className="h-10 sm:h-11 xl:h-12 w-auto text-[#1b2c4d] dark:text-white transition-colors"
                />
              </button>
            </div>

            {/* Desktop Nav & Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-2.5 xl:gap-3 min-w-0">
              {/* Desktop Links */}
              <div className="hidden lg:flex items-center gap-0.5 xl:gap-1 2xl:gap-1.5 min-w-0 flex-nowrap whitespace-nowrap">
                <DesktopNavLink page="home" label={t.nav_home} />
                <DesktopNavLink page="listings" label={t.nav_listings} />
                <DesktopNavLink
                  page="yalla-sahel"
                  label={isRtl ? '🌊 ساحل حتتي' : '🌊 Sahel Hettety'}
                />
                <DesktopNavLink
                  page="3d-experience"
                  label={isRtl ? 'جولات 3D' : '3D Tours'}
                />
                <DesktopNavLink page="legal" label={t.nav_trust} />
                {isAdmin && (
                  <DesktopNavLink
                    page="manage-users"
                    label={isRtl ? 'لوحة التحكم' : 'Dashboard'}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onNavigate('ai-chat')}
                  aria-current={currentPage === 'ai-chat' ? 'page' : undefined}
                  className={`font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer px-3 xl:px-3.5 py-2 rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500 shrink-0 mx-0.5 ${
                    isRtl ? 'font-cairo' : 'uppercase tracking-wider'
                  } ${
                    currentPage === 'ai-chat'
                      ? 'bg-accent-500 text-white shadow-accent-500/30'
                      : 'bg-[#1b2c4d] dark:bg-slate-800 text-white dark:text-slate-100 hover:bg-brand-700 dark:hover:bg-accent-500 border border-brand-700/20 dark:border-slate-700'
                  }`}
                >
                  <Sparkles size={13} className="text-accent-300" aria-hidden="true" />
                  <span>{t.advisor_nav || t.nav_ai}</span>
                </button>
                <DesktopNavLink page="about" label={t.footer_about} />
              </div>

              {/* Utility & Account Actions */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Theme & Language (Desktop/Tablet) */}
                <div className="hidden md:flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onToggleDarkMode}
                    aria-label="Toggle Theme"
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-all flex items-center justify-center cursor-pointer border border-slate-200/80 dark:border-slate-800 hover:border-brand-300 dark:hover:border-slate-600 shadow-xs active:scale-90 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <span className="transform transition-transform duration-300 hover:rotate-12">
                      {isDarkMode ? (
                        <Sun size={17} className="text-amber-400" aria-hidden="true" />
                      ) : (
                        <Moon size={17} className="text-[#1b2c4d]" aria-hidden="true" />
                      )}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleLanguage}
                    aria-label={
                      isRtl ? 'Switch language to English' : 'تغيير اللغة إلى العربية'
                    }
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[#1b2c4d] dark:text-slate-200 transition-all flex items-center justify-center cursor-pointer border border-slate-200/80 dark:border-slate-800 hover:border-brand-300 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <span className="text-xs font-black tracking-wider leading-none">
                      {lang === 'en' ? 'AR' : 'EN'}
                    </span>
                  </button>
                </div>

                {/* Notifications Dropdown */}
                {userEmail && (
                  <div className="relative" data-menu>
                    <button
                      type="button"
                      onClick={onToggleNotifications}
                      aria-label={
                        isRtl
                          ? `الإشعارات (${unreadCount} غير مقروء)`
                          : `Notifications (${unreadCount} unread)`
                      }
                      aria-haspopup="dialog"
                      aria-expanded={showNotifications}
                      className="relative min-w-[40px] min-h-[40px] sm:min-w-[42px] sm:min-h-[42px] p-2 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer border border-slate-200/80 dark:border-slate-800 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <Bell size={18} aria-hidden="true" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-white text-[10px] font-black flex items-center justify-center border-2 border-white dark:border-slate-950 shadow-sm">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>

                    {showNotifications && (
                      <div
                        role="dialog"
                        aria-label={isRtl ? 'لوحة الإشعارات' : 'Notifications panel'}
                        className="absolute top-full mt-3 end-0 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden z-50 animate-fade-in"
                      >
                        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-[#1b2c4d] dark:text-white text-xs uppercase tracking-wider">
                              {isRtl ? 'الإشعارات' : 'Notifications'}
                            </h3>
                            <span className="text-[10px] bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 px-2.5 py-0.5 rounded-full font-black">
                              {unreadCount} {isRtl ? 'جديد' : 'NEW'}
                            </span>
                          </div>
                          {onMarkAllRead && unreadCount > 0 && (
                            <button
                              type="button"
                              onClick={onMarkAllRead}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-accent-600 dark:text-accent-400 hover:underline cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 rounded"
                            >
                              <CheckCheck size={13} aria-hidden="true" />
                              <span>{isRtl ? 'قراءة الكل' : 'Mark all read'}</span>
                            </button>
                          )}
                        </div>

                        <div className="max-h-[26rem] overflow-y-auto custom-scrollbar">
                          {notifications.length === 0 ? (
                            <div className="p-12 text-center text-slate-400">
                              <Bell
                                className="w-10 h-10 mx-auto mb-3 opacity-20"
                                aria-hidden="true"
                              />
                              <p className="text-xs font-bold opacity-75">
                                {isRtl ? 'لا توجد إشعارات حالياً' : 'Inbox is empty'}
                              </p>
                            </div>
                          ) : (
                            notifications.map((notif) => (
                              <div
                                key={notif.id}
                                className={`p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-start ${
                                  !notif.read
                                    ? 'bg-accent-50/40 dark:bg-accent-500/5'
                                    : ''
                                }`}
                              >
                                <div className="flex items-start gap-2.5">
                                  {!notif.read && (
                                    <span
                                      className="w-2 h-2 rounded-full bg-accent-500 mt-1.5 shrink-0"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <h4 className="font-black text-[#1b2c4d] dark:text-white text-sm mb-1">
                                      {notif.title}
                                    </h4>
                                    <p className="text-slate-600 dark:text-slate-400 text-xs sm:text-sm leading-relaxed mb-2">
                                      {notif.message}
                                    </p>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                                      {new Date(notif.date).toLocaleDateString(
                                        isRtl ? 'ar-EG' : 'en-US'
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Profile Dropdown or Sign In */}
                <div className="relative shrink-0" data-menu>
                  {userEmail ? (
                    <>
                      <button
                        type="button"
                        onClick={onToggleProfileMenu}
                        aria-label={isRtl ? 'قائمة الملف الشخصي' : 'User Profile Menu'}
                        aria-haspopup="menu"
                        aria-expanded={showProfileMenu}
                        className="flex items-center gap-1.5 sm:gap-2 ps-1.5 pe-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900 hover:bg-slate-200/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 shrink-0"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1b2c4d] to-brand-500 text-white flex items-center justify-center font-black text-xs sm:text-sm uppercase shrink-0 shadow-xs">
                          {(userName || userEmail || 'U').charAt(0)}
                        </div>
                        <span className="hidden 2xl:inline-block text-xs sm:text-sm font-bold text-[#1b2c4d] dark:text-white max-w-[7.5rem] truncate shrink-0">
                          {userName || userEmail.split('@')[0]}
                        </span>
                        <ChevronRight
                          size={14}
                          className={`text-slate-400 transition-transform shrink-0 hidden sm:block ${
                            showProfileMenu ? '-rotate-90' : 'rotate-90'
                          }`}
                          aria-hidden="true"
                        />
                      </button>

                      {showProfileMenu && (
                        <div
                          role="menu"
                          className="absolute top-full mt-3 end-0 w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden z-50 animate-fade-in text-start"
                        >
                          {/* Profile Header */}
                          <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
                            <div className="font-black text-[#1b2c4d] dark:text-white text-base truncate">
                              {userName || (isRtl ? 'مستخدم' : 'User')}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {userEmail}
                            </div>
                            {isAdmin && (
                              <span
                                className={`inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                  isSuperAdmin
                                    ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400'
                                    : 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                                }`}
                              >
                                <Shield size={11} aria-hidden="true" />
                                {isSuperAdmin
                                  ? isRtl
                                    ? 'سوبر أدمن'
                                    : 'Super Admin'
                                  : isRtl
                                    ? 'أدمن'
                                    : 'Admin'}
                              </span>
                            )}
                          </div>

                          {/* Menu Items */}
                          <div className="py-2">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onCloseMenus();
                                onNavigate('profile');
                              }}
                              className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer min-w-0"
                            >
                              <User size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
                              <span className="truncate min-w-0 flex-1 text-start">
                                {isRtl ? 'الملف الشخصي' : 'Personal Profile'}
                              </span>
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  onCloseMenus();
                                  onNavigate('manage-users');
                                }}
                                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer min-w-0"
                              >
                                <Shield
                                  size={16}
                                  className="text-accent-500 shrink-0"
                                  aria-hidden="true"
                                />
                                <span className="truncate min-w-0 flex-1 text-start">
                                  {isRtl ? 'لوحة التحكم' : 'Operations Command Center'}
                                </span>
                              </button>
                            )}

                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onCloseMenus();
                                onNavigate('add-listing');
                              }}
                              className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer min-w-0"
                            >
                              <PlusCircle
                                size={16}
                                className="text-slate-400 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="truncate min-w-0 flex-1 text-start">
                                {isRtl ? 'إضافة عقار' : 'Add New Listing'}
                              </span>
                            </button>

                            <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onCloseMenus();
                                onLogout();
                              }}
                              className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer min-w-0"
                            >
                              <LogOut size={16} className="shrink-0" aria-hidden="true" />
                              <span className="truncate min-w-0 flex-1 text-start">
                                {isRtl ? 'تسجيل الخروج' : 'Sign Out'}
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate('login')}
                      className="bg-[#1b2c4d] hover:bg-brand-700 dark:bg-accent-500 dark:hover:bg-accent-600 text-white px-4 sm:px-5 py-2.5 rounded-full font-black text-xs sm:text-sm shadow-sm transition-all cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {isRtl ? 'تسجيل الدخول' : 'Sign In'}
                    </button>
                  )}
                </div>

                {/* Mobile Hamburger Toggle — MUST be the first button with class lg:hidden */}
                <button
                  type="button"
                  id="mobile-menu-toggle"
                  aria-label={
                    mobileMenuOpen
                      ? isRtl
                        ? 'إغلاق القائمة الرئيسية'
                        : 'Close main navigation menu'
                      : isRtl
                        ? 'فتح القائمة الرئيسية'
                        : 'Open main navigation menu'
                  }
                  aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-navigation-menu"
                  onClick={onToggleMobileMenu}
                  className="lg:hidden min-w-[48px] min-h-[48px] cursor-pointer text-[#1b2c4d] dark:text-white p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {mobileMenuOpen ? (
                    <X size={24} aria-hidden="true" />
                  ) : (
                    <Menu size={24} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile Full-Screen Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          id="mobile-navigation-menu"
          role="dialog"
          aria-modal="true"
          aria-label={isRtl ? 'قائمة التنقل للجوال' : 'Mobile Navigation Menu'}
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`lg:hidden fixed inset-0 z-[100] bg-white/98 dark:bg-slate-950/98 backdrop-blur-xl p-6 flex flex-col justify-between overflow-y-auto animate-fade-in shadow-2xl ${
            isRtl ? 'font-cairo' : ''
          }`}
        >
          <div>
            {/* Drawer Header */}
            <div className="w-full flex justify-between items-center pb-6 mb-6 border-b border-slate-100 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => handleMobileNav('home')}
                aria-label="HETTETY Home"
                className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl"
              >
                <BrandLogo
                  variant="horizontal"
                  color="currentColor"
                  isDark={isDarkMode}
                  isRtl={isRtl}
                  className="h-10 w-auto text-[#1b2c4d] dark:text-white"
                />
              </button>
              <button
                type="button"
                aria-label={isRtl ? 'إغلاق القائمة' : 'Close navigation menu'}
                onClick={onCloseMobileMenu}
                className="min-w-[48px] min-h-[48px] p-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full text-[#1b2c4d] dark:text-white active:scale-90 transition-transform flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <X size={24} aria-hidden="true" />
              </button>
            </div>

            {/* Primary Mobile Navigation Items */}
            <div className="w-full space-y-1.5 flex flex-col">
              {[
                { page: 'home' as Page, label: t.nav_home, icon: <Home size={20} aria-hidden="true" /> },
                {
                  page: 'listings' as Page,
                  label: t.nav_listings,
                  icon: <Building2 size={20} aria-hidden="true" />,
                },
                {
                  page: 'yalla-sahel' as Page,
                  label: isRtl ? '🌊 ساحل حتتي' : '🌊 Sahel Hettety',
                  icon: <Waves size={20} aria-hidden="true" />,
                },
                {
                  page: '3d-experience' as Page,
                  label: isRtl ? 'جولات 3D' : '3D Tours',
                  icon: <Box size={20} aria-hidden="true" />,
                },
                {
                  page: 'legal' as Page,
                  label: t.nav_trust,
                  icon: <FileCheck size={20} aria-hidden="true" />,
                },
              ].map((item) => {
                const active = currentPage === item.page;
                return (
                  <button
                    key={item.page}
                    type="button"
                    onClick={() => handleMobileNav(item.page)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-lg font-black transition-all text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                      active
                        ? 'bg-brand-50 dark:bg-slate-900 text-[#1b2c4d] dark:text-accent-400 border border-brand-200/70 dark:border-slate-800'
                        : 'text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                    }`}
                  >
                    <span className={active ? 'text-accent-500' : 'text-slate-400'}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                );
              })}

              {userEmail && (
                <button
                  type="button"
                  onClick={() => handleMobileNav('add-listing')}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-lg font-black text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-all text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <PlusCircle size={20} className="text-slate-400" aria-hidden="true" />
                  <span>{isRtl ? 'إضافة عقار' : 'Add Listing'}</span>
                </button>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleMobileNav('manage-users')}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-lg font-black text-accent-600 dark:text-accent-400 bg-accent-50/70 dark:bg-accent-500/10 hover:bg-accent-100/70 dark:hover:bg-accent-500/20 transition-all text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500"
                >
                  <Shield size={20} aria-hidden="true" />
                  <span>{isRtl ? 'لوحة التحكم' : 'Dashboard'}</span>
                </button>
              )}

              {/* Featured AI Advisor CTA */}
              <button
                type="button"
                onClick={() => handleMobileNav('ai-chat')}
                className="w-full py-4 px-5 mt-3 bg-gradient-to-r from-[#1b2c4d] to-brand-700 dark:from-accent-500 dark:to-accent-600 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-brand-900/20 active:scale-[0.98] transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500"
              >
                <Sparkles size={20} className="text-accent-300 dark:text-white" aria-hidden="true" />
                <span>{t.advisor_nav || t.nav_ai}</span>
              </button>

              {/* Secondary Links */}
              <div className="grid grid-cols-2 gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => handleMobileNav('about')}
                  className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <Info size={16} aria-hidden="true" />
                  <span>{t.footer_about}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMobileNav('contact')}
                  className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <Mail size={16} aria-hidden="true" />
                  <span>{isRtl ? 'تواصل معنا' : 'Contact Us'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleMobileNav('privacy')}
                className="w-full py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-brand-600 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl"
              >
                {t.nav_privacy || (isRtl ? 'سياسة الخصوصية' : 'Privacy Policy')}
              </button>
            </div>
          </div>

          {/* Bottom Utility Dock */}
          <div className="w-full pt-6 mt-6 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onToggleLanguage}
                aria-label={isRtl ? 'Switch language to English' : 'تغيير اللغة إلى العربية'}
                className="flex-1 min-h-[48px] py-3.5 px-4 rounded-2xl bg-slate-50 dark:bg-slate-900 text-[#1b2c4d] dark:text-white font-black text-xs sm:text-sm border border-slate-200 dark:border-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {lang === 'en' ? 'اللغة العربية' : 'English Language'}
              </button>
              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label="Toggle Theme"
                className="w-16 min-h-[48px] flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-900 text-[#1b2c4d] dark:text-white border border-slate-200 dark:border-slate-800 active:scale-95 transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {isDarkMode ? (
                  <Sun size={22} className="text-amber-400" aria-hidden="true" />
                ) : (
                  <Moon size={22} aria-hidden="true" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleMobileNav(userEmail ? 'profile' : 'login')}
              className="w-full min-h-[48px] py-4 rounded-2xl bg-[#1b2c4d] dark:bg-brand-600 text-white font-black text-sm shadow-lg active:scale-[0.98] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {userEmail
                ? isRtl
                  ? 'الملف الشخصي'
                  : 'Go to Profile'
                : isRtl
                  ? 'تسجيل الدخول'
                  : 'Sign In Now'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default SiteNavbar;
