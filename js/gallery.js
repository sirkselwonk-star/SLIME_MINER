// gallery.js — SLIME.GALLERY NFT artwork on maze walls (sprite atlas version)

import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// Module-level state — persists across level restarts
let atlasTextures = null;   // Array of THREE.Texture (one per art atlas sheet)
let plateTexture = null;    // Single THREE.Texture for nameplate atlas
let manifest = null;        // { tileSize, gridSize, atlasCount, plate, tiles }
let ktx2Supported = null;   // null = untested, true/false after first load

// Shared geometry/material — created once
let sharedFrameGeo, sharedArtGeo, sharedPlateGeo, sharedFrameMat;

function ensureSharedResources(THREE) {
    if (!sharedFrameGeo) {
        sharedFrameGeo = new THREE.PlaneGeometry(1.6, 1.6);
        sharedArtGeo = new THREE.PlaneGeometry(1.4, 1.4);
        sharedPlateGeo = new THREE.PlaneGeometry(0.9, 0.14);
        sharedFrameMat = new THREE.MeshStandardMaterial({
            color: 0x1a1008, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide
        });
    }
}

/**
 * Load a texture, trying KTX2 first with JPEG/PNG fallback.
 */
function loadTexture(path, THREE, renderer) {
    const ktx2Path = path.replace(/\.(jpg|png)$/, '.ktx2');

    if (ktx2Supported === false) {
        return loadWithTextureLoader(path, THREE);
    }

    const ktx2Loader = new KTX2Loader()
        .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.164.0/examples/jsm/libs/basis/')
        .detectSupport(renderer);

    return new Promise((resolve) => {
        ktx2Loader.load(
            ktx2Path,
            (tex) => {
                ktx2Supported = true;
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.generateMipmaps = false;
                ktx2Loader.dispose();
                resolve(tex);
            },
            undefined,
            () => {
                // KTX2 failed — fall back to JPEG/PNG
                ktx2Supported = false;
                ktx2Loader.dispose();
                loadWithTextureLoader(path, THREE).then(resolve);
            }
        );
    });
}

function loadWithTextureLoader(path, THREE) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            path,
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearFilter;
                tex.generateMipmaps = false;
                resolve(tex);
            },
            undefined,
            reject
        );
    });
}

/**
 * Load atlas textures and manifest. Caches across level restarts.
 */
function loadAtlasAssets(THREE, renderer, onProgress) {
    if (atlasTextures && plateTexture && manifest) {
        const total = (atlasTextures.length || 2) + 2;
        if (onProgress) onProgress(total, total);
        return Promise.resolve();
    }

    // First load manifest to know how many art atlases exist
    return fetch('assets/atlas_manifest.json')
        .then(r => r.json())
        .then(manifestData => {
            manifest = manifestData;
            const artCount = manifest.atlasCount;
            const total = artCount + 2; // art sheets + plate sheet + manifest
            let loaded = 1; // manifest already loaded
            if (onProgress) onProgress(loaded, total);
            const report = () => { loaded++; if (onProgress) onProgress(loaded, total); };

            const artPromises = [];
            for (let i = 0; i < artCount; i++) {
                artPromises.push(
                    loadTexture(`assets/atlas_${i}.jpg`, THREE, renderer).then(tex => { report(); return tex; })
                );
            }

            const platePromise = loadTexture('assets/plates_0.png', THREE, renderer).then(tex => { report(); return tex; });

            return Promise.all([Promise.all(artPromises), platePromise]);
        })
        .then(([artTextures, plateTex]) => {
            atlasTextures = artTextures;
            plateTexture = plateTex;
        });
}

export class GalleryManager {
    constructor() {
        this.paintings = [];
        this._disposed = false;
    }

    /**
     * @param {object} wallMeshes
     * @param {THREE} THREE
     * @param {WebGLRenderer} renderer — needed for KTX2 format detection
     * @param {function} onProgress
     */
    placeArtwork(wallMeshes, THREE, renderer, onProgress) {
        this._disposed = false;
        ensureSharedResources(THREE);

        return loadAtlasAssets(THREE, renderer, onProgress).then(() => {
            if (this._disposed) return;

            const tileNames = Object.keys(manifest.tiles);
            const keys = Object.keys(wallMeshes);

            // Shuffle wall keys
            for (let i = keys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [keys[i], keys[j]] = [keys[j], keys[i]];
            }

            // Shuffle tile names
            const shuffledTiles = [...tileNames];
            for (let i = shuffledTiles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledTiles[i], shuffledTiles[j]] = [shuffledTiles[j], shuffledTiles[i]];
            }

            const count = Math.min(keys.length, shuffledTiles.length);
            const invGrid = 1 / manifest.gridSize;
            const invPlateCols = 1 / manifest.plate.cols;
            const invPlateRows = 1 / manifest.plate.rows;

            for (let i = 0; i < count; i++) {
                const key = keys[i];
                const wall = wallMeshes[key];
                const dir = key.split(',')[2];
                const label = shuffledTiles[i];
                const tile = manifest.tiles[label];

                const group = new THREE.Group();

                // Frame
                group.add(new THREE.Mesh(sharedFrameGeo, sharedFrameMat));

                // Art plane — clone the correct atlas texture with unique UV offset
                const artTex = atlasTextures[tile.atlas].clone();
                artTex.needsUpdate = true;
                artTex.repeat.set(invGrid, invGrid);
                artTex.offset.set(tile.col * invGrid, tile.row * invGrid);

                const artMat = new THREE.MeshStandardMaterial({
                    map: artTex,
                    roughness: 0.5,
                    metalness: 0.0,
                    side: THREE.DoubleSide
                });
                const art = new THREE.Mesh(sharedArtGeo, artMat);
                art.position.z = 0.01;
                group.add(art);

                // Nameplate — clone plate atlas texture with unique UV offset
                const pTex = plateTexture.clone();
                pTex.needsUpdate = true;
                pTex.repeat.set(invPlateCols, invPlateRows);
                pTex.offset.set(tile.plateCol * invPlateCols, tile.plateRow * invPlateRows);

                const plateMat = new THREE.MeshBasicMaterial({
                    map: pTex, side: THREE.DoubleSide, transparent: true
                });
                const plate = new THREE.Mesh(sharedPlateGeo, plateMat);
                plate.position.set(0, -0.92, 0.05);
                group.add(plate);

                // Position offset based on wall direction
                if (dir === 'N') {
                    group.position.set(0, 0, 0.16);
                } else if (dir === 'S') {
                    group.position.set(0, 0, -0.16);
                    group.rotation.y = Math.PI;
                } else if (dir === 'W') {
                    group.position.set(0.16, 0, 0);
                    group.rotation.y = Math.PI / 2;
                } else if (dir === 'E') {
                    group.position.set(-0.16, 0, 0);
                    group.rotation.y = -Math.PI / 2;
                }

                wall.add(group);
                this.paintings.push({ group, artMat, plateMat, artTex, pTex });
            }
        });
    }

    cleanup() {
        this._disposed = true;
        for (const p of this.paintings) {
            if (p.group.parent) p.group.parent.remove(p.group);
            p.artTex.dispose();
            p.pTex.dispose();
            p.artMat.dispose();
            p.plateMat.dispose();
        }
        this.paintings = [];
    }
}
