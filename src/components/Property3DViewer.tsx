/**
 * Property3DViewer — turns a flat property photo into an explorable scene.
 *
 * Two modes. A 360° panorama is a real look-around: an equirectangular photo
 * painted inside a sphere with the camera at its centre. The "depth" mode is not
 * a measurement of the room — it is a relief built from the photo, so the visitor
 * can move around it and get parallax. It is presented as that, not as a survey.
 *
 * Used by the standalone 3D tour page, the property detail page and the AI
 * assistant (when a user asks to "see the apartment in 3D").
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { X, ChevronLeft, ChevronRight, Box, RotateCcw, Move3d, Layers, Loader2, Compass, MapPin, Sparkles, Ruler, AlertCircle } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ThreeDTourAsset, TourRoomWaypoint } from '../types';
import { FloorPlan } from './3d/FloorPlan';
import { MeasurementTool } from './3d/MeasurementTool';
import { SpatialAiAssistant } from './3d/SpatialAiAssistant';
import { RoomNavigation } from './3d/RoomNavigation';
import { TourViewer } from './3d/TourViewer';

export {
  TourViewer,
  TourEngineProvider,
  useTourEngine,
  useTourContext,
  GaussianRenderer,
  MeshRenderer,
  RoomNavigation,
  MeasurementTool,
} from './3d/TourViewer';

/**
 * Loads an image element for a texture.
 *
 * crossOrigin is attempted first because it keeps the canvas untainted, but it
 * fails outright on any host that does not return CORS headers — and Firebase
 * Storage only returns them once a CORS policy has been applied to the bucket,
 * which is easy to forget. Falling back to a plain load means a missing policy
 * costs nothing here: nothing in this viewer reads pixels back.
 */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  const attempt = (useCors: boolean) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(useCors ? 'cors' : 'load'));
      img.src = url;
    });
  return attempt(true).catch(() => attempt(false));
}

/** Square edge of the generated depth map. Small on purpose — it is a shape, not detail. */
const DEPTH_MAP_SIZE = 96;

/**
 * Builds the height map the relief is displaced by.
 *
 * Using the photo's own luminance as height — the obvious shortcut — gets the
 * room backwards: a window is the brightest thing in most interior photos and
 * also the furthest away, so it balloons toward the viewer while the dark corners
 * sink. Instead the shape is mostly a radial well, so the middle of the frame
 * recedes and the edges stay forward. That reads as looking *into* a room. A
 * little smoothed luminance is mixed in for surface texture, and the border is
 * pinned flat so the plane cannot tear at its edge.
 */
export function computeHeightField(lum: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      // Distance from centre, 0 in the middle to 1 at the corners.
      const nx = (x / (n - 1)) * 2 - 1;
      const ny = (y / (n - 1)) * 2 - 1;
      const r = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2);
      const well = Math.pow(r, 1.5);               // centre recedes, edges forward
      let h = 0.78 * well + 0.22 * lum[i];         // gentle texture from the photo
      // Pin the outer band flat so the mesh edge stays square.
      const edge = Math.min(x, y, n - 1 - x, n - 1 - y) / (n * 0.12);
      if (edge < 1) h = h * edge + 1.0 * (1 - edge);
      out[i] = h;
    }
  }
  return out;
}

function buildDepthMap(img: HTMLImageElement): THREE.DataTexture | null {
  const n = DEPTH_MAP_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null; // no 2D canvas (e.g. jsdom) — the relief just stays flat

  ctx.drawImage(img, 0, 0, n, n);
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, n, n).data;
  } catch {
    return null; // tainted canvas: fall back to a flat plane rather than throwing
  }

  // Luminance, then a couple of box-blur passes so single bright pixels do not
  // become spikes on a 220-segment plane.
  let lum = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    lum[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= n || xx < 0 || xx >= n) continue;
            sum += lum[yy * n + xx];
            count++;
          }
        }
        next[y * n + x] = sum / count;
      }
    }
    lum = next;
  }

  const height = computeHeightField(lum, n);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(height[i] * 255)));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Colour map plus a height map, with the load state the UI reports.
 *
 * depthUrl is a real predicted depth map when the listing has one. Without it the
 * relief falls back to the geometric well, which is a guess about room shape
 * rather than a measurement — better than displacing by brightness, but no
 * substitute for the real thing.
 */
