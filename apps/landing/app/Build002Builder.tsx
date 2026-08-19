"use client";

import { type FormEvent, useState } from "react";
import { captureMakeableEvent } from "./analytics";

type Choice = { id: string; label: string };

const PURPOSE: Choice[] = [
  { id: "focus", label: "Focus" },
  { id: "plants", label: "Plants" },
  { id: "coding", label: "Coding" },
  { id: "sleep", label: "Sleep" },
];
const INPUT: Choice[] = [
  { id: "tokens", label: "Tokens" },
  { id: "timer", label: "Timer" },
  { id: "moisture", label: "Moisture" },
  { id: "motion", label: "Motion" },
];
const REACTION: Choice[] = [
  { id: "animate", label: "Animate" },
  { id: "glow", label: "Glow" },
  { id: "sound", label: "Sound" },
  { id: "move", label: "Move" },
];
const FORM: Choice[] = [
  { id: "desk-pet", label: "Desk pet" },
  { id: "display", label: "Display" },
  { id: "wearable", label: "Wearable" },
  { id: "object", label: "Object" },
];

const INPUT_PHRASE: Record<string, string> = {
  tokens: "a burst of Claude & Codex tokens",
  timer: "a 25-minute focus session",
  moisture: "dry soil in your plant",
  motion: "you sitting down to work",
};
const REACTION_PHRASE: Record<string, string> = {
  animate: "plays a little animation",
  glow: "grows a glowing forest",
  sound: "chimes a soft reward",
  move: "wiggles and dances",
};
const NAME_BY_PURPOSE: Record<string, string> = {
  focus: "Focus Sprite",
  plants: "Garden Guardian",
  coding: "Commit Companion",
  sleep: "Night Sprite",
};

interface Build002BuilderProps {
  placement: string;
}

export default function Build002Builder({ placement }: Build002BuilderProps) {
  const [purpose, setPurpose] = useState("focus");
  const [input, setInput] = useState("timer");
  const [reaction, setReaction] = useState("glow");
  const [form, setForm] = useState("desk-pet");
  const [generated, setGenerated] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const blueprintName = `Build 002: ${NAME_BY_PURPOSE[purpose] ?? "Your Build"}`;
  const blueprintDesc = `Detects ${INPUT_PHRASE[input]} → ${REACTION_PHRASE[reaction]} → celebrates when the session completes.`;

  const pick = (
    setter: (value: string) => void,
    category: string,
    value: string,
  ) => {
    setter(value);
    setGenerated(false);
    captureMakeableEvent("build002 choice selected", { placement, category, choice: value });
  };

  const generate = () => {
    setGenerated(true);
    captureMakeableEvent("build002 blueprint generated", { placement, purpose, input, reaction, form });
  };

  const join = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/build-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? (await response.json()) as { ok?: boolean; error?: string }
        : {};
      if (!response.ok || !result.ok) {
        throw new Error(result.error || (response.status === 404
          ? "Waitlist is available on the deployed site."
          : "We could not save your email right now."));
      }
      setEmail("");
      setNotice("Saved. You’re on the builder pilot list — we’ll share Build 002 updates.");
      captureMakeableEvent("build002 waitlist submitted", { placement, blueprint_generated: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We could not save your email right now.");
    } finally {
      setBusy(false);
    }
  };

  const row = (
    legend: string,
    options: Choice[],
    value: string,
    setter: (value: string) => void,
    category: string,
  ) => (
    <fieldset className="b2-row">
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="raise-chip"
            aria-pressed={value === option.id}
            onClick={() => pick(setter, category, option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="b2">
      <div className="b2-copy">
        <span className="raise-eyebrow">Build 002 · Make your own</span>
        <h2 className="b2-title">Ember is Build 001.<br />What should Build 002 do?</h2>
        <p className="raise-lede">
          Make four quick choices and we’ll draft your build — no email until you like it.
        </p>

        {row("Purpose", PURPOSE, purpose, setPurpose, "purpose")}
        {row("Input", INPUT, input, setInput, "input")}
        {row("Reaction", REACTION, reaction, setReaction, "reaction")}
        {row("Form", FORM, form, setForm, "form")}

        {!generated ? (
          <button type="button" className="raise-primary" onClick={generate}>
            Generate my blueprint <span aria-hidden="true">✦</span>
          </button>
        ) : null}
      </div>

      <div className="b2-result" aria-live="polite">
        {generated ? (
          <>
            <div className="b2-blueprint">
              <span className="raise-badge-tag">Blueprint</span>
              <strong>{blueprintName}</strong>
              <p>{blueprintDesc}</p>
              <span className="b2-blueprint-note">Concept preview · not yet for sale</span>
            </div>
            <form className="b2-join" onSubmit={join}>
              <label htmlFor={`b2-email-${placement}`}>Save my blueprint and join the builder pilot</label>
              <div>
                <input
                  id={`b2-email-${placement}`}
                  type="email"
                  autoComplete="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <button type="submit" disabled={busy}>
                  {busy ? <span className="button-spinner" aria-hidden="true" /> : "Save →"}
                </button>
              </div>
            </form>
            {notice && <p className="build-notice" role="status">{notice}</p>}
          </>
        ) : (
          <div className="b2-placeholder">
            <span aria-hidden="true">✦</span>
            <p>Your Build 002 blueprint appears here.</p>
            {/* Placeholder: real generated-build art / 3D preview drops in later. */}
          </div>
        )}
      </div>
    </div>
  );
}
