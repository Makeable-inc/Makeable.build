"use client";

import { useState } from "react";
import "./seen-on-real-desks.css";

type Tone = "blue" | "red" | "green";

type DeskStory = {
  id: string;
  tone: Tone;
  photo: string;
  handle: string;
  alt: string;
  review: string;
};

const deskStories: DeskStory[] = [
  { id: "ultrawide", tone: "blue", photo: "/desk-stories/desk-01.jpg", handle: "@lofi.compile", alt: "Ember beside a succulent on a warm-lit desk with an ultrawide monitor and a lilac keyboard", review: "Now my focus streak has a face." },
  { id: "sundown", tone: "red", photo: "/desk-stories/desk-02.jpg", handle: "@sundown.dev", alt: "Ember on a monitor shelf lit by an orange and magenta sunset lamp, next to a laptop", review: "Small companion. Big motivation." },
  { id: "nightowl", tone: "green", photo: "/desk-stories/desk-03.jpg", handle: "@nightowl.dev", alt: "Ember glowing on a dark desk beside a studio microphone and a plant", review: "It sits there glowing while I debug at 2am." },
  { id: "zak", tone: "blue", photo: "/desk-stories/desk-04.jpg", handle: "@zak.codes", alt: "Ember on a cutting mat next to an open MacBook under blue desk lighting", review: "I made it myself, so it actually feels like mine." },
  { id: "breakdown", tone: "red", photo: "/desk-stories/desk-05.jpg", handle: "@deskbreakdown", alt: "A labelled desk setup with wall art, a light bar, a clock and Ember lined up under the monitor", review: "Everyone who visits my desk asks about it first." },
  { id: "dailybuilds", tone: "green", photo: "/desk-stories/desk-06.jpg", handle: "@dailybuilds", alt: "Ember beside a backlit mechanical keyboard on a dual-monitor gaming desk", review: "One weekend, one wire, zero regrets." },
  { id: "devfocus", tone: "blue", photo: "/desk-stories/desk-07.jpg", handle: "@devfocus", alt: "Ember on a home office desk between a monitor, a laptop and a wall of prints", review: "It gives my desk a little personality." },
  { id: "afterhours", tone: "red", photo: "/desk-stories/desk-08.jpg", handle: "@after.hours", alt: "Ember lit up on a night desk beside a phone stand and a full-size keyboard", review: "My first solder joint lives on this shelf." },
];

function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M63.8 0 63.3 35.6 98.4 27.5 70.9 49.3 100 61.7 66.5 66 70 100 52 74 43.2 88.7 38.5 71.2 8.5 85.6 28.6 57.5 0 42.5 31.5 40 22.7 9.6 46.3 30.6Z" />
    </svg>
  );
}

export default function SeenOnRealDesks() {
  const [flipped, setFlipped] = useState<string[]>([]);

  const toggle = (id: string) => {
    setFlipped((current) => current.includes(id)
      ? current.filter((currentId) => currentId !== id)
      : [...current, id]);
  };

  return (
    <section className="deskstories" aria-labelledby="deskstories-title">
      <header className="deskstories-header">
        <h2 id="deskstories-title">
          Seen on real desks.
          <Sparkle className="deskstories-star" />
        </h2>
        <p>The build roll</p>
      </header>

      <div className="deskstories-viewport">
        <div className="deskstories-track">
          {[0, 1].map((pass) => deskStories.map((story) => {
            const isFlipped = flipped.includes(story.id);
            return (
              <button
                className={`ds-card ds-${story.tone} ${isFlipped ? "is-flipped" : ""}`}
                type="button"
                key={`${pass}-${story.id}`}
                aria-hidden={pass === 1 ? true : undefined}
                tabIndex={pass === 1 ? -1 : undefined}
                aria-pressed={isFlipped}
                onClick={() => toggle(story.id)}
              >
                <span className="ds-window">
                  <span className="ds-card-inner">
                    <span className="ds-face ds-front">
                      <img src={story.photo} alt={story.alt} width={780} height={520} decoding="async" />
                      <span className="ds-handle">{story.handle}</span>
                    </span>
                    <span className="ds-face ds-back">
                      <b className="ds-quote-open" aria-hidden="true">&ldquo;</b>
                      <Sparkle className="ds-back-star" />
                      <strong>{story.review}</strong>
                      <b className="ds-quote-close" aria-hidden="true">&rdquo;</b>
                    </span>
                  </span>
                </span>
              </button>
            );
          }))}
        </div>
      </div>

      <div className="deskstories-status">
        <span className="ds-progress" aria-hidden="true"><i /></span>
        <span className="ds-paused" aria-hidden="true"><b>❚❚</b> Paused on hover</span>
      </div>
    </section>
  );
}