function useSceneTextures(url: string, wantDepth: boolean, depthUrl?: string | null) {
  const [state, setState] = useState<{ color: THREE.Texture | null; depth: THREE.DataTexture | null; aspect: number; status: LoadState }>(
    { color: null, depth: null, aspect: 1.5, status: 'loading' }
  );

  useEffect(() => {
    let disposed = false;
    setState((s) => ({ ...s, status: 'loading' }));

    loadImageElement(url)
      .then((img) => {
        if (disposed) return;
        const color = new THREE.Texture(img);
        color.colorSpace = THREE.SRGBColorSpace;
        color.minFilter = THREE.LinearMipmapLinearFilter;
        color.magFilter = THREE.LinearFilter;
        color.generateMipmaps = true;
        color.needsUpdate = true;
        const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.5;
        if (!wantDepth) {
          setState({ color, depth: null, aspect, status: 'ready' });
          return;
        }
        if (depthUrl) {
          // A predicted map: load it as-is, no guessing required.
          loadImageElement(depthUrl)
            .then((dimg) => {
              if (disposed) return;
              const tex = new THREE.Texture(dimg);
              tex.minFilter = THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
              setState({ color, depth: tex as unknown as THREE.DataTexture, aspect, status: 'ready' });
            })
            .catch(() => {
              if (!disposed) setState({ color, depth: buildDepthMap(img), aspect, status: 'ready' });
            });
          return;
        }
        setState({ color, depth: buildDepthMap(img), aspect, status: 'ready' });
      })
      .catch(() => {
        if (!disposed) setState((s) => ({ ...s, status: 'error' }));
      });

    return () => {
      disposed = true;
      setState((prev) => {
        prev.color?.dispose();
        prev.depth?.dispose();
        return { color: null, depth: null, aspect: prev.aspect, status: 'loading' };
      });
    };
  }, [url, wantDepth, depthUrl]);

  return state;
}

export const PLANE_HEIGHT = 3;
export const DEPTH_SCALE = 0.5;

/**
 * Past about 20 degrees a displaced photo stops looking like depth and starts
 * looking like a photo on a tilted board: the plane's own edges come into view
 * and every depth step drags a smear of stretched pixels behind it. Keeping the
 * swing small is what makes the parallax read as parallax.
 */
export const MAX_AZIMUTH = 0.32;
export const MAX_POLAR = 0.22;

/** Only genuinely extreme frames are clamped; ordinary photos keep their shape. */
export const planeAspect = (aspect: number) => Math.min(Math.max(aspect || 1, 0.45), 3.2);

/**
 * How far back the camera must sit for a plane to fill the canvas it is drawn
 * on. Fitting on whichever axis is tighter is what stops a portrait photo from
 * floating in a sea of black on a landscape screen.
 */
/**
 * Where fog may begin without touching the picture.
 *
 * The centre of the plane is the nearest part of it; the corners are further,
 * and the displaced surface recedes further still. Fog measured against the
 * centre therefore eats the photograph from its edges inward. This measures
 * against the furthest corner and leaves a margin behind it.
 */
/** Thickness of the plate behind the photo. */
export const BACKING_DEPTH = 0.08;

/**
 * Where the backing plate has to sit.
 *
 * displacementBias pushes the unlit parts of the photo away from the viewer, so
 * the surface recedes to -DEPTH_SCALE * 0.55. A plate any nearer than that cuts
 * straight through the picture and hides everything except whatever happens to
 * be in the immediate foreground. It has to clear the deepest point, not the
 * plane's nominal z of zero.
 */
export function backingPlateZ(depthScale: number = DEPTH_SCALE, plateDepth: number = BACKING_DEPTH): number {
  return -(depthScale * 0.55) - plateDepth / 2 - 0.03;
}

export function fogRange(dist: number, width: number, height: number): [number, number] {
  const furthestCorner = Math.hypot(width / 2, height / 2, dist + DEPTH_SCALE * 0.55);
  const near = furthestCorner + 1;
  return [near, near + 10];
}

export function fitDistance(
  width: number,
  height: number,
  fovDeg: number,
  canvasAspect: number,
  margin = 1.06,
): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, canvasAspect || 1));
  return Math.max(height / 2 / Math.tan(vFov / 2), width / 2 / Math.tan(hFov / 2)) * margin;
}

