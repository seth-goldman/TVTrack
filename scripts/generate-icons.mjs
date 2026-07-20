// Rasterise public/icon.svg into the PNG sizes the web app manifest and iOS
// home-screen require. Run with: npm run icons
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(join(root, 'public', 'icon.svg'))

for (const size of [192, 512]) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
  await writeFile(join(root, 'public', `icon-${size}.png`), png)
  console.log(`wrote public/icon-${size}.png`)
}
