import React from 'react';
import { Shield, Lock, FileText, Eye, CheckCircle2, Server, HelpCircle, Mail, MapPin } from 'lucide-react';

interface PrivacyPageProps {
  t: any;
  isRtl: boolean;
}

const PrivacyPage: React.FC<PrivacyPageProps> = ({ t, isRtl }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-16 sm:py-24 transition-colors duration-500 font-sans" dir={isRtl ? "rtl" : "ltr"}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Header Hero */}
        <div className="text-center mb-12 sm:mb-16">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-brand-500/10 dark:bg-brand-500/20 mb-6 shadow-sm border border-brand-500/20 dark:border-brand-500/30">
            <Shield className="w-10 h-10 text-brand-600 dark:text-accent-400" />
          </div>
          <h1 className={`text-3xl sm:text-5xl md:text-6xl font-black text-slate-900 dark:text-white mb-4 sm:mb-6 ${isRtl ? 'font-cairo' : 'uppercase tracking-tighter'}`}>
            {t.nav_privacy || (isRtl ? 'سياسة الخصوصية وحماية البيانات' : 'Privacy & Data Protection Policy')}
          </h1>
          <p className="text-base sm:text-xl text-slate-600 dark:text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed">
            {isRtl
              ? 'التزام منصة حِتّتي بحماية بياناتك الشخصية ومستنداتك العقارية وفقاً للقانون المصري رقم 151 لسنة 2020 والمعايير الدولية.'
              : 'Hettety\'s commitment to protecting your personal data, property documents, and digital twin scans in compliance with Egyptian Law No. 151 of 2020 and global standards.'}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200/60 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
            <span>{isRtl ? 'تاريخ السريان: نوفمبر 2026 | الإصدار 4.2' : 'Effective Date: November 2026 | Version 4.2'}</span>
          </div>
        </div>

        {/* Core Principles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-accent-400 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-2">
              {isRtl ? 'تشفير الخزنة الرقمية' : 'Vault-Grade Encryption'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {isRtl
                ? 'عقود الملكية والمستندات القانونية مشفرة ببروتوكول AES-256 مع وصول مقتصر حصرياً على المالك والمستشار المعتمد.'
                : 'Title deeds and legal contracts are encrypted using AES-256, strictly restricted to the verified owner and verified legal advisors.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400 flex items-center justify-center mb-4">
              <Eye className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-2">
              {isRtl ? 'خصوصية المسح ثلاثي الأبعاد (3D)' : '3D Spatial Scan Privacy'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {isRtl
                ? 'طمس تلقائي للوجوه واللوحات والمعلومات الحساسة في جولات Gaussian Splatting والبانوراما قبل المعالجة والنشر.'
                : 'Automatic blurring of personal photos, faces, and sensitive items in 3D Gaussian Splatting tours before public streaming.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-2">
              {isRtl ? 'حقوق المستخدم والتحكم' : 'Full User Data Ownership'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {isRtl
                ? 'حق كامل في تصدير البيانات أو تعديلها أو حذفها نهائياً بضغطة زر واحدة وفقاً للمادة 12 من قانون البيانات المصري.'
                : 'Complete rights to export, correct, or permanently erase your profile and property listings at any time.'}
            </p>
          </div>
        </div>

        {/* Detailed Policy Sections */}
        <div className="space-y-8">
          {/* Section 1: Data Collection */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 sm:p-10 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-3 mb-6">
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-bold text-sm">1</span>
              <h2 className={`text-xl sm:text-2xl font-black text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tight'}`}>
                {isRtl ? 'البيانات التي نقوم بجمعها' : 'Information We Collect'}
              </h2>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6 font-medium text-sm sm:text-base">
              {isRtl
                ? 'تقوم حِتّتي بجمع البيانات الضرورية لتقديم الاستشارات العقارية، وفحص العقود، وتمكين الجولات الافتراضية الذكية، وتشمل:'
                : 'Hettety collects information strictly necessary to provide real estate advisory, title verification, and interactive 3D tours, including:'}
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-3 ms-4 font-medium text-sm sm:text-base">
              <li>
                <strong className="text-slate-900 dark:text-white">{isRtl ? 'بيانات الحساب والهوية:' : 'Account & Identity Data:'}</strong>{' '}
                {isRtl ? 'الاسم الكامل، رقم الهاتف المصري، البريد الإلكتروني الموثق، وبيانات المصادقة.' : 'Full name, Egyptian mobile number, verified email address, and authentication tokens.'}
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">{isRtl ? 'المستندات العقارية القانونية:' : 'Real Estate Legal Vault Docs:'}</strong>{' '}
                {isRtl ? 'عقود البيع الابتدائية، تسلسل الملكية، طلبات الشهر العقاري، والتراخيص المرفوعة اختيارياً للفحص القانوني.' : 'Preliminary purchase contracts, title deed histories, and registration applications uploaded for verification.'}
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">{isRtl ? 'وسائط التصوير والجولات ثلاثية الأبعاد:' : '3D Spatial & Media Assets:'}</strong>{' '}
                {isRtl ? 'الصور الفوتوغرافية، مقاطع الفيديو المسجلة للوحدات، ومخططات الكاد، ونماذج السحاب النقطي (Point Clouds / Gaussian Splats).' : 'Photographs, walkthrough video recordings, CAD masterplans, and 3D Gaussian Splatting scene reconstructions.'}
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">{isRtl ? 'المحددات المالية والبحثية:' : 'Financial & Search Preferences:'}</strong>{' '}
                {isRtl ? 'الميزانية المستهدفة، المقدم المتاح، القسط الشهري، والمنطقة المستهدفة (التجمع، زايد، الساحل، العاصمة).' : 'Target budget, available down payment, installment capacity, and corridor preferences.'}
              </li>
            </ul>
          </section>

          {/* Section 2: Use of Data */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 sm:p-10 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-3 mb-6">
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-bold text-sm">2</span>
              <h2 className={`text-xl sm:text-2xl font-black text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tight'}`}>
                {isRtl ? 'أوجه استخدام البيانات' : 'How We Use Your Data'}
              </h2>
            </div>
            <div className="space-y-4 text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
              <p>
                {isRtl
                  ? 'نستخدم بياناتك لتحقيق أقصى قدر من الشفافية والأمان في معاملاتك العقارية، ومن أبرز الأهداف:'
                  : 'We process your data to ensure maximum transparency, safety, and performance across your real estate journey:'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    {isRtl ? '1. الاستشارات ومطابقة الوحدات' : '1. Advisory & Matching'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'توليد توصيات استثمارية محايدة وحساب العائد الإيجاري المتوقع بدقة.' : 'Generating unbiased investment guidance and calculating realistic rental yields.'}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    {isRtl ? '2. إعادة البناء ثلاثي الأبعاد' : '2. 3D Digital Twin Processing'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'معالجة الفيديو عبر خوارزميات COLMAP و3DGS لإنشاء نماذج تفاعلية حقيقية.' : 'Processing walkthrough videos through COLMAP and 3DGS pipelines for interactive tours.'}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    {isRtl ? '3. التدقيق القانوني ومنع الاحتيال' : '3. Legal Due Diligence'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'التأكد من خلو العقار من النزاعات ومطابقة أرقام التراخيص الوزارية.' : 'Verifying absence of encumbrances and validating ministerial decree numbers.'}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    {isRtl ? '4. سرية التعاقد والحجز' : '4. Contract Confidentiality'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'تسجيل طلبات الحجز وخطط الأقساط دون مشاركة بيانات الاتصال مع أطراف ثالثة دون إذنك.' : 'Registering EOI reservation requests without sharing your contacts without consent.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Legal Compliance & Storage Vault */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 sm:p-10 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-3 mb-6">
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-bold text-sm">3</span>
              <h2 className={`text-xl sm:text-2xl font-black text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tight'}`}>
                {isRtl ? 'أمن المستندات وقانون حماية البيانات المصري (151 لسنة 2020)' : 'Legal Vault Security & Egyptian Law 151/2020'}
              </h2>
            </div>
            <div className="space-y-4 text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
              <p>
                {isRtl
                  ? 'تلتزم حِتّتي بأعلى معايير حماية البيانات الشخصية المنصوص عليها في القانون المصري رقم 151 لسنة 2020 ولائحته التنفيذية، وتطبق السياسات التقنية التالية:'
                  : 'Hettety complies strictly with Egyptian Personal Data Protection Law No. 151 of 2020 and enforces the following technical safeguards:'}
              </p>
              <ul className="list-disc list-inside space-y-2 ms-4">
                <li>{isRtl ? 'فصل تام في قواعد البيانات بين الوسائط التسويقية العامة والوثائق القانونية الخاصة المحفوظة في مسار الخزنة المشفرة (/documents/).' : 'Strict isolation between public marketing media and private title deeds stored in encrypted storage vaults (/documents/).'}</li>
                <li>{isRtl ? 'قواعد أمان Firebase Firestore الصارمة التي تمنع أي مستخدم من الوصول لمستندات غير مملوكة له.' : 'Firebase Firestore security rules enforcing granular ownership checks preventing cross-tenant document exposure.'}</li>
                <li>{isRtl ? 'تسجيل ومراقبة كاملة لعمليات الدخول (Audit Logging) لكل وصول للمستندات الحساسة.' : 'Comprehensive audit logging capturing all read and write accesses to sensitive property title deeds.'}</li>
              </ul>
            </div>
          </section>

          {/* Section 4: Contact & DPO */}
          <section className="bg-gradient-to-br from-brand-900 to-slate-900 text-white rounded-3xl p-8 sm:p-10 shadow-lg">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <h3 className="text-xl sm:text-2xl font-black mb-2">
                  {isRtl ? 'مسؤول حماية البيانات (DPO)' : 'Data Protection Officer (DPO)'}
                </h3>
                <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
                  {isRtl
                    ? 'إذا كان لديك أي استفسار حول بياناتك الشخصية، أو ترغب في ممارسة حقوقك في التعديل أو الحذف، يمكنك التواصل مباشرة مع مكتب حماية البيانات لدينا:'
                    : 'If you have questions regarding your personal data or wish to exercise your rights to access, correction, or deletion, contact our Data Protection Office directly:'}
                </p>
                <div className="flex flex-wrap gap-4 mt-4 text-xs sm:text-sm">
                  <div className="flex items-center gap-2 text-slate-200">
                    <Mail className="w-4 h-4 text-accent-400" />
                    <span>privacy@hettety.com</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-200">
                    <MapPin className="w-4 h-4 text-accent-400" />
                    <span>{isRtl ? 'القاهرة الجديدة، مصر' : 'New Cairo, Egypt'}</span>
                  </div>
                </div>
              </div>
              <a
                href="mailto:privacy@hettety.com"
                className="px-6 py-3 rounded-2xl bg-accent-500 hover:bg-accent-600 text-white font-bold text-sm transition-all shadow-md shrink-0 cursor-pointer"
              >
                {isRtl ? 'مراسلة مسؤول الخصوصية' : 'Contact Privacy Team'}
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPage;