/** Fewer segments on a phone: this plane is subdivided every frame it is drawn. */
function planeSegments() {
  if (typeof navigator === 'undefined') return 160;
  const cores = (navigator as any).hardwareConcurrency || 4;
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  if (coarse && cores <= 4) return 96;
  if (coarse) return 140;
  return 200;
}

const DepthPhoto = ({ url, depthUrl, sway, onState, onAspect }: {
  url: string;
  depthUrl?: string | null;
  sway: boolean;
  onState: (s: LoadState) => void;
  onAspect: (a: number) => void;
}) => {
  const { color, depth, aspect, status } = useSceneTextures(url, true, depthUrl);
  const groupRef = useRef<THREE.Group>(null);
  const width = PLANE_HEIGHT * planeAspect(aspect);
  const segments = useMemo(() => planeSegments(), []);
  const { gl } = useThree();

  useEffect(() => { onState(status); }, [status, onState]);
  useEffect(() => { onAspect(aspect); }, [aspect, onAspect]);

  useEffect(() => {
    if (color) color.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  }, [color, gl]);

  // A slow sway so the relief reads before anyone touches it. Turning it off
  // eases the plane back to square rather than leaving it stopped mid-tilt.
  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (sway) {
      const t = state.clock.elapsedTime;
      g.rotation.y = Math.sin(t * 0.3) * 0.06;
      g.rotation.x = Math.cos(t * 0.22) * 0.025;
    } else {
      const ease = Math.min(1, (delta || 0.016) * 4);
      g.rotation.y += -g.rotation.y * ease;
      g.rotation.x += -g.rotation.x * ease;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0, backingPlateZ()]}>
        <boxGeometry args={[width + 0.12, PLANE_HEIGHT + 0.12, BACKING_DEPTH]} />
        <meshStandardMaterial color="#0b1220" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh>
        <planeGeometry args={[width, PLANE_HEIGHT, segments, segments]} />
        {/* One element, never two. A meshStandardMaterial multiplies its map by
            its colour, so colour is always stated: leaving it to whatever the
            instance happened to be carrying rendered the photo black. */}
        <meshStandardMaterial
          map={color || null}
          color={color ? '#ffffff' : '#334155'}
          displacementMap={depth || null}
          displacementScale={depth ? DEPTH_SCALE : 0}
          displacementBias={depth ? -DEPTH_SCALE * 0.55 : 0}
          roughness={0.85}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

const PanoramaSphere = ({ url, onState }: { url: string; onState: (s: LoadState) => void }) => {
  const { color, status } = useSceneTextures(url, false);
  useEffect(() => { onState(status); }, [status, onState]);
  if (!color) return null;
  // Deliberately still. The room does not turn on its own — the visitor is
  // standing in it, and only their head moves.
  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[10, 64, 40]} />
      <meshBasicMaterial map={color} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
};

const PANO_FOV_MIN = 32;   // zoomed in on a detail
const PANO_FOV_MAX = 88;   // takes in most of a wall
const PANO_FOV_DEFAULT = 75;

const PanoramaScene = ({ url, onState }: { url: string; onState: (s: LoadState) => void }) => {
  const { camera, gl } = useThree();

  useEffect(() => {
    camera?.position?.set?.(0, 0, 0.1);
    const cam = camera as THREE.PerspectiveCamera | undefined;
    if (cam?.isPerspectiveCamera) {
      cam.fov = PANO_FOV_DEFAULT;
      cam.updateProjectionMatrix();
    }
  }, [url, camera]);

  // Zoom by narrowing the view, not by walking toward the wall. Moving the
  // camera off centre inside the sphere distorts the whole image.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera | undefined;
    const el = gl?.domElement;
    if (!cam?.isPerspectiveCamera || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.fov = Math.min(PANO_FOV_MAX, Math.max(PANO_FOV_MIN, cam.fov + Math.sign(e.deltaY) * 3));
      cam.updateProjectionMatrix();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [camera, gl]);

  return (
    <>
      <PanoramaSphere key={url} url={url} onState={onState} />
      {/* No zoom and no pan: the camera stays at the centre of the sphere, which
          is the only place a panorama looks right from. */}
      <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={-0.35} />
    </>
  );
};

