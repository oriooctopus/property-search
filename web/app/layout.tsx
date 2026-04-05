import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";

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
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
        style={{ backgroundColor: "#0f1117", color: "#e1e4e8" }}
      >
        <Providers>
          <Navbar />
          <main className="pt-0 lg:pt-[60px]">{children}</main>
          <footer className="text-center py-2 text-[10px]" style={{ color: '#484f58' }}>
            Built {BUILD_TIME}
          </footer>
        </Providers>
      </body>
    </html>
  );
}
