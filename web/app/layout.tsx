import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import NativeShell from "@/components/NativeShell";
import Providers from "@/components/Providers";

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
};

export const metadata: Metadata = {
  title: "Dwelligence",
  description: "AI-powered NYC apartment search",
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
          <NativeShell />
          <Navbar />
          <main className="pt-0 lg:pt-[60px] overflow-x-hidden">{children}</main>
          <footer className="hidden" aria-hidden="true">Built {BUILD_TIME}</footer>
        </Providers>
      </body>
    </html>
  );
}