const Scene = ({ url, depthUrl, autoRotate, onState }: { url: string; depthUrl?: string | null; autoRotate: boolean; onState: (s: LoadState) => void }) => {
  const { camera, size } = useThree();
  const [aspect, setAspect] = useState(1.5);
  const width = PLANE_HEIGHT * planeAspect(aspect);
  const dist = fitDistance(width, PLANE_HEIGHT, (camera as any)?.fov ?? 50, (size?.width || 1) / (size?.height || 1));
  const fog = fogRange(dist, width, PLANE_HEIGHT);

  // setLength, not set: re-fitting on resize or on the next photo keeps whatever
  // angle the reader had turned the plane to.
  useEffect(() => {
    const p = camera?.position;
    if (!p?.setLength) { camera?.position?.set?.(0, 0, dist); return; }
    if (p.lengthSq() < 1e-6) p.set(0, 0, dist);
    else p.setLength(dist);
  }, [camera, dist, url]);

  return (
    <>
      {/* Behind the plane, not at a fixed distance: fitting the camera to the
          viewport moves it, and a fixed fog swallowed the picture. */}
      <fog attach="fog" args={['#05080f', fog[0], fog[1]]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 3, 4]} intensity={1.1} />
      <directionalLight position={[-3, -1, 2]} intensity={0.4} color="#cbd5e1" />
      <DepthPhoto key={url} url={url} depthUrl={depthUrl} sway={autoRotate} onState={onState} onAspect={setAspect} />
      {/* autoRotate is deliberately off: against a limit this tight it would
          swing to the stop and sit there. The sway above is the idle motion. */}
      <OrbitControls
        enablePan={false}
        enableZoom
        minDistance={dist * 0.55}
        maxDistance={dist * 1.5}
        minPolarAngle={Math.PI / 2 - MAX_POLAR}
        maxPolarAngle={Math.PI / 2 + MAX_POLAR}
        minAzimuthAngle={-MAX_AZIMUTH}
        maxAzimuthAngle={MAX_AZIMUTH}
      />
    </>
  );
};

const SpatialTourScene: React.FC<{
  rooms: TourRoomWaypoint[];
  activeRoomId: string | null;
  onSelectRoom: (id: string) => void;
}> = ({ rooms, activeRoomId, onSelectRoom }) => {
  const { camera } = useThree();
  const activeRoom = rooms.find(r => r.id === activeRoomId) || rooms[0];

  useFrame(() => {
    if (activeRoom) {
      const targetPos = new THREE.Vector3(
        activeRoom.camera?.position?.[0] ?? activeRoom.position[0],
        activeRoom.camera?.position?.[1] ?? activeRoom.position[1] + 1.2,
        activeRoom.camera?.position?.[2] ?? activeRoom.position[2] + 2.5
      );
      camera.position.lerp(targetPos, 0.05);
    }
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 15, 10]} intensity={1.2} />
      <gridHelper args={[24, 24, '#ff5722', '#334155']} position={[0, -0.01, 0]} />

      {rooms.map((room) => {
        const isSelected = room.id === activeRoomId;
        return (
          <group key={room.id} position={room.position}>
            <mesh onClick={() => onSelectRoom(room.id)}>
              <sphereGeometry args={[isSelected ? 0.35 : 0.22, 24, 24]} />
              <meshStandardMaterial
                color={isSelected ? '#ff5722' : '#38bdf8'}
                emissive={isSelected ? '#ff5722' : '#0284c7'}
                emissiveIntensity={isSelected ? 0.8 : 0.3}
              />
            </mesh>
            <mesh position={[0, -0.75, 0]}>
              <cylinderGeometry args={[0.02, 0.02, 1.5]} />
              <meshBasicMaterial color={isSelected ? '#ff5722' : '#0ea5e9'} transparent opacity={0.6} />
            </mesh>
          </group>
        );
      })}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        target={activeRoom ? new THREE.Vector3(...activeRoom.position) : new THREE.Vector3(0, 1.5, 0)}
      />
    </>
  );
};

export interface Property3DViewerProps {
  images: string[];
  /** Predicted depth maps, index-matched to images. */
  depthMaps?: string[];
  panoramas?: string[];
  /** A Matterport/Polycam scan, already passed through the URL allowlist. */
  tourUrl?: string | null;
  /** Hettety reconstructed 3D spatial tour asset (Gaussian Splat / SPZ / GLB) */
  threeDTour?: ThreeDTourAsset;
  title?: string;
  onClose: () => void;
  isRtl?: boolean;
}

