"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import gsap from "gsap";

type EmberColor = "sage" | "bone" | "blush";

const emberColors: Array<{ id: EmberColor; label: string }> = [
  { id: "sage", label: "Sage" },
  { id: "bone", label: "Bone" },
  { id: "blush", label: "Blush" },
];

const deskStories = [
  { id: "ultrawide", tone: "blue", photo: "/desk-stories/desk-01.jpg", handle: "@lofi.compile", alt: "Ember beside a succulent on a warm-lit desk with an ultrawide monitor and a lilac keyboard", review: "Now my focus streak has a face." },
  { id: "sundown", tone: "red", photo: "/desk-stories/desk-02.jpg", handle: "@sundown.dev", alt: "Ember on a monitor shelf lit by an orange and magenta sunset lamp, next to a laptop", review: "Small companion. Big motivation." },
  { id: "nightowl", tone: "green", photo: "/desk-stories/desk-03.jpg", handle: "@nightowl.dev", alt: "Ember glowing on a dark desk beside a studio microphone and a plant", review: "It sits there glowing while I debug at 2am." },
  { id: "zak", tone: "blue", photo: "/desk-stories/desk-04.jpg", handle: "@zak.codes", alt: "Ember on a cutting mat next to an open MacBook under blue desk lighting", review: "I made it myself, so it actually feels like mine." },
  { id: "breakdown", tone: "red", photo: "/desk-stories/desk-05.jpg", handle: "@deskbreakdown", alt: "A labelled desk setup with wall art, a light bar, a clock and Ember lined up under the monitor", review: "Everyone who visits my desk asks about it first." },
  { id: "dailybuilds", tone: "green", photo: "/desk-stories/desk-06.jpg", handle: "@dailybuilds", alt: "Ember beside a backlit mechanical keyboard on a dual-monitor gaming desk", review: "One weekend, one wire, zero regrets." },
  { id: "devfocus", tone: "blue", photo: "/desk-stories/desk-07.jpg", handle: "@devfocus", alt: "Ember on a home office desk between a monitor, a laptop and a wall of prints", review: "It gives my desk a little personality." },
  { id: "afterhours", tone: "red", photo: "/desk-stories/desk-08.jpg", handle: "@after.hours", alt: "Ember lit up on a night desk beside a phone stand and a full-size keyboard", review: "My first solder joint lives on this shelf." },
];

// Makeable star — traced from the wordmark in /makeable-logo.png so every star on the
// page is the same 8-point hand-drawn shape. Brand pink is #e02d6c.
function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M63.8 0 63.3 35.6 98.4 27.5 70.9 49.3 100 61.7 66.5 66 70 100 52 74 43.2 88.7 38.5 71.2 8.5 85.6 28.6 57.5 0 42.5 31.5 40 22.7 9.6 46.3 30.6Z" />
    </svg>
  );
}

