import { useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import itzaminaStlUrl from '../../assets/itzamina.stl?url';

interface OrientationDisplayProps {
  gyroX: number | null;
  gyroY: number | null;
  gyroZ: number | null;
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
}

const ACCEL_G_PER_LSB = 1 / 5460.0;
const GYRO_DPS_PER_LSB = 1 / 16.4;
const GYRO_RADPS_PER_LSB = (Math.PI / 180.0) / 16.4;
const GYRO_DEADBAND_DPS = 0.35;
const ACCEL_LPF_ALPHA = 0.24;
const VISUAL_SLERP = 0.55;
const ACCEL_TRUST_MIN = 0.08;
const KALMAN_Q_ANGLE = 0.008;
const KALMAN_Q_BIAS = 0.0025;
const KALMAN_R_MEASURE = 0.04;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

interface KalmanAngleState {
  angle: number;
  bias: number;
  p00: number;
  p01: number;
  p10: number;
  p11: number;
  initialized: boolean;
}

const createKalmanState = (): KalmanAngleState => ({
  angle: 0,
  bias: 0,
  p00: 1,
  p01: 0,
  p10: 0,
  p11: 1,
  initialized: false,
});

const updateKalmanAngle = (
  state: KalmanAngleState,
  measuredAngleRad: number,
  measuredRateRadPerSec: number,
  dtSeconds: number,
  qAngle: number,
  qBias: number,
  rMeasure: number
) => {
  if (!state.initialized) {
    state.angle = measuredAngleRad;
    state.bias = 0;
    state.initialized = true;
    return state.angle;
  }

  const rate = measuredRateRadPerSec - state.bias;
  state.angle += dtSeconds * rate;

  state.p00 += dtSeconds * (dtSeconds * state.p11 - state.p01 - state.p10 + qAngle);
  state.p01 -= dtSeconds * state.p11;
  state.p10 -= dtSeconds * state.p11;
  state.p11 += qBias * dtSeconds;

  const innovation = angleDelta(measuredAngleRad, state.angle);
  const s = state.p00 + rMeasure;
  const k0 = state.p00 / s;
  const k1 = state.p10 / s;

  state.angle += k0 * innovation;
  state.bias += k1 * innovation;

  const p00Temp = state.p00;
  const p01Temp = state.p01;
  state.p00 -= k0 * p00Temp;
  state.p01 -= k0 * p01Temp;
  state.p10 -= k1 * p00Temp;
  state.p11 -= k1 * p01Temp;

  state.angle = Math.atan2(Math.sin(state.angle), Math.cos(state.angle));
  return state.angle;
};

export default function OrientationDisplay({
  gyroX,
  gyroY,
  gyroZ,
  accelX,
  accelY,
  accelZ,
}: OrientationDisplayProps) {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const vehicleRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const localAxesRef = useRef<THREE.AxesHelper | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraDirectionRef = useRef(new THREE.Vector3(2.8, -2.5, 2.1).normalize());
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0.15));
  const cameraBaseDistanceRef = useRef(4.3);
  const zoomPercentRef = useRef(100);
  const zOffsetDegRef = useRef(0);
  const gyroInputRef = useRef(new THREE.Vector3(0, 0, 0));
  const accelInputRef = useRef(new THREE.Vector3(0, 0, 1));
  const accelFilteredRef = useRef(new THREE.Vector3(0, 0, 1));
  const kalmanRollRef = useRef<KalmanAngleState>(createKalmanState());
  const kalmanPitchRef = useRef<KalmanAngleState>(createKalmanState());
  const yawRadRef = useRef(0);
  const filterTargetQuatRef = useRef(new THREE.Quaternion());
  const filterEulerRef = useRef(new THREE.Euler(0, 0, 0, 'ZYX'));
  const lastFilterMsRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [zOffsetDeg, setZOffsetDeg] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxesLegend, setShowAxesLegend] = useState(true);
  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050505');
    scene.up.set(0, 0, 1);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf97316, 0.45);
    fillLight.position.set(-3, -2, 2);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(5, 10, 0x334155, 0x1f2937);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -1.2;
    grid.visible = showGrid;
    scene.add(grid);
    gridRef.current = grid;

    const vehicleGroup = new THREE.Group();
    vehicleGroup.rotation.order = 'ZYX';
    scene.add(vehicleGroup);
    vehicleRef.current = vehicleGroup;
    kalmanRollRef.current = createKalmanState();
    kalmanPitchRef.current = createKalmanState();
    yawRadRef.current = 0;
    filterTargetQuatRef.current.identity();
    lastFilterMsRef.current = performance.now();

    const localAxes = new THREE.AxesHelper(0.9);
    localAxes.visible = showAxesLegend;
    vehicleGroup.add(localAxes);
    localAxesRef.current = localAxes;

    const fallbackGeometry = new THREE.BoxGeometry(0.18, 0.18, 1.4);
    const fallbackMaterial = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      metalness: 0.25,
      roughness: 0.45,
      emissive: 0x331100,
      emissiveIntensity: 0.25,
    });
    const fallbackMesh = new THREE.Mesh(fallbackGeometry, fallbackMaterial);
    fallbackMesh.visible = false;
    vehicleGroup.add(fallbackMesh);

    const loader = new STLLoader();
    let stlGeometry: THREE.BufferGeometry | null = null;
    let stlMaterial: THREE.MeshStandardMaterial | null = null;
    let stlMesh: THREE.Mesh | null = null;
    let disposed = false;

    const attachFallback = () => {
      fallbackMesh.visible = true;
    };

    loader.load(
      itzaminaStlUrl,
      (geometry) => {
        if (disposed) {
          geometry.dispose();
          return;
        }

        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) {
          attachFallback();
          geometry.dispose();
          return;
        }

        const size = new THREE.Vector3();
        bounds.getSize(size);
        const longestDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 1.8 / longestDim;

        stlMaterial = new THREE.MeshStandardMaterial({
          color: 0xf97316,
          metalness: 0.2,
          roughness: 0.45,
          emissive: 0x331100,
          emissiveIntensity: 0.18,
          side: THREE.DoubleSide,
        });
        stlGeometry = geometry;
        stlMesh = new THREE.Mesh(stlGeometry, stlMaterial);
        stlMesh.scale.setScalar(scale);

        // Normalize to Z-up so +Z aligns with "sky" orientation.
        if (size.x > size.y && size.x > size.z) {
          stlMesh.rotation.y = -Math.PI / 2;
        } else if (size.y > size.x && size.y > size.z) {
          stlMesh.rotation.x = Math.PI / 2;
        }

        localAxes.scale.setScalar(Math.max(0.45, Math.min(1.3, scale * longestDim * 0.52)));
        localAxes.position.set(0, 0, 0);

        vehicleGroup.add(stlMesh);
        fallbackMesh.visible = false;
      },
      undefined,
      () => {
        attachFallback();
      }
    );

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const zoomFactor = Math.max(50, Math.min(200, zoomPercentRef.current)) / 100;
      const distance = cameraBaseDistanceRef.current / zoomFactor;
      camera.position
        .copy(cameraDirectionRef.current)
        .multiplyScalar(distance);
      camera.lookAt(cameraTargetRef.current);
      camera.updateProjectionMatrix();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const animate = () => {
      const vehicle = vehicleRef.current;
      if (vehicle) {
        const now = performance.now();
        const prev = lastFilterMsRef.current ?? now;
        const dt = clamp((now - prev) / 1000, 0.001, 0.05);
        lastFilterMsRef.current = now;

        accelFilteredRef.current.lerp(accelInputRef.current, ACCEL_LPF_ALPHA);

        let gxDps = gyroInputRef.current.x * GYRO_DPS_PER_LSB;
        let gyDps = gyroInputRef.current.y * GYRO_DPS_PER_LSB;
        let gzDps = gyroInputRef.current.z * GYRO_DPS_PER_LSB;
        gxDps = Math.abs(gxDps) < GYRO_DEADBAND_DPS ? 0 : gxDps;
        gyDps = Math.abs(gyDps) < GYRO_DEADBAND_DPS ? 0 : gyDps;
        gzDps = Math.abs(gzDps) < GYRO_DEADBAND_DPS ? 0 : gzDps;

        // Equivalent raw form from your setup:
        // gyro_radps = raw_gyro * ((pi / 180.0) / 16.4)
        const gxFromRaw = gyroInputRef.current.x * GYRO_RADPS_PER_LSB;
        const gyFromRaw = gyroInputRef.current.y * GYRO_RADPS_PER_LSB;
        const gzFromRaw = gyroInputRef.current.z * GYRO_RADPS_PER_LSB;
        const gxRate = Math.abs(gxDps) < GYRO_DEADBAND_DPS ? 0 : gxFromRaw;
        const gyRate = Math.abs(gyDps) < GYRO_DEADBAND_DPS ? 0 : gyFromRaw;
        const gzRate = Math.abs(gzDps) < GYRO_DEADBAND_DPS ? 0 : gzFromRaw;

        const axG = accelFilteredRef.current.x * ACCEL_G_PER_LSB;
        const ayG = accelFilteredRef.current.y * ACCEL_G_PER_LSB;
        const azG = accelFilteredRef.current.z * ACCEL_G_PER_LSB;

        const accelMagG = Math.sqrt(axG * axG + ayG * ayG + azG * azG);
        const hasAccelMeasurement = accelMagG > 0.15;

        let roll = kalmanRollRef.current.angle + gxRate * dt;
        let pitch = kalmanPitchRef.current.angle + gyRate * dt;
        const accelMagSq = accelFilteredRef.current.lengthSq();
        if (hasAccelMeasurement && accelMagSq > 0.000001) {
          const nx = axG / accelMagG;
          const ny = ayG / accelMagG;
          const nz = azG / accelMagG;
          const rollAcc = Math.atan2(ny, nz);
          const pitchAcc = Math.atan2(-nx, Math.sqrt(ny * ny + nz * nz));

          const gyroMagnitudeDps = Math.sqrt(gxDps * gxDps + gyDps * gyDps + gzDps * gzDps);
          const accelMagError = Math.abs(accelMagG - 1);
          const accelTrust = clamp((1 - accelMagError * 2.2) * (1 - clamp(gyroMagnitudeDps / 220, 0, 1) * 0.65), ACCEL_TRUST_MIN, 1);
          const rMeasure = KALMAN_R_MEASURE / accelTrust;

          roll = updateKalmanAngle(
            kalmanRollRef.current,
            rollAcc,
            gxRate,
            dt,
            KALMAN_Q_ANGLE,
            KALMAN_Q_BIAS,
            rMeasure
          );
          pitch = updateKalmanAngle(
            kalmanPitchRef.current,
            pitchAcc,
            gyRate,
            dt,
            KALMAN_Q_ANGLE,
            KALMAN_Q_BIAS,
            rMeasure
          );
        } else {
          kalmanRollRef.current.angle = roll;
          kalmanPitchRef.current.angle = pitch;
        }

        yawRadRef.current += gzRate * dt;
        yawRadRef.current = Math.atan2(Math.sin(yawRadRef.current), Math.cos(yawRadRef.current));

        filterEulerRef.current.set(
          roll,
          pitch,
          yawRadRef.current + (zOffsetDegRef.current * Math.PI) / 180,
          'ZYX'
        );
        filterTargetQuatRef.current.setFromEuler(filterEulerRef.current);
        vehicle.quaternion.slerp(filterTargetQuatRef.current, VISUAL_SLERP);
      }
      camera.lookAt(cameraTargetRef.current);
      renderer.render(scene, camera);
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      disposed = true;
      observer.disconnect();
      if (host.contains(renderer.domElement)) {
        host.removeChild(renderer.domElement);
      }
      fallbackGeometry.dispose();
      fallbackMaterial.dispose();
      if (stlGeometry) {
        stlGeometry.dispose();
      }
      if (stlMaterial) {
        stlMaterial.dispose();
      }
      if (stlMesh) {
        vehicleGroup.remove(stlMesh);
      }
      renderer.dispose();
      vehicleRef.current = null;
      gridRef.current = null;
      localAxesRef.current = null;
      cameraRef.current = null;
      lastFilterMsRef.current = null;
    };
  }, []);

  useEffect(() => {
    gyroInputRef.current.set(gyroX ?? 0, gyroY ?? 0, gyroZ ?? 0);
  }, [gyroX, gyroY, gyroZ]);

  useEffect(() => {
    accelInputRef.current.set(accelX ?? 0, accelY ?? 0, accelZ ?? 1);
  }, [accelX, accelY, accelZ]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid;
    }
  }, [showGrid]);

  useEffect(() => {
    if (localAxesRef.current) {
      localAxesRef.current.visible = showAxesLegend;
    }
  }, [showAxesLegend]);

  useEffect(() => {
    zoomPercentRef.current = zoomPercent;
    const camera = cameraRef.current;
    if (!camera) {
      return;
    }
    const zoomFactor = Math.max(50, Math.min(200, zoomPercent)) / 100;
    const distance = cameraBaseDistanceRef.current / zoomFactor;
    camera.position.copy(cameraDirectionRef.current).multiplyScalar(distance);
    camera.lookAt(cameraTargetRef.current);
    camera.updateProjectionMatrix();
  }, [zoomPercent]);

  useEffect(() => {
    zOffsetDegRef.current = zOffsetDeg;
  }, [zOffsetDeg]);

  const gyroLabel = useMemo(
    () => ({
      x: gyroX === null ? '--' : gyroX.toFixed(0),
      y: gyroY === null ? '--' : gyroY.toFixed(0),
      z: gyroZ === null ? '--' : gyroZ.toFixed(0),
    }),
    [gyroX, gyroY, gyroZ]
  );

  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-gray-400 text-xs tracking-widest">3D ORIENTATION</div>
        <button
          type="button"
          onClick={() => setOptionsOpen((current) => !current)}
          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] tracking-wider rounded border border-gray-600 text-gray-300 hover:border-orange-500 hover:text-orange-300 transition-colors"
          aria-expanded={optionsOpen}
          aria-label="Orientation options"
        >
          <SlidersHorizontal size={12} />
          OPT
        </button>
      </div>
      <div className="relative w-full aspect-square rounded border border-orange-500/20 bg-black/50 overflow-hidden">
        <div ref={canvasHostRef} className="absolute inset-0" />
        <div className="absolute bottom-2 right-2 text-[11px] text-blue-400 font-semibold">Z+ SKY</div>
      </div>
      {optionsOpen ? (
        <div className="mt-2 border border-gray-700/60 rounded p-2 bg-black/30 text-[11px] text-gray-300 space-y-2">
          <label className="flex items-center justify-between gap-3">
            <span>Show floor grid</span>
            <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Show XYZ legend</span>
            <input
              type="checkbox"
              checked={showAxesLegend}
              onChange={(event) => setShowAxesLegend(event.target.checked)}
            />
          </label>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span>Zoom</span>
              <span>{zoomPercent}%</span>
            </div>
            <input
              type="range"
              min={60}
              max={180}
              step={1}
              value={zoomPercent}
              onChange={(event) => setZoomPercent(Number(event.target.value))}
              className="w-full accent-orange-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span>Z rotation offset</span>
              <span>{zOffsetDeg.toFixed(0)} deg</span>
            </div>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={zOffsetDeg}
              onChange={(event) => setZOffsetDeg(Number(event.target.value))}
              className="w-full accent-orange-500"
            />
          </div>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-400">
        <div className="border border-gray-700/60 rounded px-2 py-1 bg-black/30">GX: {gyroLabel.x}</div>
        <div className="border border-gray-700/60 rounded px-2 py-1 bg-black/30">GY: {gyroLabel.y}</div>
        <div className="border border-gray-700/60 rounded px-2 py-1 bg-black/30">GZ: {gyroLabel.z}</div>
      </div>
    </div>
  );
}