const Property3DViewer: React.FC<Property3DViewerProps> = ({ images, depthMaps, panoramas, tourUrl, threeDTour, title, onClose, isRtl }) => {
  const validImages = useMemo(() => images.filter(Boolean), [images]);
  const validPanoramas = useMemo(() => (panoramas || []).filter(Boolean), [panoramas]);
  const rooms = useMemo(() => threeDTour?.rooms || [], [threeDTour]);
  const hasTourAsset = Boolean(threeDTour?.assetUrl || rooms.length > 0);

  const [mode, setMode] = useState<'tour' | 'pano' | 'depth'>(
    hasTourAsset ? 'tour' : validPanoramas.length ? 'pano' : 'depth'
  );
  const [activeRoomId, setActiveRoomId] = useState<string | null>(rooms[0]?.id || null);
  const activeRoom = useMemo(() => rooms.find(r => r.id === activeRoomId) || rooms[0], [rooms, activeRoomId]);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);

  const list = mode === 'pano' ? validPanoramas : validImages;
  const [index, setIndex] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const containerRef = useFocusTrap<HTMLDivElement>(true, onClose);

  // A photo that never loaded used to leave a grey slab with no explanation.
  const current = list[Math.min(index, Math.max(list.length - 1, 0))];

  const next = () => { setIndex((i) => (i + 1) % list.length); setAutoRotate(true); };
  const prev = () => { setIndex((i) => (i === 0 ? list.length - 1 : i - 1)); setAutoRotate(true); };
  const switchMode = (m: 'tour' | 'pano' | 'depth') => { setMode(m); setIndex(0); setAutoRotate(true); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length, mode]);

  if (validImages.length === 0 && validPanoramas.length === 0 && !hasTourAsset) {
    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={isRtl ? 'عرض العقار ثلاثي الأبعاد' : '3D Property Tour Viewer'}
        className="fixed inset-0 z-[70] bg-black flex flex-col items-center justify-center text-center p-6"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <Box className="w-16 h-16 text-brand-500 mb-4 opacity-50" aria-hidden="true" />
        <p className="text-slate-300 mb-6">
          {isRtl ? 'لا توجد صور متاحة لهذا العقار لعرضها بتقنية ثلاثية الأبعاد.' : 'No images are available for this property to display in 3D.'}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={isRtl ? 'رجوع وإغلاق المعاينة' : 'Back and close viewer'}
          className="min-w-[48px] min-h-[48px] bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-full border border-white/20 transition-colors cursor-pointer flex items-center justify-center font-medium focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          {isRtl ? 'رجوع' : 'Back'}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={isRtl ? 'عرض العقار ثلاثي الأبعاد' : '3D Property Tour Viewer'}
      className="fixed inset-0 z-[70] bg-black flex flex-col animate-fade-in"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="absolute top-0 w-full p-4 landscape:p-2 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none">
        <div className="text-white pointer-events-auto">
          <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
            <Box size={20} className="text-accent-500" aria-hidden="true" />
            {mode === 'tour'
              ? (isRtl ? 'جولة 3D تفاعلية (Waypoints)' : '3D Spatial Walkthrough')
              : mode === 'pano'
              ? (isRtl ? 'جولة 360°' : '360° Tour')
              : (isRtl ? 'معاينة مجسّمة للصورة' : 'Photo relief view')}
          </h3>
          {/* Spatial Representation Level Tag */}
          <div className="flex items-center gap-2 mt-1">
            {mode === 'tour' && (
              <span className="px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-[10px] font-bold">
                {isRtl ? 'المستوى 2: تجسيم فراغي 3DGS' : 'Level 2: 3DGS Spatial Scene'}
              </span>
            )}
            {mode === 'pano' && (
              <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px] font-bold">
                {isRtl ? 'المستوى 1: بانوراما 360° محيطية' : 'Level 1: 360° Panorama'}
              </span>
            )}
            {mode === 'depth' && (
              <span className="px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-300 border border-slate-500/30 text-[10px] font-medium">
                {isRtl ? 'بديل تقديري: صور مجسمة 2.5D (بارالاكس)' : 'Fallback: 2.5D Photo Relief (Parallax)'}
              </span>
            )}
          </div>
          {title && (
            <p className="text-xs sm:text-sm text-white/80 mt-0.5">
              {title} {activeRoom ? `• ${isRtl ? (activeRoom.nameAr || activeRoom.name) : activeRoom.name}` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={isRtl ? 'إغلاق العرض ثلاثي الأبعاد' : 'Close 3D viewer'}
          className="pointer-events-auto min-w-[48px] min-h-[48px] bg-white/10 hover:bg-white/20 p-3 rounded-full text-white backdrop-blur cursor-pointer transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      {tourUrl && (
        <a
          href={tourUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-20 landscape:top-14 left-1/2 -translate-x-1/2 z-20 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <Box size={16} aria-hidden="true" />
          {isRtl ? 'افتح الجولة الحقيقية داخل الوحدة' : 'Open the real walkthrough'}
        </a>
      )}

      {/* Mode Switcher */}
      {((hasTourAsset ? 1 : 0) + (validPanoramas.length > 0 ? 1 : 0) + (validImages.length > 0 ? 1 : 0)) > 1 && !tourUrl && (
        <div className="absolute top-20 landscape:top-14 left-1/2 -translate-x-1/2 z-10 flex bg-white/10 backdrop-blur border border-white/20 rounded-full p-1 shadow-lg">
          {hasTourAsset && (
            <button
              type="button"
              onClick={() => switchMode('tour')}
              aria-pressed={mode === 'tour'}
              aria-label={isRtl ? 'التبديل إلى جولة الغرف 3D' : 'Switch to 3D Room Tour'}
              className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 ${
                mode === 'tour' ? 'bg-brand-600 text-white' : 'text-white/80 hover:text-white'
              }`}
            >
              <Compass size={14} aria-hidden="true" /> {isRtl ? 'جولة الغرف 3D' : '3D Spatial'}
            </button>
          )}
          {validPanoramas.length > 0 && (
            <button
              type="button"
              onClick={() => switchMode('pano')}
              aria-pressed={mode === 'pano'}
              aria-label={isRtl ? 'التبديل إلى جولة 360°' : 'Switch to 360° Tour'}
              className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 ${
                mode === 'pano' ? 'bg-brand-600 text-white' : 'text-white/80 hover:text-white'
              }`}
            >
              <Box size={14} aria-hidden="true" /> {isRtl ? 'جولة 360°' : '360° Tour'}
            </button>
          )}
          {validImages.length > 0 && (
            <button
              type="button"
              onClick={() => switchMode('depth')}
              aria-pressed={mode === 'depth'}
              aria-label={isRtl ? 'التبديل إلى الصور المجسّمة' : 'Switch to photo relief'}
              className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 ${
                mode === 'depth' ? 'bg-brand-600 text-white' : 'text-white/80 hover:text-white'
              }`}
            >
              <Layers size={14} aria-hidden="true" /> {isRtl ? 'صور مجسّمة' : 'Photo relief'}
            </button>
          )}
        </div>
      )}

      {/* Room Waypoint Navigator Bar */}
      {rooms.length > 0 && (
        <div className="absolute top-32 sm:top-28 start-1/2 -translate-x-1/2 z-20 flex items-center justify-center max-w-full px-4">
          <RoomNavigation
            rooms={rooms}
            activeRoomId={activeRoomId || undefined}
            onSelectRoom={(id) => {
              setActiveRoomId(id);
              if (mode !== 'tour' && hasTourAsset) setMode('tour');
            }}
            showFloorPlan={showFloorPlan}
            onToggleFloorPlan={() => setShowFloorPlan(!showFloorPlan)}
            showMeasure={showMeasure}
            onToggleMeasure={() => setShowMeasure(!showMeasure)}
            isRtl={isRtl}
          />
        </div>
      )}

      {/* Floating Floor Plan */}
      {showFloorPlan && rooms.length > 0 && (
        <div className="absolute bottom-24 start-6 z-30 animate-fade-in">
          <FloorPlan
            rooms={rooms}
            activeRoomId={activeRoomId || undefined}
            onSelectRoom={(id) => setActiveRoomId(id)}
            isRtl={isRtl}
          />
        </div>
      )}

      {/* Floating Measurement Tool */}
      {showMeasure && (
        <div className="absolute bottom-24 end-6 z-30 animate-fade-in">
          <MeasurementTool
            isCalibrated={Boolean(
              threeDTour?.qualityReport?.certification
                ? threeDTour.qualityReport.certification.metricCertified
                : (threeDTour?.isCalibratedMetric ??
                   threeDTour?.representation?.mesh?.isCalibratedMetric ??
                   threeDTour?.representation?.gaussianSplat?.isCalibratedMetric)
            )}
            isRtl={isRtl}
          />
        </div>
      )}

      {/* In-Viewer Spatial AI Assistant */}
      <SpatialAiAssistant
        tour={threeDTour as any}
        onNavigateToRoom={(roomId) => setActiveRoomId(roomId)}
        isRtl={isRtl}
      />

      {mode === 'tour' ? (
        threeDTour && (threeDTour.representation?.gaussianSplat?.url || threeDTour.representation?.mesh?.url || threeDTour.source === 'matterport' || threeDTour.source === 'polycam') ? (
          <div className="flex-1 w-full h-full relative">
            <TourViewer
              tour={threeDTour as any}
              title={title}
              onClose={onClose}
              isRtl={isRtl}
            />
          </div>
        ) : threeDTour && (['failed', 'cancelled', 'processing', 'uploading', 'queued', 'optimizing'].includes(threeDTour.status)) ? (
          <div className="flex-1 w-full h-full flex flex-col items-center justify-center p-6 text-center bg-slate-950 text-white z-20">
            {threeDTour.status === 'failed' ? (
              <div className="max-w-md p-6 bg-slate-900 border border-red-500/30 rounded-2xl shadow-xl flex flex-col items-center">
                <AlertCircle className="w-12 h-12 text-red-400 mb-3" aria-hidden="true" />
                <h4 className="text-lg font-bold mb-2">
                  {isRtl ? 'تعذر استكمال المعالجة ثلاثية الأبعاد' : '3D Reconstruction Failed'}
                </h4>
                <p className="text-sm text-slate-300 mb-4">
                  {isRtl
                    ? 'لم تتمكن خوارزميات الاستشعار الفوتوغرافي من مطابقة المعالم أو تجاوز عتبة الجودة الهندسية المطلوبة.'
                    : 'The photogrammetry pipeline could not resolve camera alignment or met minimum sharpness criteria.'}
                </p>
                {validImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => switchMode('depth')}
                    className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition cursor-pointer"
                  >
                    {isRtl ? 'عرض الصور بتقنية التجسيم 2.5D' : 'Switch to 2.5D Photo Relief'}
                  </button>
                )}
              </div>
            ) : threeDTour.status === 'cancelled' ? (
              <div className="max-w-md p-6 bg-slate-900 border border-amber-500/30 rounded-2xl shadow-xl flex flex-col items-center">
                <AlertCircle className="w-12 h-12 text-amber-400 mb-3" aria-hidden="true" />
                <h4 className="text-lg font-bold mb-2">
                  {isRtl ? 'تم إلغاء مهمة المعالجة' : 'Reconstruction Task Cancelled'}
                </h4>
                <p className="text-sm text-slate-300 mb-4">
                  {isRtl ? 'تم إلغاء المهمة وتفريغ موارد عقد المعالجة الرسومية.' : 'The task was cancelled by user request and GPU worker resources were freed.'}
                </p>
              </div>
            ) : (
              <div className="max-w-md p-6 bg-slate-900/90 border border-brand-500/30 rounded-2xl shadow-xl flex flex-col items-center">
                <Loader2 className="w-10 h-10 text-brand-400 animate-spin mb-3" aria-hidden="true" />
                <h4 className="text-lg font-bold mb-1">
                  {threeDTour.status === 'uploading'
                    ? (isRtl ? 'جاري رفع وتدقيق الصور الفوتوغرافية...' : 'Uploading & Validating Photos...')
                    : threeDTour.status === 'queued'
                    ? (isRtl ? 'في قائمة انتظار عقد المعالجة GPU...' : 'Queued for GPU Reconstruction...')
                    : threeDTour.status === 'processing'
                    ? (isRtl ? 'معالجة COLMAP والتجسيم الفراغي 3DGS...' : 'COLMAP SfM & 3DGS Training...')
                    : (isRtl ? 'ضغط الأصول SPZ والمعايرة المترية...' : 'SPZ Compression & Metric Calibration...')}
                </h4>
                <p className="text-xs text-slate-400 mb-4">
                  {isRtl ? 'جاري إنشاء نموذج ثلاثي الأبعاد حقيقي عالي الدقة بمقاييس هندسية دقيقة.' : 'Generating verified high-fidelity 3D spatial tour with true metric dimensions.'}
                </p>
                {validImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => switchMode('depth')}
                    className="text-xs text-brand-300 hover:text-brand-200 underline cursor-pointer"
                  >
                    {isRtl ? 'تصفح الصور المجسمة ريثما تنتهي المعالجة' : 'Browse photo relief while processing completes'}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <Canvas camera={{ position: [0, 2, 5], fov: 60 }} className="flex-1" gl={{ antialias: true }}>
            <color attach="background" args={['#05080f']} />
            <SpatialTourScene rooms={rooms} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} />
          </Canvas>
        )
      ) : mode === 'pano' ? (
        <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }} className="flex-1" gl={{ antialias: true }}>
          <color attach="background" args={['#05080f']} />
          <PanoramaScene url={current} onState={setLoadState} />
        </Canvas>
      ) : (
        <Canvas
          camera={{ position: [0, 0, 4], fov: 50 }}
          className="flex-1"
          gl={{ antialias: true }}
          onPointerDown={() => setAutoRotate(false)}
        >
          <color attach="background" args={['#05080f']} />
          <Scene url={current} depthUrl={(depthMaps || [])[index] || null} autoRotate={autoRotate} onState={setLoadState} />
        </Canvas>
      )}

      {/* A large photo takes a moment; silence used to look like a broken viewer. */}
      {loadState !== 'ready' && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center pointer-events-none text-white/80 gap-3">
          {loadState === 'loading' ? (
            <>
              <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
              <p className="text-sm">{isRtl ? 'جاري تحميل الصورة…' : 'Loading the photo…'}</p>
            </>
          ) : (
            <>
              <Box className="w-10 h-10 opacity-40" aria-hidden="true" />
              <p className="text-sm max-w-xs text-center px-6">
                {isRtl ? 'تعذّر تحميل الصورة دي. جرّب صورة تانية.' : 'That photo could not be loaded. Try another one.'}
              </p>
            </>
          )}
        </div>
      )}

      <div className="absolute bottom-0 w-full p-4 sm:p-6 landscape:p-2 flex items-center justify-center gap-4 bg-gradient-to-t from-black/80 to-transparent z-10">
        {list.length > 1 && (
          <button
            type="button"
            onClick={prev}
            aria-label={isRtl ? 'الصورة السابقة' : 'Previous image'}
            className="min-w-[48px] min-h-[48px] bg-white/10 hover:bg-white/25 p-3 rounded-full text-white backdrop-blur border border-white/20 transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        )}
        <div className="text-white text-sm font-bold tracking-widest min-w-[64px] text-center select-none" aria-live="polite">
          {index + 1} / {list.length}
        </div>
        {list.length > 1 && (
          <button
            type="button"
            onClick={next}
            aria-label={isRtl ? 'الصورة التالية' : 'Next image'}
            className="min-w-[48px] min-h-[48px] bg-white/10 hover:bg-white/25 p-3 rounded-full text-white backdrop-blur border border-white/20 transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        )}
        {mode === 'depth' && (
          <button
            type="button"
            onClick={() => setAutoRotate((a) => !a)}
            aria-label={isRtl ? 'تبديل التدوير التلقائي' : 'Toggle auto-rotate'}
            aria-pressed={autoRotate}
            className={`min-w-[48px] min-h-[48px] p-3 rounded-full backdrop-blur border transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400 ${
              autoRotate ? 'bg-brand-600 border-brand-500 text-white' : 'bg-white/10 hover:bg-white/25 border-white/20 text-white'
            }`}
          >
            <RotateCcw size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="absolute bottom-24 landscape:bottom-14 w-full text-center text-white/80 text-xs pointer-events-none select-none flex items-center justify-center gap-2 px-4">
        <Move3d size={14} aria-hidden="true" />
        <span>
          {mode === 'pano'
            ? (isRtl ? 'اسحب للالتفاف 360° داخل الغرفة • عجلة الفأرة للتقريب' : 'Drag to look around 360° • Scroll to zoom')
            : (isRtl ? 'اسحب لرؤية الصورة من زوايا مختلفة — دي معاينة مجسّمة للصورة نفسها، مش مسح للمكان' : 'Drag to view from other angles — this is a relief built from the photo, not a scan of the room')}
        </span>
      </p>
    </div>
  );
};

export default Property3DViewer;
