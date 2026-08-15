import type { Metadata } from "next";
import { Fredoka } from "next/font/google";
import "./globals.css";

// Makeable brand display face — matches the wordmark and --display in the main site styles.css
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.URL || "http://localhost:3000"),
  title: "Makeable",
  description: "A cinematic, scroll-controlled product story.",
  openGraph: {
    title: "Some Things Deserve a Moment",
    description: "A tactile story, told in motion.",
    images: [{ url: "/og.png", width: 1536, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Some Things Deserve a Moment",
    description: "A tactile story, told in motion.",
    images: ["/og.png"],
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
    <html lang="en" className={fredoka.variable}>
      <body>{children}</body>
    </html>
  );
}
