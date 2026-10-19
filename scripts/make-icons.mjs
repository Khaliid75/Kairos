// Génère l'icône Kairos (horloge + flèche, lavande) dans le projet Android.
// Lancé par le workflow après « npx cap add android ».
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RES = 'android/app/src/main/res';
const BG = '#5b3fd1';
const RING = '#f4f0ff';
const HAND = '#cdbfff';
const ARROW = '#ffffff';

// Marque centrée en (0,0) ; rayon de l'anneau = 44
const mark = `
  <circle r="44" fill="none" stroke="${RING}" stroke-width="6"/>
  <line x1="0" y1="0" x2="18" y2="10" stroke="${HAND}" stroke-width="6" stroke-linecap="round"/>
  <line x1="0" y1="0" x2="0" y2="-26" stroke="${ARROW}" stroke-width="6" stroke-linecap="round"/>
  <polygon points="0,-42 -10,-26 10,-26" fill="${ARROW}"/>`;

const wrap = (size, view, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${view} ${view}">${body}</svg>`;

// Calque avant de l'icône adaptative (zone sûre ≈ 66/108)
const foreground = (size) => wrap(size, 108, `<g transform="translate(54 54) scale(0.6)">${mark}</g>`);
// Anciennes versions d'Android : carré arrondi et rond
const square = (size) =>
  wrap(size, 100, `<rect width="100" height="100" rx="22" fill="${BG}"/><g transform="translate(50 50) scale(0.62)">${mark}</g>`);
const round = (size) =>
  wrap(size, 100, `<circle cx="50" cy="50" r="50" fill="${BG}"/><g transform="translate(50 50) scale(0.56)">${mark}</g>`);

const DENSITIES = {
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};

const write = async (svg, file) => {
  mkdirSync(join(file, '..'), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
};

for (const [d, [launcher, fg]] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${d}`);
  await write(square(launcher), join(dir, 'ic_launcher.png'));
  await write(round(launcher), join(dir, 'ic_launcher_round.png'));
  await write(foreground(fg), join(dir, 'ic_launcher_foreground.png'));
}

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
mkdirSync(join(RES, 'mipmap-anydpi-v26'), { recursive: true });
writeFileSync(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
writeFileSync(join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);

mkdirSync(join(RES, 'values'), { recursive: true });
writeFileSync(
  join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG}</color>
</resources>
`
);

console.log('Icône Kairos générée.');
