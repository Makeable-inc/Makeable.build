import type { Metadata } from "next";
import "./globals.css";
import "./production.css";
import "./workspace.css";
import PostHogProvider from "./posthog-provider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.URL || "http://localhost:3000"),
  title: "Makeable — Feed Ember Tokens.",
  description: "Pre-order Ember, explore starter builds, and create your own low-power ESP32 kit idea.",
  openGraph: {
    siteName: "Makeable",
    title: "Makeable — Feed Ember Tokens.",
    description: "Pre-order Ember, explore starter builds, and create your own low-power ESP32 kit idea.",
    images: [{ url: "/concepts/homepage-v2/ember-flagship-hero-v2.webp", width: 1672, height: 941 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Makeable — Feed Ember Tokens.",
    description: "Pre-order Ember, explore starter builds, and create your own build idea.",
    images: ["/concepts/homepage-v2/ember-flagship-hero-v2.webp"],
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "512x512" }],
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><PostHogProvider>{children}</PostHogProvider></body>
    </html>
  );
}
