"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GeometryResult, DimensionLine } from "@/lib/parametric-engine/types";

interface RoofViewerProps {
  geometry: GeometryResult;
  dimensions: DimensionLine[];
  /** Rough overall size (mm) used to frame the camera -- pass span/width. */
  boundingSize: number;
}

/**
 * Deliberately vanilla Three.js (not React Three Fiber) so it drops into
 * any Next.js app without an extra rendering-library dependency decision.
 * Colors pulled from styles/globals.css (--ink, --teal, --amber) instead of
 * the engine's original generic brown/red defaults.
 */
export function RoofViewer({ geometry, dimensions, boundingSize }: RoofViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfafaf8); // --bg

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, boundingSize * 10);
    const dist = boundingSize * 1.4;
    camera.position.set(dist, dist * 0.7, dist);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(boundingSize, boundingSize * 1.5, boundingSize);
    scene.add(sun);

    const bufferGeom = new THREE.BufferGeometry();
    bufferGeom.setAttribute("position", new THREE.Float32BufferAttribute(geometry.vertices, 3));
    bufferGeom.setIndex(geometry.indices);
    bufferGeom.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ color: 0xc9d3cd, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(bufferGeom, material);
    scene.add(mesh);

    const wireframe = new THREE.LineSegments(
      new THREE.WireframeGeometry(bufferGeom),
      new THREE.LineBasicMaterial({ color: 0x1c2430 }) // --ink
    );
    scene.add(wireframe);

    const dimGroup = new THREE.Group();
    for (const dim of dimensions) {
      const points = [
        new THREE.Vector3(dim.start.x, dim.start.y, dim.start.z),
        new THREE.Vector3(dim.end.x, dim.end.y, dim.end.z),
      ];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0xd98e2b })); // --amber
      dimGroup.add(line);
    }
    scene.add(dimGroup);

    const grid = new THREE.GridHelper(boundingSize * 2, 10, 0xe4e6e1, 0xeef0ec); // --line tones
    scene.add(grid);

    // Mouse-drag orbit instead of auto-rotation: drag to rotate, scroll to
    // zoom, right-drag to pan. Damping makes releases feel like they have
    // a little weight instead of stopping dead.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, boundingSize * 0.15, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = boundingSize * 0.3;
    controls.maxDistance = boundingSize * 4;
    controls.update();

    let frameId: number;
    const animate = () => {
      controls.update(); // required every frame when damping is enabled
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      bufferGeom.dispose();
      material.dispose();
      container.innerHTML = "";
    };
  }, [geometry, dimensions, boundingSize]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
