import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(projectRoot, 'public/ocr');
const trainedDataUrl =
  'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz';
const coreAssetNames = [
  'tesseract-core.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
];

const copyAsset = async (source, name) => {
  const destination = resolve(outputDirectory, name);
  await copyFile(source, destination);
  console.log(`Copied ${name}`);
};

const downloadTrainedData = async () => {
  const response = await fetch(trainedDataUrl);

  if (!response.ok) {
    throw new Error(
      `Unable to download eng.traineddata.gz: ${response.status} ${response.statusText}`,
    );
  }

  const destination = resolve(outputDirectory, 'eng.traineddata.gz');
  const temporaryDestination = `${destination}.tmp`;
  await writeFile(temporaryDestination, Buffer.from(await response.arrayBuffer()));
  await rename(temporaryDestination, destination);
  console.log('Downloaded eng.traineddata.gz');
};

await mkdir(outputDirectory, { recursive: true });

await copyAsset(
  require.resolve('tesseract.js/dist/worker.min.js'),
  'worker.min.js',
);

const tesseractPackagePath = require.resolve('tesseract.js/package.json');
const tesseractPackageDirectory = dirname(tesseractPackagePath);
const corePackagePath = require.resolve('tesseract.js-core/package.json', {
  paths: [tesseractPackageDirectory],
});
const coreDirectory = dirname(corePackagePath);
await Promise.all(
  coreAssetNames.map((name) => copyAsset(resolve(coreDirectory, name), name)),
);

await downloadTrainedData();
