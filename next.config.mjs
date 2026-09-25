/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  // Pin the workspace root. Without this Next.js sees the lockfiles in
  // C:\Users\danap and ND-cognitive-OS and infers the wrong root.
  turbopack: {
    root: appRoot,
  },
  typescript: {
    // Inherited from the original Creator OS build. It means `next build` will
    // NOT fail on type errors, so run `npm run typecheck` separately.
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
