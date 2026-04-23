'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export interface VRMViewerHandle {
  setBlendShapes: (shapes: Record<string, number>) => void;
  setMouthOpen: (value: number) => void;
  setListening: (value: boolean) => void;
}

interface VRMViewerProps {
  className?: string;
  modelPath?: string;
  initialRotationY?: number;
  animationPreset?: 'spin20' | 'jump15';
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

function applyInitialPose(vrm: VRM) {
  if (!vrm.humanoid) return;
  const lArm = vrm.humanoid.getRawBoneNode('leftUpperArm');
  if (lArm) lArm.rotation.set(0, 0, Math.PI * 0.42);
  const rArm = vrm.humanoid.getRawBoneNode('rightUpperArm');
  if (rArm) rArm.rotation.set(0, 0, -Math.PI * 0.42);
  vrm.humanoid.getRawBoneNode('leftLowerArm')?.rotation.set(0, 0, 0);
  vrm.humanoid.getRawBoneNode('rightLowerArm')?.rotation.set(0, 0, 0);
  vrm.humanoid.getRawBoneNode('leftHand')?.rotation.set(0, 0, 0.2);
  vrm.humanoid.getRawBoneNode('rightHand')?.rotation.set(0, 0, -0.2);
}

const VRMViewer = forwardRef<VRMViewerHandle, VRMViewerProps>(
  function VRMViewer({ className, modelPath = '/models/zundamon.vrm', initialRotationY = Math.PI, animationPreset }, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);
    const blendShapesRef = useRef<Record<string, number>>({});
    const mouthOpenRef = useRef(0);

    // Three.js インフラを後から参照するためのref群
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const renderTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const quadSceneRef = useRef<THREE.Scene | null>(null);
    const quadCameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const readyRef = useRef(false);
    const isListeningRef = useRef(false);
    const stabilizeFramesRef = useRef(0); // 0 = 安定化完了, >0 = 残りフレーム数
    const initialRotationYRef = useRef(initialRotationY);
    useEffect(() => { initialRotationYRef.current = initialRotationY; }, [initialRotationY]);
    // ドラッグと spin が共有する現在のY回転値
    const rotationYRef = useRef(initialRotationY);
    // spin 用
    const spinTimerRef   = useRef(0);
    const spinActiveRef  = useRef(false);
    const spinProgressRef = useRef(0);
    const spinStartRotRef = useRef(0);
    // jump15 用
    const jumpTimerRef    = useRef(0);
    const jumpActiveRef   = useRef(false);
    const jumpProgressRef = useRef(0);
    // 口パク用の"生"モーフターゲット参照 (expression経由だと目にも干渉するため直接操作する)
    const mouthMorphsRef = useRef<Array<{ influences: number[]; index: number }>>([]);
    const mouthFallbackExprRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      setBlendShapes(shapes: Record<string, number>) {
        blendShapesRef.current = shapes;
      },
      setMouthOpen(value: number) {
        mouthOpenRef.current = value;
      },
      setListening(value: boolean) {
        isListeningRef.current = value;
      },
    }));

    // ── Three.js インフラのセットアップ（一度だけ） ──────────────────
    useEffect(() => {
      if (!mountRef.current) return;

      const container = mountRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      const pixelRatio = window.devicePixelRatio;

      // Renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(pixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.autoClear = true;
      renderer.domElement.style.opacity = '0';
      renderer.domElement.style.transition = 'opacity 0.3s ease-in';
      container.appendChild(renderer.domElement);

      // レンダーターゲット
      const rtW = Math.floor(width * pixelRatio);
      const rtH = Math.floor(height * pixelRatio);
      const renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      // VRM シーン
      const scene = new THREE.Scene();
      scene.background = CHROMA_COLOR;

      // クロマキー合成シーン
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

      // Camera
      const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 20);
      camera.position.set(0, 0.9, 4.5);
      camera.lookAt(0, 0.9, 0);

      // Lights
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.3);
      hemiLight.position.set(0, 10, 0);
      scene.add(hemiLight);
      const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
      dirLight.position.set(1, 3, 2);
      scene.add(dirLight);

      // refs に保存
      sceneRef.current = scene;
      rendererRef.current = renderer;
      renderTargetRef.current = renderTarget;
      cameraRef.current = camera;
      quadSceneRef.current = quadScene;
      quadCameraRef.current = quadCamera;
      readyRef.current = true;

      // まばたき状態
      let nextBlinkTime = 2 + Math.random() * 3;
      let blinkPhase: 'idle' | 'closing' | 'opening' = 'idle';
      let blinkTimer = 0;

      // アニメーションループ
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

            for (const expr of vrm.expressionManager.expressions) {
              vrm.expressionManager.setValue(expr.expressionName, 0);
            }

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

            for (const [name, value] of Object.entries(blendShapesRef.current)) {
              try { vrm.expressionManager.setValue(name, value); } catch { /* */ }
            }
          }

          // 口パク (vrm.update 前にフォールバック expression を設定)
          const mouthVal = mouthOpenRef.current;
          if (mouthVal > 0.01 && mouthMorphsRef.current.length === 0 && mouthFallbackExprRef.current) {
            try { vrm.expressionManager?.setValue(mouthFallbackExprRef.current, mouthVal); } catch { /* */ }
          }

          vrm.update(delta);

          // 口パク (直接モーフがあるモデル): expressionManager 後に上書きして目への
          // 干渉を防ぐ。'aa' 等のコンパウンド表情に目成分が含まれるモデル対策。
          if (mouthVal > 0.01 && mouthMorphsRef.current.length > 0) {
            for (const { influences, index } of mouthMorphsRef.current) {
              influences[index] = mouthVal;
            }
          }

          if (vrm.humanoid) {
            const breathVal = Math.sin(elapsed * 1.5);
            vrm.humanoid.getRawBoneNode('spine')?.rotation.set(breathVal * 0.015, 0, 0);
            vrm.humanoid.getRawBoneNode('chest')?.rotation.set(breathVal * 0.01, 0, 0);

            const head = vrm.humanoid.getRawBoneNode('head');
            if (head) {
              if (isListeningRef.current) {
                // 頷き: 約2秒に1回、前傾してゆっくり戻る
                const nodPhase = (elapsed * 0.5) % 1;
                head.rotation.x = Math.pow(Math.max(0, Math.sin(nodPhase * Math.PI)), 3) * 0.18;
                head.rotation.y = Math.sin(elapsed * 0.3) * 0.03;
                head.rotation.z = Math.sin(elapsed * 0.5) * 0.01;
              } else {
                head.rotation.x = 0;
                head.rotation.y = Math.sin(elapsed * 0.4) * 0.06;
                head.rotation.z = Math.sin(elapsed * 0.6) * 0.02;
              }
            }

            // ── spin20: 20秒周期で片足一回転 ──────────────────────────
            if (animationPreset === 'spin20') {
              const SPIN_DURATION = 1.8;
              if (!spinActiveRef.current) {
                spinTimerRef.current += delta;
                if (spinTimerRef.current >= 20) {
                  spinTimerRef.current = 0;
                  spinActiveRef.current = true;
                  spinProgressRef.current = 0;
                  spinStartRotRef.current = vrm.scene.rotation.y;
                }
              }
              if (spinActiveRef.current) {
                spinProgressRef.current += delta / SPIN_DURATION;
                if (spinProgressRef.current >= 1) {
                  spinProgressRef.current = 1;
                  spinActiveRef.current = false;
                  vrm.scene.rotation.y = spinStartRotRef.current;
                  rotationYRef.current = spinStartRotRef.current;
                } else {
                  const t = spinProgressRef.current;
                  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                  vrm.scene.rotation.y = spinStartRotRef.current + ease * Math.PI * 2;
                  // 右足を膝上まで持ち上げる
                  const legLift = Math.sin(t * Math.PI);
                  vrm.humanoid?.getRawBoneNode('rightUpperLeg')
                    ?.rotation.set(legLift * 0.9, 0, 0);   // 正→膝が前に上がる
                  vrm.humanoid?.getRawBoneNode('rightLowerLeg')
                    ?.rotation.set(-legLift * 1.0, 0, 0);  // 負→ひざ折りかかとが後ろへ
                  vrm.humanoid?.getRawBoneNode('rightFoot')
                    ?.rotation.set(legLift * 0.3, 0, 0);
                }
              }
            }

            const lArm = vrm.humanoid.getRawBoneNode('leftUpperArm');
            if (lArm) lArm.rotation.set(0, 0, Math.PI * 0.42 + Math.sin(elapsed * 1.5 + 1) * 0.02);
            const rArm = vrm.humanoid.getRawBoneNode('rightUpperArm');
            if (rArm) rArm.rotation.set(0, 0, -(Math.PI * 0.42 + Math.sin(elapsed * 1.5) * 0.02));

            vrm.humanoid.getRawBoneNode('leftLowerArm')?.rotation.set(0, 0, 0);
            vrm.humanoid.getRawBoneNode('rightLowerArm')?.rotation.set(0, 0, 0);
            vrm.humanoid.getRawBoneNode('leftHand')?.rotation.set(0, 0, 0.2);
            vrm.humanoid.getRawBoneNode('rightHand')?.rotation.set(0, 0, -0.2);

            // ── jump15: 15秒周期で両手広げジャンプ ──────────────────────
            if (animationPreset === 'jump15') {
              const JUMP_DURATION = 1.0;
              if (!jumpActiveRef.current) {
                jumpTimerRef.current += delta;
                if (jumpTimerRef.current >= 15) {
                  jumpTimerRef.current = 0;
                  jumpActiveRef.current = true;
                  jumpProgressRef.current = 0;
                }
              }
              if (jumpActiveRef.current) {
                jumpProgressRef.current += delta / JUMP_DURATION;
                if (jumpProgressRef.current >= 1) {
                  jumpProgressRef.current = 1;
                  jumpActiveRef.current = false;
                  vrm.scene.position.y = 0;
                } else {
                  const t = jumpProgressRef.current;
                  // ジャンプ軌跡: sin カーブで上昇→着地
                  const jumpY = Math.sin(t * Math.PI) * 0.35;
                  vrm.scene.position.y = jumpY;
                  // 両腕を外側に広げる (z を減らすと外に開く)
                  const spread = Math.sin(t * Math.PI);
                  const armZ = Math.PI * 0.42 - spread * (Math.PI * 0.30);
                  lArm?.rotation.set(0, 0,  armZ);
                  rArm?.rotation.set(0, 0, -armZ);
                  // 前腕も外側へ
                  vrm.humanoid.getRawBoneNode('leftLowerArm')?.rotation.set(0, 0, -spread * 0.15);
                  vrm.humanoid.getRawBoneNode('rightLowerArm')?.rotation.set(0, 0,  spread * 0.15);
                }
              }
            }

            for (const name of [
              'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
              'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
            ] as const) {
              const bone = vrm.humanoid.getRawBoneNode(name);
              if (bone) bone.rotation.set(0, name.startsWith('left') ? 0.4 : -0.4, name.startsWith('left') ? 0.05 : -0.05);
            }
          }
        }

        renderer.setRenderTarget(renderTarget);
        renderer.setClearColor(CHROMA_COLOR, 1);
        renderer.clear();
        renderer.render(scene, camera);

        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(quadScene, quadCamera);

        if (stabilizeFramesRef.current > 0) {
          stabilizeFramesRef.current--;
          if (stabilizeFramesRef.current === 0) {
            renderer.domElement.style.opacity = '1';
          }
        }
      };
      animate();

      // Resize
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

      // ドラッグで回転
      let isDragging = false;
      let prevX = 0;

      const onMouseDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; };
      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging || !vrmRef.current) return;
        rotationYRef.current += (e.clientX - prevX) * 0.01;
        prevX = e.clientX;
        vrmRef.current.scene.rotation.y = rotationYRef.current;
      };
      const onMouseUp = () => { isDragging = false; };

      renderer.domElement.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      return () => {
        readyRef.current = false;
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
        sceneRef.current = null;
        rendererRef.current = null;
        renderTargetRef.current = null;
        cameraRef.current = null;
        quadSceneRef.current = null;
        quadCameraRef.current = null;
      };
    }, []);

    // ── モデルの読み込み（modelPath が変わるたびに実行） ─────────────
    useEffect(() => {
      // インフラが未初期化の場合は少し待つ（初回は useEffect の順序で問題ない）
      const load = () => {
        const scene = sceneRef.current;
        const renderer = rendererRef.current;
        const renderTarget = renderTargetRef.current;
        const camera = cameraRef.current;
        const quadScene = quadSceneRef.current;
        const quadCamera = quadCameraRef.current;
        if (!scene || !renderer || !renderTarget || !camera || !quadScene || !quadCamera) return;

        // 既存モデルをフェードアウトして削除
        stabilizeFramesRef.current = 0;
        renderer.domElement.style.opacity = '0';
        if (vrmRef.current) {
          scene.remove(vrmRef.current.scene);
          vrmRef.current = null;
        }
        mouthMorphsRef.current = [];
        mouthFallbackExprRef.current = null;

        errorRef.current?.classList.add('hidden');

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        loader.load(
          modelPath,
          (gltf) => {
            const vrm: VRM = gltf.userData.vrm;
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.combineSkeletons(gltf.scene);

            vrm.scene.rotation.y = initialRotationYRef.current;
            rotationYRef.current = initialRotationYRef.current;
            scene.add(vrm.scene);
            vrmRef.current = vrm;

            // 口モーフターゲットを収集 (目に干渉しない口単体のモーフだけ選ぶ)
            const mouthMorphs: Array<{ influences: number[]; index: number }> = [];
            const MOUTH_RE = /(^|[_\-\s])(a|aa|ah|A|Fcl_MTH_A|mouth[_\-]?a|vrc\.v_aa|jaw[_\-]?open|あ)($|[_\-\s])/i;
            const EYE_RE = /(eye|eyelid|blink|lid|brow|eyebrow|まぶた|目)/i;

            vrm.scene.traverse((obj) => {
              const mesh = obj as THREE.Mesh;
              if ((mesh as THREE.Mesh).isMesh) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const mat of mats) mat.needsUpdate = true;
              }

              const dict = mesh.morphTargetDictionary;
              const infl = mesh.morphTargetInfluences;
              if (!dict || !infl) return;

              for (const [name, idx] of Object.entries(dict)) {
                if (EYE_RE.test(name)) continue;
                if (MOUTH_RE.test(name) || /^(a|A|あ)$/.test(name)) {
                  mouthMorphs.push({ influences: infl, index: idx });
                }
              }
            });
            mouthMorphsRef.current = mouthMorphs;

            // 直接モーフが無い場合は expression の mouth 系を探してフォールバック指定
            if (mouthMorphs.length === 0 && vrm.expressionManager) {
              const exprNames = vrm.expressionManager.expressions.map((e) => e.expressionName);
              const candidate = ['aa', 'a', 'A', 'oh', 'ou', 'ih', 'ee'].find((n) => exprNames.includes(n));
              mouthFallbackExprRef.current = candidate ?? null;
            }

            applyInitialPose(vrm);

            // Spring bone が落ち着くまで animate ループ内で N フレーム待ってからフェードイン
            // (別の rAF ループを立てると vrm.update が1フレームに2回走り姿勢が崩れるため)
            stabilizeFramesRef.current = 12;

            errorRef.current?.classList.add('hidden');
          },
          undefined,
          (error) => {
            console.error('[VRMViewer] VRM load failed:', error);
            errorRef.current?.classList.remove('hidden');
          }
        );
      };

      if (readyRef.current) {
        load();
      } else {
        // インフラ初期化を待つ（通常は同一フレーム内で完了）
        const timer = setTimeout(load, 0);
        return () => clearTimeout(timer);
      }
    }, [modelPath]);

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
              {modelPath}
            </code>{' '}
            を配置してリロードしてください
          </p>
        </div>
      </div>
    );
  }
);

export default VRMViewer;
