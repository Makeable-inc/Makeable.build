import type { Metadata } from "next";
import "./globals.css";
import PostHogProvider from "./posthog-provider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.URL || "http://localhost:3000"),
  title: "Makeable — Feed Ember Tokens.",
  description: "A desk pet that grows with every Claude and Codex token you burn. Pick a kit, snap it together, bring it to life.",
  openGraph: {
    siteName: "Makeable",
    title: "Makeable — Feed Ember Tokens.",
    description: "A desk pet that grows with every Claude and Codex token you burn. Pick a kit, snap it together, bring it to life.",
    images: [{ url: "/build-catalogue-page.png", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Makeable — Feed Ember Tokens.",
    description: "A desk pet that grows with every Claude and Codex token you burn.",
    images: ["/build-catalogue-page.png"],
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
