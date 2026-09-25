import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { MobileTabBar } from "@/components/nav/NavLinks";
import { NavProgress } from "@/components/nav/NavProgress";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DEFAULT_OG_IMAGE, site } from "@/lib/config/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} - ${site.tagline}`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  // A page that sets its own openGraph replaces this object: pages without an image of their
  // own pass DEFAULT_OG_IMAGE again.
  openGraph: {
    siteName: site.name,
    locale: "zh_CN",
    type: "website",
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0f1014",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="flex min-h-full flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* Only the progress bar sits in this boundary; page content is outside it. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <MobileTabBar />
      </body>
    </html>
  );
}