export default function Home() {
  const storyRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const catalogueRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [activeScene, setActiveScene] = useState(0);
  const [flippedStories, setFlippedStories] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<EmberColor>("bone");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [buildEmail, setBuildEmail] = useState("");
  const [buildNotice, setBuildNotice] = useState("");

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.25,
      smoothWheel: true,
      syncTouch: false,
    });
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const canvas = canvasRef.current;
    const story = storyRef.current;
    if (!canvas || !story) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const isMobile = window.matchMedia("(max-width: 900px)").matches
      || (navigator.maxTouchPoints > 0 && window.innerWidth <= 1180);
    const totalFrames = isMobile ? 300 : 301;
    const frameDirectory = isMobile ? "frames-mobile" : "frames-v2";
    const frames: Array<HTMLImageElement | undefined> = new Array(totalFrames);
    const playhead = { frame: 0 };
    let requestedFrame = 0;
    let renderedFrame = -1;
    let drawRequest = 0;
    let disposed = false;
    let allFramesDecoded = false;
    let currentScene = 0;
    let transitioning = false;
    let touchStartY = 0;
    const keyframes = [0, 72, 156, 282];

    const atSceneBoundary = (direction: number) => (
      (direction > 0 && currentScene === keyframes.length - 1)
      || (direction < 0 && currentScene === 0)
    );

    const activateScene = (nextScene: number) => {
      if (transitioning || nextScene === currentScene || nextScene < 0 || nextScene >= keyframes.length) return;
      transitioning = true;
      currentScene = nextScene;
      setActiveScene(-1);

      const scrollRange = Math.max(0, story.offsetHeight - window.innerHeight);
      lenis.scrollTo(story.offsetTop + (nextScene / (keyframes.length - 1)) * scrollRange, {
        duration: 1.25,
        easing: (value: number) => 1 - Math.pow(1 - value, 4),
      });

      gsap.to(playhead, {
        frame: keyframes[nextScene],
        duration: 1.25,
        ease: "power3.inOut",
        overwrite: true,
        onUpdate: () => {
          requestedFrame = playhead.frame;
          scheduleDraw();
        },
        onComplete: () => {
          setActiveScene(nextScene);
          transitioning = false;
        },
      });
    };

    const drawImageCover = (image: HTMLImageElement) => {
      const width = canvas.width;
      const height = canvas.height;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };

    const drawFrame = (position: number, force = false) => {
      const clampedPosition = Math.max(0, Math.min(position, totalFrames - 1));
      if (!force && Math.abs(clampedPosition - renderedFrame) < 0.001) return;

      const baseIndex = Math.floor(clampedPosition);
      const nextIndex = Math.min(baseIndex + 1, totalFrames - 1);
      const baseImage = frames[baseIndex];
      const nextImage = frames[nextIndex];
      if (!baseImage?.naturalWidth) return;

      context.globalCompositeOperation = "copy";
      context.globalAlpha = 1;
      drawImageCover(baseImage);

      const blend = clampedPosition - baseIndex;
      if (blend > 0 && nextImage?.naturalWidth) {
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = blend;
        drawImageCover(nextImage);
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      renderedFrame = clampedPosition;
    };

    const scheduleDraw = () => {
      if (drawRequest) return;
      drawRequest = requestAnimationFrame(() => {
        drawRequest = 0;
        if (allFramesDecoded || frames[Math.floor(requestedFrame)]?.naturalWidth) {
          drawFrame(requestedFrame);
        }
      });
    };

    const resizeCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(bounds.width * density);
      canvas.height = Math.round(bounds.height * density);
      drawFrame(playhead.frame, true);
    };
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    const priorityFrames = [0, totalFrames - 1];
    const loadOrder = [...priorityFrames, ...Array.from({ length: totalFrames }, (_, index) => index).filter((index) => !priorityFrames.includes(index))];
    let cursor = 0;
    let decodedCount = 0;
    const loadNext = async () => {
      if (disposed || cursor >= loadOrder.length) return;
      const index = loadOrder[cursor++];
      const image = new Image();
      image.decoding = "async";
      frames[index] = image;
      image.src = `/${frameDirectory}/frame_${String(index + 1).padStart(3, "0")}.webp?v=31`;

      try {
        await image.decode();
        if (disposed) return;
        if (index === 0) {
          resizeCanvas();
          setReady(true);
          scheduleDraw();
        }
        decodedCount += 1;
        if (decodedCount === totalFrames) {
          allFramesDecoded = true;
          scheduleDraw();
        }
      } catch (error) {
        console.error(`Could not decode frame ${index + 1}`, error);
      } finally {
        void loadNext();
      }
    };
    for (let worker = 0; worker < 8; worker++) void loadNext();

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 6) return;
      const direction = Math.sign(event.deltaY);
      if (!transitioning && atSceneBoundary(direction)) return;
      event.preventDefault();
      event.stopPropagation();
      activateScene(currentScene + direction);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? touchStartY;
      const direction = Math.sign(touchStartY - currentY);
      if (!transitioning && atSceneBoundary(direction)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onTouchEnd = (event: TouchEvent) => {
      const endY = event.changedTouches[0]?.clientY ?? touchStartY;
      const distance = touchStartY - endY;
      const direction = Math.sign(distance);
      if (Math.abs(distance) < 28 || (!transitioning && atSceneBoundary(direction))) return;
      activateScene(currentScene + direction);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = ["ArrowDown", "PageDown", " "].includes(event.key) ? 1 : ["ArrowUp", "PageUp"].includes(event.key) ? -1 : 0;
      if (!direction) return;
      if (!transitioning && atSceneBoundary(direction)) return;
      event.preventDefault();
      activateScene(currentScene + direction);
    };
    story.addEventListener("wheel", onWheel, { passive: false, capture: true });
    story.addEventListener("touchstart", onTouchStart, { passive: true });
    story.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    story.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      cancelAnimationFrame(drawRequest);
      gsap.killTweensOf(playhead);
      story.removeEventListener("wheel", onWheel, true);
      story.removeEventListener("touchstart", onTouchStart);
      story.removeEventListener("touchmove", onTouchMove, true);
      story.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  const startCheckout = async () => {
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: selectedColor }),
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json() as { url?: string; error?: string }
        : {};
      if (!response.ok || !result.url) {
        throw new Error(result.error || (response.status === 404
          ? "Checkout is available on the deployed site."
          : "Checkout is unavailable right now."));
      }
      window.location.assign(result.url);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Checkout is unavailable right now.");
      setCheckoutBusy(false);
    }
  };

  const showOtherBuilds = () => {
    catalogueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleStory = (storyId: string) => {
    setFlippedStories((current) => current.includes(storyId)
      ? current.filter((id) => id !== storyId)
      : [...current, storyId]);
  };

  const handleBuildInterest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBuildEmail("");
    setBuildNotice("Email updates are opening soon — preview the builder in the meantime.");
  };

  return (
    <main>
      <section className="scroll-story" id="experience" ref={storyRef}>
        <div className="experience">
          <div className="film-frame">
            <canvas ref={canvasRef} aria-label="Product reveal controlled by scrolling" />
            <div className={`loader ${ready ? "is-ready" : ""}`}><span /></div>
            <div className="film-shade" />
          </div>
          <div className={`intro-cue ${activeScene === 0 ? "is-visible" : ""}`} aria-hidden={activeScene !== 0}>
            <span>Scroll to explore Ember</span>
            <i aria-hidden="true">↓</i>
          </div>
          <div className={`product-ui ${activeScene === 3 ? "is-visible" : ""}`} aria-hidden={activeScene !== 3}>
            <img className="makeable-logo" src="/makeable-logo.png" alt="Makeable" />
            <aside className="ember-card" aria-label="Ember preorder details">
              <small>Build 001</small>
              <div className="ember-title-row">
                <h1 aria-label="Feed Ember Tokens."><span>Feed</span><span>Ember</span><span>Tokens.</span></h1>
                <span className="ember-star" aria-hidden="true">✦</span>
              </div>
              <p>A desk pet that grows with every Claude and Codex token you burn.</p>
              <fieldset className="color-picker">
                <legend>Choose a color</legend>
                <div className="color-options">
                  {emberColors.map((color) => (
                    <button
                      className={`color-option color-${color.id}`}
                      type="button"
                      key={color.id}
                      aria-pressed={selectedColor === color.id}
                      onClick={() => setSelectedColor(color.id)}
                    >
                      <span aria-hidden="true" />
                      {color.label}
                      {selectedColor === color.id && <b aria-hidden="true">✓</b>}
                    </button>
                  ))}
                </div>
              </fieldset>
              <strong className="ember-price">$45</strong>
              <button className="preorder-button" type="button" onClick={startCheckout} disabled={checkoutBusy}>
                {checkoutBusy ? "Opening checkout…" : "Pre-order Ember"}<span aria-hidden="true">✦</span>
              </button>
              <button className="other-builds" type="button" onClick={showOtherBuilds}>Show me other builds.</button>
              {checkoutError && <p className="checkout-error" role="status">{checkoutError}</p>}
            </aside>
          </div>
        </div>
      </section>

      <section className="catalogue" id="builds" ref={catalogueRef} aria-label="Browse more Makeable builds">
        <div className="catalogue-artwork">
          <img className="catalogue-sheet" src="/build-catalogue-page.png" alt="What will you make? Ember, Study Desk Companion, and Plant Companion build catalogue" />
          <button
            className={`catalogue-preorder ${checkoutBusy ? "is-busy" : ""}`}
            type="button"
            onClick={startCheckout}
            disabled={checkoutBusy}
            aria-label={checkoutBusy ? "Opening Stripe checkout" : "Pre-order Ember for 45 dollars"}
          >
            <span>{checkoutBusy ? "Opening checkout…" : "Pre-order Ember · $45"}</span>
          </button>
          {checkoutError && <p className="catalogue-checkout-error" role="status">{checkoutError}</p>}
        </div>
      </section>

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
              const isFlipped = flippedStories.includes(story.id);
              return (
                <button
                  className={`ds-card ds-${story.tone} ${isFlipped ? "is-flipped" : ""}`}
                  type="button"
                  key={`${pass}-${story.id}`}
                  aria-hidden={pass === 1 ? true : undefined}
                  tabIndex={pass === 1 ? -1 : undefined}
                  aria-pressed={isFlipped}
                  onClick={() => toggleStory(story.id)}
                >
                  <span className="ds-window">
                    <span className="ds-card-inner">
                      <span className="ds-face ds-front">
                        <img src={story.photo} alt={story.alt} width={780} height={520} decoding="async" />
                        <span className="ds-handle">{story.handle}</span>
                      </span>
                      <span className="ds-face ds-back">
                        <b className="ds-quote-open" aria-hidden="true">“</b>
                        <Sparkle className="ds-back-star" />
                        <strong>{story.review}</strong>
                        <b className="ds-quote-close" aria-hidden="true">”</b>
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
          <span className="ds-paused" aria-hidden="true">
            <b>❚❚</b> Paused on hover
          </span>
        </div>
      </section>

      <section className="make-build-feature" id="make-a-build" aria-labelledby="make-build-title">
        <div className="make-build-copy">
          <span>Feature 02 · Coming soon</span>
          <h2 id="make-build-title">Make your<br />own build.<sup>✦</sup></h2>
          <p>Start with an idea, shape the plan, and turn it into a build worth sharing.</p>
          <form className="build-interest" onSubmit={handleBuildInterest}>
            <label htmlFor="build-email">Enter your email for Make a Build updates</label>
            <div>
              <input
                id="build-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Enter your email"
                value={buildEmail}
                onChange={(event) => setBuildEmail(event.target.value)}
                required
              />
              <button type="submit" aria-label="Join the Make a Build updates list">→</button>
            </div>
          </form>
          {buildNotice && <p className="build-notice" role="status">{buildNotice}</p>}
          <a className="preview-build-button" href="/pilot">Preview Make a Build <span aria-hidden="true">✦</span></a>
        </div>
        <div className="make-build-visual">
          <img
            src="/make-your-own-build-cutout.png"
            alt="Three-step Makeable blueprint: start with your idea, get a plan, then realize and share the finished build"
          />
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <div className="footer-logo-crop"><img src="/makeable-logo.png" alt="Makeable" /></div>
            <strong>Anything is makeable.</strong>
          </div>
          <nav className="footer-links" aria-label="Footer navigation">
            <a href="#builds">Builds</a>
            <a href="#experience">Parts Kits and</a>
            <a href="#make-a-build">Make a Build</a>
            <a href="#experience">Pre-order Status</a>
          </nav>
          <div className="footer-socials" aria-label="Makeable social channels">
            <span className="footer-social"><img src="/social-tiktok.svg" alt="" aria-hidden="true" /><span>TikTok</span></span>
            <span className="footer-social"><img src="/social-youtube.svg" alt="" aria-hidden="true" /><span>YouTube</span></span>
            <span className="footer-social"><img src="/social-facebook.svg" alt="" aria-hidden="true" /><span>Facebook</span></span>
            <span className="footer-social"><img src="/social-linkedin.svg" alt="" aria-hidden="true" /><span>LinkedIn</span></span>
            <span className="footer-social"><img src="/social-instagram.svg" alt="" aria-hidden="true" /><span>Instagram</span></span>
            <span className="footer-social"><img src="/social-x.svg" alt="" aria-hidden="true" /><span>X</span></span>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© Makeable 2025</span>
        </div>
      </footer>
    </main>
  );
}
