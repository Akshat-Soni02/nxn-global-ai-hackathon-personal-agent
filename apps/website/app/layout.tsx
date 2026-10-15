// Every page: the bar at the top, the page, the footer. Before first paint, a two-line script marks the page as having
// scripts (html.js), so content that will be revealed can start hidden; if the reveals haven't started within 4
// seconds (html.gsap), it shows everything instead. Without scripts, nothing is ever hidden.
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Footer } from "../components/Footer";
import { MotionRoot } from "../components/motion/MotionRoot";
import { Nav } from "../components/Nav";
import "./globals.css";

const base = process.env.SITE_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "Shadow · Show it once", template: "%s · Shadow" },
  description:
    "Shadow learns a task from watching you do it once, then does it for you on your Mac, and fixes itself when a site changes. Private: your Mac and your own model key, nothing in between.",
  icons: { icon: `${base}/mark.svg` },
  openGraph: {
    title: "Shadow · Show it once",
    description: "Show a task once. Shadow does it from then on, on your Mac.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#0b0c1a", colorScheme: "light" };

const BOOT =
  "document.documentElement.classList.add('js');setTimeout(function(){var d=document.documentElement;if(!d.classList.contains('gsap'))d.classList.remove('js')},4000)";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="boot" strategy="beforeInteractive">
          {BOOT}
        </Script>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Nav />
        <MotionRoot>{children}</MotionRoot>
        <Footer />
      </body>
    </html>
  );
}
