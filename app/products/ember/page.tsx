import type { Metadata } from "next";
import EmberProduct from "./ember-product";

export const metadata: Metadata = {
  title: "Ember by Makeable — Stop babysitting your terminal",
  description: "Ember makes Claude Code status and token pressure visible from across your desk, so you know when your agent is working, waiting, or finished.",
  openGraph: {
    title: "Ember by Makeable",
    description: "Know when Claude needs you—without checking another tab.",
    images: ["/ember-hero-v3.png"],
  },
};

export default function EmberPage() {
  return <EmberProduct />;
}
