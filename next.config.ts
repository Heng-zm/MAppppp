import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  env: {
    NEXT_PUBLIC_GEOAPIFY_API_KEY: '8f2ab2d784bc4371bb0cb2c3bd0361a4',
  },
  experimental: {
    allowedDevOrigins: [
      'localhost:9002',
      // This allows the cloud environment to connect to Next.js HMR
      '9002-firebase-studio-1753343822984.cluster-iktsryn7xnhpexlu6255bftka4.cloudworkstations.dev',
    ],
  },
};

export default nextConfig;