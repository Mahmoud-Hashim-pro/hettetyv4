import React, { useState } from 'react';
import { ViewingType, ViewingAppointment } from '../../types';
import { Calendar, Clock, MapPin, Glasses, X, Check } from 'lucide-react';

interface ViewingScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  propertyTitle: string;
  propertyLocation: string;
  onConfirmSchedule: (appointment: ViewingAppointment) => void;
  isRtl?: boolean;
}

export const ViewingScheduleModal: React.FC<ViewingScheduleModalProps> = ({
  isOpen,
  onClose,
  propertyTitle,
  propertyLocation,
  onConfirmSchedule,
  isRtl = false,
}) => {
  const [viewingType, setViewingType] = useState<ViewingType>('guided_3d_tour');
  const [date, setDate] = useState<string>(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [time, setTime] = useState<string>('16:00');
  const [notes, setNotes] = useState<string>('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) return;

    onConfirmSchedule({
      date,
      time,
      type: viewingType,
      meetingPoint: viewingType === 'physical_visit' ? propertyLocation : 'HETTETY 3D Virtual Room',
      notes,
      confirmedByBuyer: true,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="viewing-schedule-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Calendar size={22} />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                {isRtl ? 'حجز موعد معاينة العقار' : 'Schedule Property Viewing'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {propertyTitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Viewing Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {isRtl ? 'نوع المعاينة المطلوبة:' : 'Preferred Viewing Format:'}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setViewingType('guided_3d_tour')}
                className={`p-3.5 rounded-xl border text-start flex flex-col gap-2 transition-all ${
                  viewingType === 'guided_3d_tour'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <Glasses className="text-amber-600 dark:text-amber-400" size={20} />
                <div>
                  <div className="font-bold text-xs text-slate-900 dark:text-white">
                    {isRtl ? 'معاينة 3D افتراضية' : 'Guided 3D Tour'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {isRtl ? 'جولة تفاعلية بالهاتف أو اللابتوب' : 'Online spatial walkthrough'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setViewingType('physical_visit')}
                className={`p-3.5 rounded-xl border text-start flex flex-col gap-2 transition-all ${
                  viewingType === 'physical_visit'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <MapPin className="text-blue-500" size={20} />
                <div>
                  <div className="font-bold text-xs text-slate-900 dark:text-white">
                    {isRtl ? 'معاينة ميدانية بالعقار' : 'Physical On-Site Visit'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {isRtl ? 'لقاء المستشار العقاري بموقع الوحدة' : 'Meet agent on location'}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isRtl ? 'التاريخ المطلوب' : 'Date'}
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isRtl ? 'التوقيت' : 'Time'}
              </label>
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {isRtl ? 'ملاحظات إضافية للمستشار العقاري' : 'Notes for Agent'}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isRtl ? 'مثال: أفضل المعاينة قبل غروب الشمس' : 'e.g. Prefer afternoon lighting'}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <Check size={16} />
              <span>{isRtl ? 'تأكيد حجز المعاينة' : 'Confirm Viewing Appointment'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
