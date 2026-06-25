/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // schemind ships ESM from a workspace package — let Next transpile it.
  transpilePackages: ['schemind'],
}

export default nextConfig
