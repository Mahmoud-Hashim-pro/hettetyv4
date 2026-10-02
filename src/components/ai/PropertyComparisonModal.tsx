import React from 'react';
import { Scale, X, Sparkles, Check, Building2, MapPin, DollarSign, Bed, Bath, Maximize2, ShieldCheck, Box } from 'lucide-react';
import { Property } from '../../types';
import { compareProperties, ComparisonReport } from '../../services/ai/property-comparator';

interface PropertyComparisonModalProps {
  properties: Property[];
  isOpen: boolean;
  onClose: () => void;
  onSelectProperty?: (propertyId: string) => void;
  isRtl?: boolean;
}

export const PropertyComparisonModal: React.FC<PropertyComparisonModalProps> = ({
  properties,
  isOpen,
  onClose,
  onSelectProperty,
  isRtl = false,
}) => {
  if (!isOpen || properties.length === 0) return null;

  const report: ComparisonReport = compareProperties(properties);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 rounded-xl">
              <Scale size={20} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                {isRtl ? 'المقارنة التحليلية الذكية للعقارات' : 'Grounded AI Property Comparison'}
              </h3>
              <p className="text-xs text-slate-500">
                {isRtl ? `مقارنة تفصيلية بين ${properties.length} عقارات مختارة` : `Side-by-side analysis across ${properties.length} selected properties`}
              </p>
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

        {/* AI Analytical Summary Banner */}
        <div className="p-4 bg-brand-50/50 dark:bg-brand-950/20 border-b border-brand-100 dark:border-brand-900/30 flex items-start gap-3">
          <Sparkles size={18} className="text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
          <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed font-medium">
            {isRtl ? report.summaryAr : report.summaryEn}
          </p>
        </div>

        {/* Comparison Table / Grid */}
        <div className="p-4 sm:p-6 overflow-y-auto overflow-x-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-w-[500px]">
            {report.properties.map(({ property, pricePerSqm, monthlyEstimateEGP, downPaymentEGP, has3DTour, strengthsEn, strengthsAr }) => {
              const isBestValue = property.id === report.bestValuePropertyId;
              const isBestFamily = property.id === report.bestFamilyPropertyId;

              return (
                <div
                  key={property.id}
                  className={`bg-slate-50 dark:bg-slate-800/60 border rounded-2xl p-4 flex flex-col justify-between space-y-4 transition-all ${
                    isBestValue
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                      : isBestFamily
                      ? 'border-brand-500 ring-2 ring-brand-500/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Badge */}
                    <div className="flex items-center justify-between">
                      {isBestValue && (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          {isRtl ? '⭐ أفضل قيمة سعرية' : '⭐ Best Value / m²'}
                        </span>
                      )}
                      {isBestFamily && !isBestValue && (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-950/60 text-brand-700 dark:text-brand-300">
                          {isRtl ? '👨‍👩‍👧‍👦 الأنسب للعائلات' : '👨‍👩‍👧‍👦 Family Favorite'}
                        </span>
                      )}
                      <span className="text-xs font-bold text-slate-400 capitalize">{property.propertyType}</span>
                    </div>

                    {/* Image & Title */}
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-700 relative">
                      <img src={property.imageUrl} alt={property.title} className="w-full h-full object-cover" />
                      {has3DTour && (
                        <span className="absolute bottom-2 left-2 rtl:left-auto rtl:right-2 text-[10px] font-black px-2 py-0.5 bg-black/70 backdrop-blur-xs text-white rounded-md flex items-center gap-1">
                          <Box size={10} /> 3D Tour
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm line-clamp-1">{property.title}</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={11} /> {property.location} {property.compound ? `— ${property.compound}` : ''}
                      </p>
                    </div>

                    {/* Price Breakdown */}
                    <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">{isRtl ? 'السعر الكلي:' : 'Total Price:'}</span>
                        <span className="font-black text-slate-900 dark:text-white text-sm">
                          {property.price.toLocaleString()} EGP
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{isRtl ? 'سعر المتر:' : 'Price / m²:'}</span>
                        <span className="font-bold">{pricePerSqm.toLocaleString()} EGP/m²</span>
                      </div>
                      {monthlyEstimateEGP && (
                        <div className="flex items-center justify-between text-[11px] text-brand-600 dark:text-brand-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                          <span>{isRtl ? 'القسط التقريبي:' : 'Est. Monthly:'}</span>
                          <span className="font-bold">~{monthlyEstimateEGP.toLocaleString()} EGP/mo</span>
                        </div>
                      )}
                    </div>

                    {/* Specs Grid */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs py-1">
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800">
                        <span className="block text-slate-400 text-[10px]">{isRtl ? 'غرف' : 'Beds'}</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{property.bedrooms}</span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800">
                        <span className="block text-slate-400 text-[10px]">{isRtl ? 'حمامات' : 'Baths'}</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{property.bathrooms}</span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800">
                        <span className="block text-slate-400 text-[10px]">{isRtl ? 'المساحة' : 'Area'}</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{property.area} m²</span>
                      </div>
                    </div>

                    {/* Key Strengths */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        {isRtl ? 'المزايا التنافسية' : 'Key Advantages'}
                      </span>
                      {(isRtl ? strengthsAr : strengthsEn).map((str, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                          <Check size={12} className="text-emerald-500 shrink-0" />
                          <span>{str}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {onSelectProperty && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProperty(property.id);
                        onClose();
                      }}
                      className="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                      {isRtl ? 'عرض تفاصيل العقار' : 'View Full Details'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
