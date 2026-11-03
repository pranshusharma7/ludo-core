import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PlayerColor } from '@royal-ludo/shared';
import { useHaptics } from '../../hooks/useHaptics';
import { useAudio } from '../../hooks/useAudio';

// Generate high-res canvas textures for each face of the ivory/bone dice
function createDiceFaceTexture(faceNumber: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // 1. Warm ivory/bone background with subtle gradient
  const bgGrad = ctx.createRadialGradient(256, 256, 50, 256, 256, 320);
  bgGrad.addColorStop(0, '#ffffff');
  bgGrad.addColorStop(0.65, '#f7efe1');
  bgGrad.addColorStop(1, '#e3d2ba');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 512);

  // 2. Beveled rounded inner border with soft ambient occlusion
  ctx.strokeStyle = '#c5b195';
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, 488, 488);

  // Soft corner vignettes
  const borderGrad = ctx.createRadialGradient(256, 256, 200, 256, 256, 256);
  borderGrad.addColorStop(0, 'rgba(0,0,0,0)');
  borderGrad.addColorStop(1, 'rgba(120,95,65,0.18)');
  ctx.fillStyle = borderGrad;
  ctx.fillRect(0, 0, 512, 512);

  // 3. Draw Engraved Circular Pips
  const pipColor = faceNumber === 1 ? '#c52828' : '#221914';
  const pipBorder = faceNumber === 1 ? '#e57373' : '#3d2e24';
  const pipRadius = faceNumber === 1 ? 46 : 34;

  const drawPip = (x: number, y: number, radius = pipRadius) => {
    // Engraved depression outer shadow
    ctx.beginPath();
    ctx.arc(x, y + 2, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();

    // Inset pip core
    const pipGrad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    pipGrad.addColorStop(0, faceNumber === 1 ? '#ff7b7b' : '#3a2a20');
    pipGrad.addColorStop(0.75, pipColor);
    pipGrad.addColorStop(1, '#000000');

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = pipGrad;
    ctx.fill();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = pipBorder;
    ctx.stroke();

    // Specular inner gloss dot
    ctx.beginPath();
    ctx.arc(x - radius * 0.35, y - radius * 0.35, radius * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fill();
  };

  const center = 256;
  const left = 140;
  const right = 372;
  const top = 140;
  const bottom = 372;

  switch (faceNumber) {
    case 1:
      drawPip(center, center, 52);
      break;
    case 2:
      drawPip(left, top);
      drawPip(right, bottom);
      break;
    case 3:
      drawPip(left, top);
      drawPip(center, center);
      drawPip(right, bottom);
      break;
    case 4:
      drawPip(left, top);
      drawPip(right, top);
      drawPip(left, bottom);
      drawPip(right, bottom);
      break;
    case 5:
      drawPip(left, top);
      drawPip(right, top);
      drawPip(center, center);
      drawPip(left, bottom);
      drawPip(right, bottom);
      break;
    case 6:
      drawPip(left, top);
      drawPip(left, center);
      drawPip(left, bottom);
      drawPip(right, top);
      drawPip(right, center);
      drawPip(right, bottom);
      break;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

// Target rotations for Three.js BoxGeometry so target face points straight UP (+Y)
// BoxGeometry faces:
// [0] +X -> Face 2
// [1] -X -> Face 5
// [2] +Y -> Face 1
// [3] -Y -> Face 6
// [4] +Z -> Face 3
// [5] -Z -> Face 4
function getTargetEulerForFace(face: number): THREE.Euler {
  switch (face) {
    case 1: // Face 1 (+Y) already points UP
      return new THREE.Euler(0, 0, 0);
    case 6: // Face 6 (-Y) -> rotate 180° on X
      return new THREE.Euler(Math.PI, 0, 0);
    case 2: // Face 2 (+X) -> rotate +90° on Z brings +X to +Y
      return new THREE.Euler(0, 0, Math.PI / 2);
    case 5: // Face 5 (-X) -> rotate -90° on Z brings -X to +Y
      return new THREE.Euler(0, 0, -Math.PI / 2);
    case 3: // Face 3 (+Z) -> rotate -90° on X brings +Z to +Y
      return new THREE.Euler(-Math.PI / 2, 0, 0);
    case 4: // Face 4 (-Z) -> rotate +90° on X brings -Z to +Y
      return new THREE.Euler(Math.PI / 2, 0, 0);
    default:
      return new THREE.Euler(0, 0, 0);
  }
}

export interface DiceThreeJSProps {
  rollValue: number | null;
  isMyTurn: boolean;
  canRoll: boolean;
  activeColor: PlayerColor;
  onRoll: () => void;
  lastDiceEvent?: { playerColor: PlayerColor; roll: number; timestamp?: number } | null;
}

export const DiceThreeJS: React.FC<DiceThreeJSProps> = ({
  rollValue,
  isMyTurn,
  canRoll,
  activeColor,
  onRoll,
  lastDiceEvent
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const { hapticRoll } = useHaptics();
  const { playDiceRoll } = useAudio();

  const [hasWebGL, setHasWebGL] = useState(true);
  const [isRolling, setIsRolling] = useState(false);
  const rollSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // References for Three.js scene
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const diceMeshRef = useRef<THREE.Mesh | null>(null);
  const shadowMeshRef = useRef<THREE.Mesh | null>(null);
  const animReqRef = useRef<number | null>(null);

  // Physics animation variables
  const animStateRef = useRef<{
    active: boolean;
    startTime: number;
    duration: number;
    targetFace: number;
    initialRot: THREE.Euler;
    spinSpeedX: number;
    spinSpeedY: number;
    spinSpeedZ: number;
    hasBounced1: boolean;
    hasBounced2: boolean;
    hasLanded: boolean;
  }>({
    active: false,
    startTime: 0,
    duration: 1050,
    targetFace: 1,
    initialRot: new THREE.Euler(),
    spinSpeedX: 0,
    spinSpeedY: 0,
    spinSpeedZ: 0,
    hasBounced1: false,
    hasBounced2: false,
    hasLanded: false
  });

  // Setup Three.js WebGL Scene
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Check WebGL support
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      if (!gl) {
        setHasWebGL(false);
        return;
      }
    } catch (e) {
      setHasWebGL(false);
      return;
    }

    const width = mount.clientWidth || 160;
    const height = mount.clientHeight || 160;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(0, 4.4, 4.8);
    camera.lookAt(0, 0.2, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    mount.appendChild(renderer.domElement);

    // Warm Ambient Light
    const ambientLight = new THREE.AmbientLight(0xfff6ea, 0.95);
    scene.add(ambientLight);

    // Key Directional Light with Soft Shadows
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(4, 8, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);

    // Subtle Cyan / Blue Fill Rim Light
    const rimLight = new THREE.DirectionalLight(0xa5c4e8, 0.5);
    rimLight.position.set(-4, 2, -4);
    scene.add(rimLight);

    // Soft Contact Shadow Mesh on Floor
    const shadowGeo = new THREE.PlaneGeometry(2.4, 2.4);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const sGrad = sCtx.createRadialGradient(64, 64, 0, 64, 64, 60);
    sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
    sGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.02;
    scene.add(shadowMesh);
    shadowMeshRef.current = shadowMesh;

    // Build the 3D Dice Mesh
    const diceGeo = new THREE.BoxGeometry(1.65, 1.65, 1.65, 1, 1, 1);

    // BoxGeometry materials mapping:
    // [0] +X -> Face 2
    // [1] -X -> Face 5
    // [2] +Y -> Face 1
    // [3] -Y -> Face 6
    // [4] +Z -> Face 3
    // [5] -Z -> Face 4
    const materials = [
      createDiceFaceTexture(2),
      createDiceFaceTexture(5),
      createDiceFaceTexture(1),
      createDiceFaceTexture(6),
      createDiceFaceTexture(3),
      createDiceFaceTexture(4)
    ].map(
      tex =>
        new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.18,
          metalness: 0.04
        })
    );

    const diceMesh = new THREE.Mesh(diceGeo, materials);
    diceMesh.castShadow = true;
    diceMesh.receiveShadow = false;
    diceMesh.position.set(0, 0.82, 0); // resting on floor
    scene.add(diceMesh);
    diceMeshRef.current = diceMesh;

    // Set initial face (1 showing up)
    diceMesh.rotation.copy(getTargetEulerForFace(rollValue || 1));

    // Animation & Render Loop
    const renderLoop = () => {
      animReqRef.current = requestAnimationFrame(renderLoop);

      const anim = animStateRef.current;
      const dice = diceMeshRef.current;
      const shadow = shadowMeshRef.current;

      if (anim.active && dice && shadow) {
        const elapsed = performance.now() - anim.startTime;
        const p = Math.min(1, elapsed / anim.duration);

        // Physical Elevation trajectory with 2 bounces:
        // Height curve: starts at 0.82, leaps to 2.5, drops to 0.82, bounces to 1.35, drops to 0.82, settles
        let height = 0.82;
        if (p < 0.45) {
          // Leap 1
          const t1 = p / 0.45;
          height = 0.82 + Math.sin(t1 * Math.PI) * 1.75;
        } else if (p < 0.72) {
          // Bounce 1
          if (!anim.hasBounced1) {
            anim.hasBounced1 = true;
            playDiceRoll();
          }
          const t2 = (p - 0.45) / 0.27;
          height = 0.82 + Math.sin(t2 * Math.PI) * 0.55;
        } else if (p < 0.90) {
          // Bounce 2
          if (!anim.hasBounced2) {
            anim.hasBounced2 = true;
            playDiceRoll();
          }
          const t3 = (p - 0.72) / 0.18;
          height = 0.82 + Math.sin(t3 * Math.PI) * 0.18;
        } else {
          // Final touchdown & settle
          if (!anim.hasLanded) {
            anim.hasLanded = true;
            playDiceRoll();
            hapticRoll();
          }
          height = 0.82;
        }

        dice.position.y = height;

        // Shadow scaling and opacity in sync with height
        const shadowScale = Math.max(0.4, 1.0 - (height - 0.82) * 0.35);
        shadow.scale.set(shadowScale, shadowScale, 1);
        (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.2, 0.75 - (height - 0.82) * 0.3);

        // Rotation physics:
        // During early roll: spin rapidly
        // During settle: smoothly blend to target Euler
        const targetEuler = getTargetEulerForFace(anim.targetFace);
        const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);

        if (p < 0.72) {
          dice.rotation.x += anim.spinSpeedX * (1 - p * 0.45);
          dice.rotation.y += anim.spinSpeedY * (1 - p * 0.45);
          dice.rotation.z += anim.spinSpeedZ * (1 - p * 0.45);
        } else {
          // Settle into target quaternion with exponential ease
          const blendProgress = Math.min(1, (p - 0.72) / 0.28);
          dice.quaternion.slerp(targetQuat, blendProgress * 0.32);
        }

        if (p >= 1.0) {
          anim.active = false;
          setIsRolling(false);
          dice.quaternion.copy(targetQuat);
          dice.position.set(0, 0.82, 0);
          shadow.scale.set(1, 1, 1);
          (shadow.material as THREE.MeshBasicMaterial).opacity = 0.75;
        }
      }

      renderer.render(scene, camera);
    };

    renderLoop();

    // Resize handler
    const handleResize = () => {
      if (!mount || !renderer || !camera) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animReqRef.current) cancelAnimationFrame(animReqRef.current);
      if (mount && renderer.domElement) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Trigger Rolling Animation
  const startRollAnimation = useCallback((face: number) => {
    setIsRolling(true);
    playDiceRoll();

    if (rollSafetyTimerRef.current) {
      clearTimeout(rollSafetyTimerRef.current);
    }

    const anim = animStateRef.current;
    anim.active = true;
    anim.startTime = performance.now();
    anim.duration = 1000;
    anim.targetFace = face;
    anim.hasBounced1 = false;
    anim.hasBounced2 = false;
    anim.hasLanded = false;

    // Randomize initial angular momentum
    anim.spinSpeedX = (0.35 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1);
    anim.spinSpeedY = (0.4 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1);
    anim.spinSpeedZ = (0.25 + Math.random() * 0.2) * (Math.random() > 0.5 ? 1 : -1);

    // Guaranteed safety timeout to ensure dice never gets stuck rolling
    rollSafetyTimerRef.current = setTimeout(() => {
      setIsRolling(false);
      anim.active = false;
      if (diceMeshRef.current) {
        diceMeshRef.current.position.set(0, 0.82, 0);
        diceMeshRef.current.quaternion.setFromEuler(getTargetEulerForFace(face));
      }
      if (shadowMeshRef.current) {
        shadowMeshRef.current.scale.set(1, 1, 1);
        (shadowMeshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.75;
      }
    }, 1150);
  }, [playDiceRoll]);

  // Trigger animation when lastDiceEvent fires (even if consecutive identical numbers!)
  useEffect(() => {
    if (lastDiceEvent?.roll && diceMeshRef.current) {
      startRollAnimation(lastDiceEvent.roll);
    }
  }, [lastDiceEvent, startRollAnimation]);

  // Fallback trigger if rollValue changes
  useEffect(() => {
    if (rollValue && diceMeshRef.current && !animStateRef.current.active) {
      startRollAnimation(rollValue);
    }
  }, [rollValue, startRollAnimation]);

  // Keyboard Spacebar to Roll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && canRoll && isMyTurn && !isRolling) {
        // Prevent default spacebar scrolling
        e.preventDefault();
        onRoll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRoll, isMyTurn, isRolling, onRoll]);

  // Mobile Shake to Roll
  useEffect(() => {
    if (!canRoll || !isMyTurn) return;

    let lastX = 0, lastY = 0, lastZ = 0;
    let lastTime = 0;

    const handleMotion = (e: DeviceMotionEvent) => {
      const current = e.accelerationIncludingGravity;
      if (!current) return;
      const now = Date.now();
      if (now - lastTime > 160) {
        const diffTime = now - lastTime;
        lastTime = now;
        const speed = (Math.abs(current.x! + current.y! + current.z! - lastX - lastY - lastZ) / diffTime) * 10000;
        if (speed > 850 && !isRolling) {
          onRoll();
        }
        lastX = current.x || 0;
        lastY = current.y || 0;
        lastZ = current.z || 0;
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [canRoll, isMyTurn, isRolling, onRoll]);

  const handleTrigger = () => {
    if (canRoll && isMyTurn && !isRolling) {
      onRoll();
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      {/* Three.js 3D WebGL Tray */}
      <div
        className={`relative w-36 h-36 rounded-3xl p-2.5 flex items-center justify-center transition-all ${
          canRoll && isMyTurn ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'
        }`}
        style={{
          background: 'radial-gradient(circle at 50% 40%, #2e1d13 0%, #150d07 100%)',
          border: '2px solid rgba(223, 178, 86, 0.45)',
          boxShadow: canRoll && isMyTurn
            ? '0 0 28px rgba(223, 178, 86, 0.55), inset 0 2px 4px rgba(255, 230, 180, 0.4)'
            : '0 10px 25px rgba(0, 0, 0, 0.7), inset 0 2px 4px rgba(255, 255, 255, 0.1)'
        }}
        onClick={handleTrigger}
      >
        {/* Felt Tray Inset */}
        <div className="relative w-full h-full rounded-2xl bg-[#0e2417] border border-amber-500/20 shadow-inner flex items-center justify-center overflow-hidden">
          {hasWebGL ? (
            <div ref={mountRef} className="w-full h-full flex items-center justify-center" />
          ) : (
            /* Fallback for non-WebGL devices */
            <div className="w-16 h-16 rounded-xl bg-white text-slate-900 font-display font-black text-3xl flex items-center justify-center shadow-lg">
              {rollValue || 1}
            </div>
          )}

          {/* Floating Glow on Active Turn */}
          {canRoll && isMyTurn && !isRolling && (
            <div className="absolute inset-0 border-2 border-amber-400/50 rounded-2xl animate-pulse pointer-events-none" />
          )}
        </div>
      </div>

      {/* Turn Action Label */}
      <div className="text-center">
        {canRoll && isMyTurn ? (
          <span className="text-xs font-display font-bold text-amber-400 animate-pulse tracking-wide block">
            Tap Dice or Spacebar to Roll 🎲
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-slate-400 block">
            {isRolling ? 'Rolling in 3D…' : 'Waiting for turn…'}
          </span>
        )}
      </div>
    </div>
  );
};

