'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export interface VRMViewerHandle {
  setBlendShapes: (shapes: Record<string, number>) => void;
  setMouthOpen: (value: number) => void;
}

interface VRMViewerProps {
  className?: string;
}

/* ── クロマキー合成用シェーダー ─────────────────────────────
 *  レンダーターゲットに描画した結果のうち、クロマキー色（マゼンタ）の
 *  ピクセルを透明にし、それ以外（=VRMモデル）を不透明で出力する。
 *  これにより、MToonのアルファに関係なくモデルは完全不透明に描画され、
 *  背景部分だけCSSエフェクトが透過して見える。
 * ─────────────────────────────────────────────────────── */
const CHROMA_KEY_VS = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const CHROMA_KEY_FS = `
  uniform sampler2D tDiffuse;
  uniform vec3 chromaKey;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float diff = distance(texel.rgb, chromaKey);
    // クロマキー色に近い → 透明、それ以外 → 不透明
    float alpha = smoothstep(0.08, 0.25, diff);
    // パステル調: 彩度を少し抑える
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    vec3 pastel = mix(texel.rgb, vec3(luma), 0.30);
    gl_FragColor = vec4(pastel, alpha);
  }
`;

const CHROMA_COLOR = new THREE.Color('#FF00FF');

const VRMViewer = forwardRef<VRMViewerHandle, VRMViewerProps>(
  function VRMViewer({ className }, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);
    const blendShapesRef = useRef<Record<string, number>>({});
    const mouthOpenRef = useRef(0);

    useImperativeHandle(ref, () => ({
      setBlendShapes(shapes: Record<string, number>) {
        blendShapesRef.current = shapes;
      },
      setMouthOpen(value: number) {
        mouthOpenRef.current = value;
      },
    }));

    useEffect(() => {
      if (!mountRef.current) return;

      const container = mountRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      const pixelRatio = window.devicePixelRatio;

      // --- Renderer (透明キャンバス — 最終出力はクロマキーで透過制御) ---
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(pixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.autoClear = true;
      container.appendChild(renderer.domElement);

      // --- レンダーターゲット (VRMをクロマキー背景に不透明描画) ---
      const rtW = Math.floor(width * pixelRatio);
      const rtH = Math.floor(height * pixelRatio);
      const renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      // --- VRM シーン (クロマキー背景) ---
      const scene = new THREE.Scene();
      scene.background = CHROMA_COLOR;

      // --- クロマキー合成シーン ---
      const quadMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: renderTarget.texture },
          chromaKey: { value: CHROMA_COLOR },
        },
        vertexShader: CHROMA_KEY_VS,
        fragmentShader: CHROMA_KEY_FS,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial);
      const quadScene = new THREE.Scene();
      quadScene.add(quadMesh);
      const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      // --- Camera ---
      const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 20);
      camera.position.set(0, 0.9, 4.5);
      camera.lookAt(0, 0.9, 0);

      // --- Lights ---
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.3);
      hemiLight.position.set(0, 10, 0);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
      dirLight.position.set(1, 3, 2);
      scene.add(dirLight);

      // --- Load VRM ---
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      loader.load(
        '/models/zundamon.vrm',
        (gltf) => {
          const vrm: VRM = gltf.userData.vrm;
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);

          vrm.scene.rotation.y = Math.PI;
          scene.add(vrm.scene);
          vrmRef.current = vrm;

          // MToon マテリアルの更新フラグ
          vrm.scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of mats) mat.needsUpdate = true;
            }
          });

          errorRef.current?.classList.add('hidden');
        },
        undefined,
        (error) => {
          console.error('[VRMViewer] VRM load failed:', error);
          errorRef.current?.classList.remove('hidden');
        }
      );

      // --- まばたき状態 ---
      let nextBlinkTime = 2 + Math.random() * 3;
      let blinkPhase: 'idle' | 'closing' | 'opening' = 'idle';
      let blinkTimer = 0;

      // --- アニメーションループ ---
      let lastTime = performance.now();
      let elapsed = 0;
      let frameId: number;

      const animate = () => {
        frameId = requestAnimationFrame(animate);

        const now = performance.now();
        const delta = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        elapsed += delta;

        const vrm = vrmRef.current;
        if (vrm) {
          // --- まばたき ---
          if (vrm.expressionManager) {
            nextBlinkTime -= delta;
            if (blinkPhase === 'idle' && nextBlinkTime <= 0) {
              blinkPhase = 'closing';
              blinkTimer = 0;
            }

            let blinkValue = 0;
            if (blinkPhase === 'closing') {
              blinkTimer += delta;
              blinkValue = Math.min(blinkTimer / 0.08, 1);
              if (blinkTimer >= 0.08) { blinkPhase = 'opening'; blinkTimer = 0; }
            } else if (blinkPhase === 'opening') {
              blinkTimer += delta;
              blinkValue = Math.max(1 - blinkTimer / 0.1, 0);
              if (blinkTimer >= 0.1) {
                blinkPhase = 'idle';
                blinkValue = 0;
                nextBlinkTime = 2 + Math.random() * 4;
              }
            }

            // 全表情をリセット
            for (const expr of vrm.expressionManager.expressions) {
              vrm.expressionManager.setValue(expr.expressionName, 0);
            }

            // まばたき
            if (blinkValue > 0) {
              let applied = false;
              for (const name of ['blink', 'Blink']) {
                try { vrm.expressionManager.setValue(name, blinkValue); applied = true; break; }
                catch { /* 存在しない */ }
              }
              if (!applied) {
                try { vrm.expressionManager.setValue('blinkLeft', blinkValue); } catch { /* */ }
                try { vrm.expressionManager.setValue('blinkRight', blinkValue); } catch { /* */ }
              }
            }

            // 感情 BlendShape
            for (const [name, value] of Object.entries(blendShapesRef.current)) {
              try { vrm.expressionManager.setValue(name, value); } catch { /* */ }
            }

            // 口パク
            const mouthVal = mouthOpenRef.current;
            if (mouthVal > 0.01) {
              for (const name of ['aa', 'a', 'mouth_a', 'A']) {
                try { vrm.expressionManager.setValue(name, mouthVal); break; }
                catch { /* */ }
              }
            }
          }

          vrm.update(delta);

          // --- ボーンアニメーション ---
          if (vrm.humanoid) {
            const breathVal = Math.sin(elapsed * 1.5);

            vrm.humanoid.getRawBoneNode('spine')?.rotation.set(breathVal * 0.015, 0, 0);
            vrm.humanoid.getRawBoneNode('chest')?.rotation.set(breathVal * 0.01, 0, 0);

            const head = vrm.humanoid.getRawBoneNode('head');
            if (head) {
              head.rotation.y = Math.sin(elapsed * 0.4) * 0.06;
              head.rotation.z = Math.sin(elapsed * 0.6) * 0.02;
            }

            const lArm = vrm.humanoid.getRawBoneNode('leftUpperArm');
            if (lArm) lArm.rotation.set(0, 0, Math.PI * 0.42 + Math.sin(elapsed * 1.5 + 1) * 0.02);

            const rArm = vrm.humanoid.getRawBoneNode('rightUpperArm');
            if (rArm) rArm.rotation.set(0, 0, -(Math.PI * 0.42 + Math.sin(elapsed * 1.5) * 0.02));

            vrm.humanoid.getRawBoneNode('leftLowerArm')?.rotation.set(0, 0, 0);
            vrm.humanoid.getRawBoneNode('rightLowerArm')?.rotation.set(0, 0, 0);
            vrm.humanoid.getRawBoneNode('leftHand')?.rotation.set(0, 0, 0.2);
            vrm.humanoid.getRawBoneNode('rightHand')?.rotation.set(0, 0, -0.2);

            for (const name of [
              'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
              'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
            ] as const) {
              const bone = vrm.humanoid.getRawBoneNode(name);
              if (bone) bone.rotation.set(0, name.startsWith('left') ? 0.4 : -0.4, name.startsWith('left') ? 0.05 : -0.05);
            }
          }
        }

        // Pass 1: VRMシーンをレンダーターゲットに描画（クロマキー背景で不透明）
        renderer.setRenderTarget(renderTarget);
        renderer.setClearColor(CHROMA_COLOR, 1);
        renderer.clear();
        renderer.render(scene, camera);

        // Pass 2: クロマキー合成してメインキャンバスに出力（モデル=不透明、背景=透明）
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(quadScene, quadCamera);
      };
      animate();

      // --- Resize ---
      const handleResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        const newRtW = Math.floor(w * pixelRatio);
        const newRtH = Math.floor(h * pixelRatio);
        renderTarget.setSize(newRtW, newRtH);
      };
      window.addEventListener('resize', handleResize);

      // --- ドラッグで回転 ---
      let isDragging = false;
      let prevX = 0;
      let rotationY = Math.PI;

      const onMouseDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; };
      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging || !vrmRef.current) return;
        rotationY += (e.clientX - prevX) * 0.01;
        prevX = e.clientX;
        vrmRef.current.scene.rotation.y = rotationY;
      };
      const onMouseUp = () => { isDragging = false; };

      renderer.domElement.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      return () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', handleResize);
        renderer.domElement.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        renderTarget.dispose();
        quadMaterial.dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    }, []);

    return (
      <div className={`relative w-full h-full ${className ?? ''}`}>
        <div ref={mountRef} className="w-full h-full" />
        <div
          ref={errorRef}
          className="hidden absolute inset-0 flex flex-col items-center justify-center bg-background text-foreground gap-4"
        >
          <p className="text-xl font-bold">VRMモデルが見つかりません</p>
          <p className="text-sm text-muted-foreground">
            <code className="bg-muted px-2 py-1 rounded text-xs">
              public/models/zundamon.vrm
            </code>{' '}
            を配置してリロードしてください
          </p>
        </div>
      </div>
    );
  }
);

export default VRMViewer;
