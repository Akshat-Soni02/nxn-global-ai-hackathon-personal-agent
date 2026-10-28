// Every page: the bar at the top, the page, the footer. Before first paint, a one-line script in <head> marks the page
// as having scripts (html.js), so content that will be revealed can start hidden; if the reveals haven't started
// within 2 seconds (html.gsap), it shows everything instead. Without scripts, nothing is ever hidden. It is a plain
// inline script, not next/script: App Router queues a beforeInteractive script until its own code has loaded, which
// is after first paint, so the page would show, hide, then fade back in.
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer } from "../components/Footer";
import { MotionRoot } from "../components/motion/MotionRoot";
import { Nav } from "../components/Nav";
import "./globals.css";

const base = process.env.SITE_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "Shadow · Show it once", template: "%s · Shadow" },
  description:
    "Shadow learns a task from watching you do it once, then does it for you on your Mac, and fixes itself when a site changes. Private: what you record and run stays on your Mac.",
  icons: { icon: `${base}/mark.svg` },
  openGraph: {
    title: "Shadow · Show it once",
    description: "Show a task once. Shadow does it from then on, on your Mac.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#0b0c1a", colorScheme: "light" };

const BOOT =
  "document.documentElement.classList.add('js');setTimeout(function(){var d=document.documentElement;if(!d.classList.contains('gsap'))d.classList.remove('js')},2000)";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed one-line string written here, never user input */}
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>
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
