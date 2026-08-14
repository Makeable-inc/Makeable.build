import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.URL || "http://localhost:3000"),
  title: "A Moment in Motion",
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
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
