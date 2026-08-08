import type { Metadata } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

const baloo = Baloo_2({ variable: "--font-display", subsets: ["latin"] });
const nunito = Nunito({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Makeable — Small projects, big I-made-that energy",
  description: "Pre-order beginner-friendly electronics builds with the exact parts, preloaded code, and a project-specific guide.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "Makeable", description: "Small projects, big I-made-that energy.", images: ["/og-v2.png"] },
  twitter: { card: "summary_large_image", title: "Makeable", description: "Small projects, big I-made-that energy.", images: ["/og-v2.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${baloo.variable} ${nunito.variable}`}>{children}</body></html>;
}
