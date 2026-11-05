import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'models');

/**
 * Serializes a list of named pieces (each having { body, gold, steel, face } Three.js BufferGeometries)
 * into a standard Binary glTF 2.0 (.glb) buffer.
 */
function serializePiecesToGLB(pieceEntries) {
  const nodes = [];
  const meshes = [];
  const accessors = [];
  const bufferViews = [];
  const materials = [
    {
      name: 'PrimaryBody',
      pbrMetallicRoughness: {
        baseColorFactor: [0.94, 0.91, 0.86, 1.0],
        metallicFactor: 0.05,
        roughnessFactor: 0.16
      }
    },
    {
      name: 'GoldTrim',
      pbrMetallicRoughness: {
        baseColorFactor: [0.92, 0.69, 0.21, 1.0],
        metallicFactor: 0.92,
        roughnessFactor: 0.20
      }
    },
    {
      name: 'SteelBlade',
      pbrMetallicRoughness: {
        baseColorFactor: [0.77, 0.80, 0.84, 1.0],
        metallicFactor: 0.88,
        roughnessFactor: 0.24
      }
    },
    {
      name: 'SculptedFace',
      pbrMetallicRoughness: {
        baseColorFactor: [0.90, 0.78, 0.67, 1.0],
        metallicFactor: 0.02,
        roughnessFactor: 0.38
      }
    }
  ];

  const binChunks = [];
  let byteOffset = 0;

  function appendTypedArray(typedArray, target) {
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const viewIndex = bufferViews.length;
    const view = {
      buffer: 0,
      byteOffset,
      byteLength: buf.byteLength
    };
    if (target) view.target = target;
    bufferViews.push(view);
    binChunks.push(buf);
    byteOffset += buf.byteLength;
    const remainder = byteOffset % 4;
    if (remainder !== 0) {
      const pad = 4 - remainder;
      binChunks.push(Buffer.alloc(pad));
      byteOffset += pad;
    }
    return viewIndex;
  }

  function appendFloat32Array(arr, target) {
    const float32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
    return appendTypedArray(float32, target);
  }

  function computeMinMaxVec3(array) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i];
      const y = array[i + 1];
      const z = array[i + 2];
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    return { min, max };
  }

  const rootChildren = [];

  for (const { name, parts } of pieceEntries) {
    const subParts = [
      { subName: 'body', geo: parts.body, matIdx: 0 },
      { subName: 'gold', geo: parts.gold, matIdx: 1 },
      { subName: 'steel', geo: parts.steel, matIdx: 2 },
      { subName: 'face', geo: parts.face, matIdx: 3 }
    ];

    const childNodeIndices = [];

    for (const sub of subParts) {
      const posAttr = sub.geo.getAttribute('position');
      const normAttr = sub.geo.getAttribute('normal');
      const uvAttr = sub.geo.getAttribute('uv');

      const posView = appendFloat32Array(posAttr.array, 34962);
      const { min, max } = computeMinMaxVec3(posAttr.array);
      const posAcc = accessors.length;
      accessors.push({
        bufferView: posView,
        byteOffset: 0,
        componentType: 5126,
        count: posAttr.count,
        type: 'VEC3',
        min,
        max
      });

      const attributes = { POSITION: posAcc };

      if (normAttr) {
        const normView = appendFloat32Array(normAttr.array, 34962);
        const normAcc = accessors.length;
        accessors.push({
          bufferView: normView,
          byteOffset: 0,
          componentType: 5126,
          count: normAttr.count,
          type: 'VEC3'
        });
        attributes.NORMAL = normAcc;
      }

      if (uvAttr) {
        const uvView = appendFloat32Array(uvAttr.array, 34962);
        const uvAcc = accessors.length;
        accessors.push({
          bufferView: uvView,
          byteOffset: 0,
          componentType: 5126,
          count: uvAttr.count,
          type: 'VEC2'
        });
        attributes.TEXCOORD_0 = uvAcc;
      }

      const primitive = {
        attributes,
        material: sub.matIdx,
        mode: 4
      };

      if (sub.geo.index) {
        const idxArray = sub.geo.index.array;
        const isUint32 = idxArray instanceof Uint32Array;
        const idxView = appendTypedArray(idxArray, 34963);
        const idxAcc = accessors.length;
        accessors.push({
          bufferView: idxView,
          byteOffset: 0,
          componentType: isUint32 ? 5125 : 5123,
          count: sub.geo.index.count,
          type: 'SCALAR'
        });
        primitive.indices = idxAcc;
      }

      const meshIndex = meshes.length;
      meshes.push({
        name: `${name}_${sub.subName}_mesh`,
        primitives: [primitive]
      });

      const nodeIndex = nodes.length;
      nodes.push({
        name: sub.subName,
        mesh: meshIndex
      });
      childNodeIndices.push(nodeIndex);
    }

    const groupNodeIndex = nodes.length;
    nodes.push({
      name,
      children: childNodeIndices
    });
    rootChildren.push(groupNodeIndex);
  }

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'Wizard Chess AAA Sculpted GLB Pipeline'
    },
    scene: 0,
    scenes: [
      {
        name: 'WizardChessPieces',
        nodes: rootChildren
      }
    ],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: byteOffset
      }
    ]
  };

  const jsonString = JSON.stringify(gltf);
  let jsonBuffer = Buffer.from(jsonString, 'utf8');
  const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
  if (jsonPad > 0) {
    jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPad, 0x20)]);
  }

  const binBuffer = Buffer.concat(binChunks);
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer, binChunkHeader, binBuffer]);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const entryPath = path.join(ROOT_DIR, 'src', 'assets', 'PieceGeometryBuilder.ts');
  const bundled = await build({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false
  });

  const code = bundled.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const mod = await import(dataUrl);

  const pieceMap = [
    { symbol: 'p', name: 'pawn' },
    { symbol: 'r', name: 'rook' },
    { symbol: 'n', name: 'knight' },
    { symbol: 'b', name: 'bishop' },
    { symbol: 'q', name: 'queen' },
    { symbol: 'k', name: 'king' }
  ];

  const allEntries = [];
  let totalTriangles = 0;

  for (const item of pieceMap) {
    const parts = mod.getPieceGeometryParts(item.symbol, 'high');
    const countIndices = (g) => (g.index ? g.index.count : g.getAttribute('position').count);
    const tris =
      (countIndices(parts.body) +
        countIndices(parts.gold) +
        countIndices(parts.steel) +
        countIndices(parts.face)) /
      3;
    totalTriangles += tris;

    allEntries.push({ name: item.name, parts });

    const singleGlb = serializePiecesToGLB([{ name: item.name, parts }]);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${item.name}.glb`), singleGlb);
  }

  const combinedGlb = serializePiecesToGLB(allEntries);
  const combinedPath = path.join(OUTPUT_DIR, 'arcane_pieces.glb');
  fs.writeFileSync(combinedPath, combinedGlb);

  console.log(
    `[Wizard Chess Asset Pipeline] Generated 6 individual GLBs + arcane_pieces.glb (${(combinedGlb.length / 1024).toFixed(1)} KB, ${Math.round(totalTriangles)} sculpted triangles)`
  );
}

main().catch((err) => {
  console.error('[Wizard Chess Asset Pipeline] Failed to generate GLB assets:', err);
  process.exit(1);
});
