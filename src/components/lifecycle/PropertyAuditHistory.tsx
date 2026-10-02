import React from 'react';
import { History, Shield, ArrowRight, ArrowLeft, Clock, User, X } from 'lucide-react';
import { PropertyAuditLog } from '../../types';

interface PropertyAuditHistoryProps {
  logs: PropertyAuditLog[];
  propertyTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  isRtl?: boolean;
}

export const PropertyAuditHistory: React.FC<PropertyAuditHistoryProps> = ({
  logs,
  propertyTitle,
  isOpen,
  onClose,
  isRtl = false,
}) => {
  if (!isOpen) return null;

  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 rounded-xl">
              <History size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'سجل التدقيق والاعتماد (Audit Trail)' : 'Property Lifecycle Audit Trail'}
              </h3>
              {propertyTitle && (
                <p className="text-xs text-slate-500 truncate max-w-sm">{propertyTitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Timeline Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {logs.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              <Shield size={32} className="mx-auto mb-2 opacity-40" />
              <p>{isRtl ? 'لا يوجد سجل انتقالات سابق لهذا العقار' : 'No prior transition history for this property.'}</p>
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={log.id || index}
                className="relative pl-6 rtl:pl-0 rtl:pr-6 pb-4 border-l rtl:border-l-0 rtl:border-r border-slate-200 dark:border-slate-800 last:border-transparent last:pb-0"
              >
                {/* Circle marker */}
                <span className="absolute -left-[7px] rtl:left-auto rtl:-right-[7px] top-1.5 w-3 h-3 rounded-full bg-brand-500 ring-4 ring-white dark:ring-slate-900" />

                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-bold">
                      <span className="capitalize px-2 py-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                        {log.fromStatus}
                      </span>
                      <ArrowIcon size={12} className="text-slate-400" />
                      <span className="capitalize px-2 py-0.5 rounded-lg bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
                        {log.toStatus}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/40 dark:border-slate-700/40">
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {log.actorEmail || log.actorId}
                      </span>{' '}
                      ({log.actorRole})
                    </span>
                    {log.reason && <span className="italic max-w-[200px] truncate">{log.reason}</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
