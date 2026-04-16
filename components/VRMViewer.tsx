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

const VRMViewer = forwardRef<VRMViewerHandle, VRMViewerProps>(
  function VRMViewer({ className }, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);
    const blendShapesRef = useRef<Record<string, number>>({});
    const mouthOpenRef = useRef(0);
    const errorRef = useRef<HTMLDivElement>(null);

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

      // --- Renderer ---
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // MToonマテリアル（目のハイライト等）を正しく描画するためのトーンマッピング設定
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);

      // --- Scene ---
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#1a1a2e');

      // --- Camera ---
      const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 20);
      camera.position.set(0, 0.9, 4.5);
      camera.lookAt(0, 0.9, 0);

      // --- Lights ---
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
      hemiLight.position.set(0, 10, 0);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
      dirLight.position.set(1, 3, 2);
      scene.add(dirLight);

      // --- Clock for animation ---
      const clock = new THREE.Clock();

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

          // MToonマテリアルのハイライトを初期から正しく表示するため強制更新
          vrm.scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of materials) {
                mat.needsUpdate = true;
              }
            }
          });
          // ロード直後に1フレーム描画してマテリアルを初期化
          renderer.render(scene, camera);

          // Expression一覧をコンソールに出力
          if (vrm.expressionManager) {
            const expressionNames = vrm.expressionManager.expressions.map(
              (e) => e.expressionName
            );
            console.log('[VRMViewer] Available expressions:', expressionNames);
          }

          // ロード直後のボーン初期回転値をコンソールに出力
          const debugBones = ['leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'] as const;
          console.log('=== ボーン初期回転値 (Raw) ===');
          for (const name of debugBones) {
            const bone = vrm.humanoid.getRawBoneNode(name);
            if (bone) {
              const r = bone.rotation;
              console.log(`${name}: x=${r.x.toFixed(3)} y=${r.y.toFixed(3)} z=${r.z.toFixed(3)}`);
            } else {
              console.log(`${name}: NOT FOUND`);
            }
          }

          if (errorRef.current) errorRef.current.style.display = 'none';
        },
        undefined,
        (error) => {
          console.error('[VRMViewer] Failed to load VRM:', error);
          if (errorRef.current) {
            errorRef.current.style.display = 'flex';
          }
        }
      );

      // まばたきタイミング管理
      let nextBlinkTime = 2 + Math.random() * 3;
      let blinkPhase: 'idle' | 'closing' | 'opening' = 'idle';
      let blinkTimer = 0;

      // --- Animation Loop ---
      let frameId: number;
      const animate = () => {
        frameId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();

        if (vrmRef.current) {
          const vrm = vrmRef.current;

          // まばたき
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

            // まず全てリセット
            const allExpressions = vrm.expressionManager.expressions;
            for (const expr of allExpressions) {
              vrm.expressionManager.setValue(expr.expressionName, 0);
            }

            // まばたき適用 (blink / blinkLeft+blinkRight)
            if (blinkValue > 0) {
              const blinkCandidates = ['blink', 'Blink'];
              let applied = false;
              for (const b of blinkCandidates) {
                try {
                  vrm.expressionManager.setValue(b, blinkValue);
                  applied = true;
                  break;
                } catch { /* なし */ }
              }
              if (!applied) {
                try { vrm.expressionManager.setValue('blinkLeft', blinkValue); } catch { /* なし */ }
                try { vrm.expressionManager.setValue('blinkRight', blinkValue); } catch { /* なし */ }
              }
            }

            // 感情 BlendShape 適用
            for (const [name, value] of Object.entries(blendShapesRef.current)) {
              try { vrm.expressionManager.setValue(name, value); } catch { /* なし */ }
            }

            // 口パク
            const mouthVal = mouthOpenRef.current;
            if (mouthVal > 0.01) {
              const mouthCandidates = ['aa', 'a', 'mouth_a', 'A'];
              for (const candidate of mouthCandidates) {
                try {
                  vrm.expressionManager.setValue(candidate, mouthVal);
                  break;
                } catch { /* なし */ }
              }
            }
          }

          vrm.update(delta);

          // vrm.update() の後にすべてのボーンアニメーションを適用
          if (vrm.humanoid) {
            const breathVal = Math.sin(elapsed * 1.5);

            // 呼吸 (spine)
            const spine = vrm.humanoid.getRawBoneNode('spine');
            if (spine) spine.rotation.x = breathVal * 0.015;

            // 呼吸 (chest)
            const chest = vrm.humanoid.getRawBoneNode('chest');
            if (chest) chest.rotation.x = breathVal * 0.01;

            // 頭の揺れ
            const head = vrm.humanoid.getRawBoneNode('head');
            if (head) {
              head.rotation.y = Math.sin(elapsed * 0.4) * 0.06;
              head.rotation.z = Math.sin(elapsed * 0.6) * 0.02;
            }

            // 上腕を下げる + 少し前に傾けて手がズボンにめり込まないようにする
            // 上腕: 少し脇を締めてA字 (0.38→0.43)
            const lRaw = vrm.humanoid.getRawBoneNode('leftUpperArm');
            if (lRaw) {
              lRaw.rotation.x = 0;
              lRaw.rotation.y = 0;
              lRaw.rotation.z = Math.PI * 0.42 + Math.sin(elapsed * 1.5 + 1) * 0.02;
            }
            const rRaw = vrm.humanoid.getRawBoneNode('rightUpperArm');
            if (rRaw) {
              rRaw.rotation.x = 0;
              rRaw.rotation.y = 0;
              rRaw.rotation.z = -(Math.PI * 0.42 + Math.sin(elapsed * 1.5) * 0.02);
            }

            // 前腕はリセット
            const lLower = vrm.humanoid.getRawBoneNode('leftLowerArm');
            if (lLower) { lLower.rotation.set(0, 0, 0); }
            const rLower = vrm.humanoid.getRawBoneNode('rightLowerArm');
            if (rLower) { rLower.rotation.set(0, 0, 0); }

            // 手のひらを自然に内側へ若干曲げる
            const lHand = vrm.humanoid.getRawBoneNode('leftHand');
            if (lHand) { lHand.rotation.set(0, 0, 0.2); }
            const rHand = vrm.humanoid.getRawBoneNode('rightHand');
            if (rHand) { rHand.rotation.set(0, 0, -0.2); }

            // 親指を閉じる
            const thumbBones = [
              'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
              'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
            ] as const;
            for (const name of thumbBones) {
              const bone = vrm.humanoid.getRawBoneNode(name);
              if (!bone) continue;
              if (name.startsWith('left')) {
                bone.rotation.set(0, 0.4, 0.05);
              } else {
                bone.rotation.set(0, -0.4, -0.05);
              }
            }
          }
        }

        renderer.render(scene, camera);
      };
      animate();

      // --- Resize handler ---
      const handleResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      // --- ドラッグで回転 ---
      let isDragging = false;
      let prevX = 0;
      let rotationY = Math.PI;

      const onMouseDown = (e: MouseEvent) => {
        isDragging = true;
        prevX = e.clientX;
      };
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
          style={{ display: 'none' }}
          className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a2e] text-white gap-4"
        >
          <p className="text-2xl">⚠️ VRMモデルが見つかりません</p>
          <p className="text-sm text-gray-400">
            <code className="bg-gray-800 px-2 py-1 rounded">
              public/models/zundamon.vrm
            </code>{' '}
            を配置してページをリロードしてください
          </p>
        </div>
      </div>
    );
  }
);

export default VRMViewer;
