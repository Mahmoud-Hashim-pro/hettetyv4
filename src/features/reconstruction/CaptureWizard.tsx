import React, { useState } from 'react';
import { Camera, Video, Compass, Globe, Upload, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, Sparkles, Layers } from 'lucide-react';
import { ThreeDTour, ReconstructionJob } from '../../types';
import { validatePhotoCapture, validateVideoCapture } from './CaptureValidator';
import { ReconstructionProgress } from './ReconstructionProgress';
import { createReconstructionJob, updateJobStatus } from '../../services/3d/reconstruction-service';
import { buildDefaultThreeDTour } from '../../services/3d/tour-service';

interface CaptureWizardProps {
  propertyId: string;
  initialTour?: ThreeDTour;
  onTourGenerated: (tour: ThreeDTour) => void;
  isRtl?: boolean;
}

type CaptureMethod = 'photos' | 'video' | 'panoramas' | 'external';

export const CaptureWizard: React.FC<CaptureWizardProps> = ({
  propertyId,
  initialTour,
  onTourGenerated,
  isRtl = false,
}) => {
  const [method, setMethod] = useState<CaptureMethod>('photos');
  const [photos, setPhotos] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [externalUrl, setExternalUrl] = useState(initialTour?.assetUrl || '');
  const [activeJob, setActiveJob] = useState<ReconstructionJob | null>(null);
  const [simulating, setSimulating] = useState(false);

  // Real-time validation results
  const validation = method === 'photos'
    ? validatePhotoCapture(photos.map(p => ({ name: p.name, size: p.size, type: p.type })))
    : method === 'video'
    ? validateVideoCapture(video ? { name: video.name, size: video.size, type: video.type } : null)
    : null;

  const handleStartReconstruction = async () => {
    if (method === 'external') {
      if (!externalUrl.trim()) return;
      const tour = buildDefaultThreeDTour(externalUrl, 'spz');
      tour.source = 'matterport';
      onTourGenerated(tour);
      return;
    }

    const job = createReconstructionJob({
      propertyId,
      ownerId: 'current-user',
      type: method === 'video' ? 'video' : 'photos',
      sourceCount: method === 'video' ? 1 : photos.length,
    });
    setActiveJob(job);
    setSimulating(true);

    // Simulate staged GPU reconstruction pipeline
    const stages: Array<{ status: any; progress: number; stage: string; delay: number }> = [
      { status: 'VALIDATING', progress: 15, stage: 'Validating Quality', delay: 800 },
      { status: 'UPLOADING', progress: 35, stage: 'Uploading Media', delay: 1000 },
      { status: 'RECONSTRUCTING', progress: 60, stage: 'COLMAP Scene Alignment', delay: 1200 },
      { status: 'TRAINING', progress: 82, stage: 'Training 3D Gaussians', delay: 1400 },
      { status: 'OPTIMIZING', progress: 95, stage: 'SPZ Progressive Compression', delay: 900 },
      { status: 'READY', progress: 100, stage: 'Publishing Spatial Tour', delay: 600 },
    ];

    for (const step of stages) {
      await new Promise(r => setTimeout(r, step.delay));
      const updated = updateJobStatus(job.id, step.status, step.progress, step.stage);
      if (updated) setActiveJob({ ...updated });
    }

    setSimulating(false);

    // Construct final ThreeDTour
    const finalTour = buildDefaultThreeDTour(
      `https://assets.hettety.com/scans/${propertyId}/tour.spz`,
      'spz',
      [
        {
          id: 'reception',
          name: 'Reception & Living Hall',
          nameAr: 'الريسبشن ومنطقة المعيشة',
          type: 'reception',
          center: [0, 0.4, 0],
          position: [0, 0.4, 0],
          camera: { position: [0, 1.6, 2.8] },
          waypoints: ['wp-rec-1'],
        },
        {
          id: 'master',
          name: 'Master Suite',
          nameAr: 'جناح النوم الرئيسي',
          type: 'bedroom',
          center: [-2.5, 0.3, -1.8],
          position: [-2.5, 0.3, -1.8],
          camera: { position: [-2.5, 1.5, 1.0] },
          waypoints: ['wp-mas-1'],
        },
      ]
    );
    finalTour.processingJobId = job.id;
    onTourGenerated(finalTour);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Method selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { id: 'photos', labelEn: 'Multi Photos', labelAr: 'صور متعددة', icon: Camera, desc: '30-80 photos' },
          { id: 'video', labelEn: 'Phone Video', labelAr: 'فيديو تجوال', icon: Video, desc: '60fps walk' },
          { id: 'panoramas', labelEn: '360° Panoramas', labelAr: 'بانوراما 360°', icon: Compass, desc: 'Spherical' },
          { id: 'external', labelEn: 'External Tour', labelAr: 'رابط خارجي', icon: Globe, desc: 'Matterport/Polycam' },
        ].map(m => {
          const Icon = m.icon;
          const active = method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id as CaptureMethod)}
              className={`p-4 rounded-2xl border text-start transition-all cursor-pointer ${
                active
                  ? 'bg-brand-50 border-brand-500 dark:bg-brand-900/20 dark:border-brand-500 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-brand-300'
              }`}
            >
              <Icon size={20} className={`mb-2 ${active ? 'text-brand-600' : 'text-slate-500'}`} />
              <div className="font-bold text-xs text-slate-900 dark:text-white">{isRtl ? m.labelAr : m.labelEn}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{m.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Input area */}
      {method === 'photos' && (
        <div className="p-6 border-2 border-dashed rounded-3xl text-center bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700">
          <input
            type="file"
            multiple
            accept="image/*"
            id="wizard-photos-input"
            className="hidden"
            onChange={e => {
              if (e.target.files) setPhotos(Array.from(e.target.files));
            }}
          />
          <label htmlFor="wizard-photos-input" className="cursor-pointer block">
            <Camera size={36} className="mx-auto text-brand-500 mb-2" />
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-1">
              {isRtl ? 'اختر مجموعة صور العقار للبناء ثلاثي الأبعاد' : 'Select multi-angle photos for 3D reconstruction'}
            </h4>
            <p className="text-xs text-slate-500">
              {isRtl ? 'يُفضل التقاط 30 إلى 80 صورة مع تداخل 70%+' : '30 to 80 photos with 70%+ overlap recommended'}
            </p>
            {photos.length > 0 && (
              <span className="inline-block mt-3 px-3 py-1 bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-300 rounded-full text-xs font-bold">
                {photos.length} {isRtl ? 'صورة مختارة' : 'photos selected'}
              </span>
            )}
          </label>
        </div>
      )}

      {method === 'video' && (
        <div className="p-6 border-2 border-dashed rounded-3xl text-center bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700">
          <input
            type="file"
            accept="video/*"
            id="wizard-video-input"
            className="hidden"
            onChange={e => {
              if (e.target.files?.[0]) setVideo(e.target.files[0]);
            }}
          />
          <label htmlFor="wizard-video-input" className="cursor-pointer block">
            <Video size={36} className="mx-auto text-brand-500 mb-2" />
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-1">
              {isRtl ? 'اختر فيديو التجوال بالموبايل (Walkthrough)' : 'Select mobile walkthrough video'}
            </h4>
            <p className="text-xs text-slate-500">
              {isRtl ? 'تصوير متصل بهدوء بمعدل 60 إطار/ثانية (أقل من 80MB)' : 'Smooth continuous 60fps walk (under 80MB)'}
            </p>
            {video && (
              <span className="inline-block mt-3 px-3 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-full text-xs font-bold">
                {video.name} ({(video.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            )}
          </label>
        </div>
      )}

      {method === 'external' && (
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            {isRtl ? 'رابط الجولة الافتراضية الخارجية' : 'External Virtual Tour Link'}
          </label>
          <input
            type="url"
            value={externalUrl}
            onChange={e => setExternalUrl(e.target.value)}
            placeholder="https://my.matterport.com/show/?m=... | https://poly.cam/capture/..."
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      )}

      {/* Validation report */}
      {validation && (photos.length > 0 || video) && (
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs space-y-3">
          <div className="flex items-center justify-between font-bold">
            <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-500" />
              {isRtl ? 'فحص جودة اللقطات الفوري' : 'Pre-flight Capture Validation'}
            </span>
            <span className={validation.valid ? 'text-emerald-600 font-black' : 'text-amber-600 font-black'}>
              {validation.valid ? (isRtl ? '✓ مؤهل للبناء الفراغي' : '✓ Ready for Reconstruction') : (isRtl ? '⚠️ يحتاج تحسين' : '⚠️ Quality Warning')}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="text-[10px] text-slate-500 block">{isRtl ? 'التغطية' : 'Coverage'}</span>
              <span className="font-bold text-slate-800 dark:text-white">{validation.coverageScore}%</span>
            </div>
            <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="text-[10px] text-slate-500 block">{isRtl ? 'التداخل' : 'Overlap'}</span>
              <span className="font-bold text-slate-800 dark:text-white">{validation.overlapScore}%</span>
            </div>
            <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="text-[10px] text-slate-500 block">{isRtl ? 'الحدة' : 'Sharpness'}</span>
              <span className="font-bold text-slate-800 dark:text-white">{validation.blurScore}%</span>
            </div>
          </div>

          {validation.warnings.length > 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 space-y-1">
              {validation.warnings.map((w, i) => (
                <div key={i} className="flex items-center gap-1">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>{isRtl ? (validation.warningsAr[i] || w) : w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress display */}
      {activeJob && (
        <ReconstructionProgress job={activeJob} isRtl={isRtl} />
      )}

      {/* Action button */}
      {!activeJob && (
        <button
          type="button"
          onClick={handleStartReconstruction}
          disabled={simulating || (method === 'photos' && photos.length === 0) || (method === 'video' && !video) || (method === 'external' && !externalUrl.trim())}
          className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          <Sparkles size={16} />
          <span>{isRtl ? 'بدء البناء الفراغي وتدريب النموذج (3DGS / SPZ)' : 'Start 3D Reconstruction Pipeline (3DGS / SPZ)'}</span>
        </button>
      )}
    </div>
  );
};
