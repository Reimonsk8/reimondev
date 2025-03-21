import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const CoolAnimation = () => {
    const mountRef = useRef(null);

    useEffect(() => {
        if (!mountRef.current) return;

        // Scene setup
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth/2, window.innerHeight/2);

        // Append renderer to the div container
        mountRef.current.appendChild(renderer.domElement);

        // Geometry setup
        const geometries = [
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.SphereGeometry(0.75, 16, 16),
            new THREE.TorusGeometry(0.6, 0.2, 16, 100),
            new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
        ];

        let currentGeometryIndex = 0;
        let nextGeometryIndex = 1;
        let morphProgress = 0;
        const wireframeMaterial = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffffff });

        const mesh = new THREE.Mesh(geometries[currentGeometryIndex], wireframeMaterial);
        scene.add(mesh);

        // Camera position
        camera.position.z = 2;

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);

        // Animation loop
        const animate = () => {
            requestAnimationFrame(animate);

            // Rotate object
            mesh.rotation.x += 0.01;
            mesh.rotation.y += 0.01;

            // Morphing logic
            if (morphProgress < 1) {
                morphProgress += 0.01;
                let newGeometry = geometries[nextGeometryIndex];
                let oldGeometry = geometries[currentGeometryIndex];

                for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
                    let oldPos = oldGeometry.attributes.position.array;
                    let newPos = newGeometry.attributes.position.array;

                    if (newPos && oldPos) {
                        let index = i * 3;
                        mesh.geometry.attributes.position.array[index] =
                            oldPos[index] * (1 - morphProgress) + newPos[index] * morphProgress;
                        mesh.geometry.attributes.position.array[index + 1] =
                            oldPos[index + 1] * (1 - morphProgress) + newPos[index + 1] * morphProgress;
                        mesh.geometry.attributes.position.array[index + 2] =
                            oldPos[index + 2] * (1 - morphProgress) + newPos[index + 2] * morphProgress;
                    }
                }
                mesh.geometry.attributes.position.needsUpdate = true;
            } else {
                // Switch to the next geometry
                morphProgress = 0;
                currentGeometryIndex = nextGeometryIndex;
                nextGeometryIndex = (nextGeometryIndex + 1) % geometries.length;
                mesh.geometry = geometries[currentGeometryIndex];
            }

            controls.update();
            renderer.render(scene, camera);
        };

        animate();

        // Handle window resize
        const handleResize = () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        };

        window.addEventListener('resize', handleResize);

        // Cleanup function
        return () => {
            window.removeEventListener('resize', handleResize);
            controls.dispose();
            renderer.dispose();
            if (mountRef.current) {
                mountRef.current.removeChild(renderer.domElement);
            }
        };
    }, []);

    return (
        <div className='CoolAnimation'>
            <h1>Cool Animation</h1>
            <p>Check out this cool animation!</p>
            <div ref={mountRef} className="animation-container" />
        </div>
    );
};

export default CoolAnimation;
