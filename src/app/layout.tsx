import type { Metadata, Viewport } from 'next';
import { Kantumruy_Pro } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";

// Configure Kantumruy Pro (Covers both Latin and Khmer characters)
const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'],
  variable: '--font-kantumruy',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Map Explorer',
  description: 'Interactive map application created with Next.js and Mapbox.',
  // manifest: '/manifest.json', 
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Map Explorer',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#09090b',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Mapbox GL CSS */}
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.5.1/mapbox-gl.css" rel="stylesheet" />
        {/* Mapbox Directions CSS */}
        <link
          rel="stylesheet"
          href="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-directions/v4.3.0/mapbox-gl-directions.css"
          type="text/css"
        />
      </head>
      <body 
        // Apply the font variable and the className globally
        className={`${kantumruy.variable} ${kantumruy.className} antialiased bg-zinc-950 text-zinc-50 overflow-hidden`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}