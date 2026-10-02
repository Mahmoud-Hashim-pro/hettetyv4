import React, { useState, useEffect } from 'react';
import { Search, Sparkles, X, Filter, Compass } from 'lucide-react';
import { StructuredSearchFilters } from '../../types';
import { parseNaturalLanguageQuery, formatFiltersToTags } from '../../services/search/query-parser';

interface SmartSearchBoxProps {
  initialQuery?: string;
  onSearch: (query: string, filters: StructuredSearchFilters) => void;
  isRtl?: boolean;
  className?: string;
}

export const SmartSearchBox: React.FC<SmartSearchBoxProps> = ({
  initialQuery = '',
  onSearch,
  isRtl = false,
  className = '',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeFilters, setActiveFilters] = useState<StructuredSearchFilters>({});
  const [activeTags, setActiveTags] = useState<string[]>([]);

  useEffect(() => {
    if (query.trim().length > 2) {
      const parsed = parseNaturalLanguageQuery(query);
      setActiveFilters(parsed);
      setActiveTags(formatFiltersToTags(parsed, isRtl));
    } else {
      setActiveFilters({});
      setActiveTags([]);
    }
  }, [query, isRtl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query, activeFilters);
  };

  const handleClear = () => {
    setQuery('');
    setActiveFilters({});
    setActiveTags([]);
    onSearch('', {});
  };

  const handleSampleClick = (sample: string) => {
    setQuery(sample);
    const parsed = parseNaturalLanguageQuery(sample);
    setActiveFilters(parsed);
    setActiveTags(formatFiltersToTags(parsed, isRtl));
    onSearch(sample, parsed);
  };

  const SAMPLE_QUERIES = isRtl
    ? [
        'شقة 3 غرف في التجمع أقل من 8 مليون بتسهيلات',
        'فيلا في الشيخ زايد بحمام سباحة وحديقة',
        'شاليه في الساحل الشمالي بروف واستلام فوري',
      ]
    : [
        '3 bedroom apartment in New Cairo under 8M with installments',
        'Villa in Sheikh Zayed with private pool and garden',
        'Chalet in North Coast with roof and ready delivery',
      ];

  return (
    <div className={`w-full max-w-3xl mx-auto space-y-2.5 ${className}`}>
      {/* Main Search Input Form */}
      <form
        onSubmit={handleSubmit}
        className="relative flex items-center bg-white dark:bg-slate-900 border-2 border-brand-500/30 hover:border-brand-500 focus-within:border-brand-500 rounded-3xl p-1.5 sm:p-2 shadow-lg shadow-brand-500/5 transition-all duration-200"
      >
        <div className="pl-3.5 pr-2 rtl:pl-2 rtl:pr-3.5 text-brand-600 dark:text-brand-400">
          <Sparkles size={20} className="animate-pulse" />
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            isRtl
              ? 'ابحث باللغة الطبيعية: مثال (شقة 3 غرف في التجمع أقل من 8 مليون)...'
              : 'Search naturally: e.g. (3 bedroom apartment in New Cairo under 8M)...'
          }
          className="w-full bg-transparent px-2 py-2 text-sm sm:text-base font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          dir={isRtl ? 'rtl' : 'ltr'}
        />

        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer mr-1 rtl:mr-0 rtl:ml-1"
            title={isRtl ? 'مسح البحث' : 'Clear search'}
          >
            <X size={16} />
          </button>
        )}

        <button
          type="submit"
          className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm rounded-2xl transition-all shadow-md shadow-brand-600/20 shrink-0 cursor-pointer"
        >
          <Search size={16} />
          <span>{isRtl ? 'بحث ذكي' : 'Smart Search'}</span>
        </button>
      </form>

      {/* Extracted Structured Filter Tags */}
      {activeTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-2">
          <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1 shrink-0">
            <Filter size={11} />
            {isRtl ? 'الفلاتر المستخرجة:' : 'Extracted Filters:'}
          </span>
          {activeTags.map((tag, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 animate-in fade-in zoom-in-95 duration-100"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Quick Sample Prompts */}
      {!query && (
        <div className="flex items-center gap-2 flex-wrap px-2 pt-1 text-xs text-slate-400">
          <span className="flex items-center gap-1 shrink-0 text-slate-500 font-medium">
            <Compass size={12} />
            {isRtl ? 'اقتراحات سريعة:' : 'Try asking:'}
          </span>
          {SAMPLE_QUERIES.map((sample, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSampleClick(sample)}
              className="hover:text-brand-600 dark:hover:text-brand-400 underline decoration-slate-300 dark:decoration-slate-700 hover:decoration-brand-500 transition-colors cursor-pointer text-start"
            >
              "{sample}"
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
