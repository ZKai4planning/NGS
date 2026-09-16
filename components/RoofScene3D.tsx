"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import { RoofDimensions, computeCrossSection } from "@/lib/roofGeometry";

interface WindowMarker {
  label: string;
  elevation: "north" | "south" | "east" | "west";
  offsetAlongWall: number; // meters from the left edge of that wall
}

function GableRoofMesh({ dims }: { dims: RoofDimensions }) {
  const { rise } = computeCrossSection(dims);
  const halfSpan = dims.spanM / 2;
  const depth = dims.ridgeLengthM;

  // Two sloped rectangular planes meeting at the ridge, plus two gable-end
  // triangles. Built as a single BufferGeometry so it's one draw call.
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();

    // prettier-ignore
    const vertices = new Float32Array([
      // left slope
      -halfSpan, 0, -depth / 2,   0, rise, -depth / 2,   0, rise, depth / 2,
      -halfSpan, 0, -depth / 2,   0, rise, depth / 2,    -halfSpan, 0, depth / 2,
      // right slope
      halfSpan, 0, -depth / 2,    halfSpan, 0, depth / 2,   0, rise, depth / 2,
      halfSpan, 0, -depth / 2,    0, rise, depth / 2,       0, rise, -depth / 2,
      // gable end triangles (front and back)
      -halfSpan, 0, -depth / 2,   halfSpan, 0, -depth / 2,  0, rise, -depth / 2,
      -halfSpan, 0, depth / 2,    0, rise, depth / 2,       halfSpan, 0, depth / 2,
    ]);

    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }, [halfSpan, rise, depth]);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#c9d3cd" side={THREE.DoubleSide} />
      </mesh>
      {/* ridge line for clarity */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, rise, -depth / 2, 0, rise, depth / 2])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#0f7173" linewidth={2} />
      </line>
    </group>
  );
}

/**
 * Simple wall-plane placeholder with a window cutout marker, so fitters can
 * see roughly where windows sit relative to the roof. Full wall/opening
 * geometry is out of scope for this pass - this is a positioning aid.
 */
function WindowMarkers({ dims, windows }: { dims: RoofDimensions; windows: WindowMarker[] }) {
  const { rise } = computeCrossSection(dims);
  const eaveHeight = 2.4; // assumed wall height under the eave, meters

  return (
    <>
      {windows.map((w, i) => {
        const wallIsFrontBack = w.elevation === "north" || w.elevation === "south";
        const x = wallIsFrontBack ? -dims.spanM / 2 + w.offsetAlongWall : -dims.spanM / 2;
        const z = wallIsFrontBack
          ? (w.elevation === "north" ? -1 : 1) * (dims.ridgeLengthM / 2)
          : -dims.ridgeLengthM / 2 + w.offsetAlongWall;

        return (
          <mesh key={i} position={[x, eaveHeight / 2, z]}>
            <boxGeometry args={[0.9, 1.1, 0.05]} />
            <meshStandardMaterial color="#d98e2b" />
          </mesh>
        );
      })}
    </>
  );
}

export default function RoofScene3D({
  dims,
  windows = [],
}: {
  dims: RoofDimensions;
  windows?: WindowMarker[];
}) {
  return (
    <Canvas camera={{ position: [dims.spanM * 1.4, dims.spanM, dims.ridgeLengthM * 1.2], fov: 40 }} shadows>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 8]} intensity={1.1} castShadow />
      <Grid args={[40, 40]} cellColor="#e4e6e1" sectionColor="#c7cbc4" position={[0, 0, 0]} />
      <GableRoofMesh dims={dims} />
      <WindowMarkers dims={dims} windows={windows} />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
