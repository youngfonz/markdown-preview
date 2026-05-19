import type { NextConfig } from "next";

// When deployed under fonz.sh/markdown, set NEXT_PUBLIC_BASE_PATH=/markdown in Vercel.
// Locally it stays empty so dev runs at http://localhost:3001/.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
