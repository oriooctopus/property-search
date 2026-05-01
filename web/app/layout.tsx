import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import NativeShell from "@/components/NativeShell";
import Providers from "@/components/Providers";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import PointerDebugger from "@/components/PointerDebugger";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BUILD_TIME = new Date().toISOString();

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Matches the dark body background so the iOS status bar tint and the
  // Android browser chrome blend with the app surface.
  themeColor: '#0f1117',
};

export const metadata: Metadata = {
  title: "Dwelligence",
  description: "AI-powered NYC apartment search",
  applicationName: "Dwelligence",
  // PWA install metadata for iOS Safari (Add to Home Screen). Android picks
  // these up from the web manifest, but iOS still relies on these tags.
  appleWebApp: {
    capable: true,
    title: "Dwelligence",
    // 'black-translucent' lets the app draw under the notch/status bar; pairs
    // with viewportFit: 'cover' above and the safe-area insets we already use
    // throughout the app shell.
    statusBarStyle: "black-translucent",
  },
  // Explicit icon links. Next.js will emit <link rel="icon"> and
  // <link rel="apple-touch-icon"> from these.
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // Manifest link is also auto-emitted by Next when app/manifest.ts exists,
  // but stating it here makes the contract explicit and survives any future
  // refactor of the manifest route.
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Preconnect to the image CDNs that serve listing photos. These three hosts
  // cover ~100% of photo traffic (Zillow ~90%, Craigslist ~8%, Supabase ~2%).
  // crossOrigin is set to "anonymous" since browsers treat <img> loads as
  // anonymous CORS by default — mismatched crossorigin attrs on preconnect
  // get ignored, so this must match the eventual fetch mode.
  return (
    <html lang="en">
      <head>
        {/* Legacy iOS PWA capability hint. Next.js emits the modern
            `mobile-web-app-capable` automatically, but older iOS Safari
            versions (<18) only honor the apple-prefixed form, so we keep
            both for the broadest standalone-launch coverage. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link
          rel="preconnect"
          href="https://photos.zillowstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://photos.zillowstatic.com" />
        <link
          rel="preconnect"
          href="https://images.craigslist.org"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://images.craigslist.org" />
        <link
          rel="preconnect"
          href="https://vlzqdeisrngovqpbtsgi.supabase.co"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://vlzqdeisrngovqpbtsgi.supabase.co" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
        style={{ backgroundColor: "#0f1117", color: "#e1e4e8" }}
      >
        <Providers>
          <ServiceWorkerRegister />
          <NativeShell />
          <Navbar />
          <main className="pt-0 lg:pt-[60px] overflow-x-hidden">{children}</main>
          <footer className="hidden" aria-hidden="true">Built {BUILD_TIME}</footer>
          {/* Pointer-event capture for real-iOS gesture debugging. Only
              activates when ?ptdebug=1 is in the URL — otherwise renders
              null. See web/components/PointerDebugger.tsx. */}
          <PointerDebugger />
        </Providers>
      </body>
    </html>
  );
}
