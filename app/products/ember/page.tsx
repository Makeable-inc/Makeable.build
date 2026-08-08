import type { Metadata } from "next";
import EmberProduct from "./ember-product";

export const metadata: Metadata = {
  title: "Ember by Makeable — Desktop token companion",
  description: "Meet Ember, a USB-C desktop companion that gives your Claude Code usage an expressive face. Explore specifications, colors, privacy, compatibility, and preorder details.",
  openGraph: {
    title: "Ember by Makeable",
    description: "Your Claude tokens, but cute.",
    images: ["/ember-hero-v2.png"],
  },
};

export default function EmberPage() {
  return <EmberProduct />;
}
