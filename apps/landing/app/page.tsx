"use client";

import { useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import gsap from "gsap";

export default function Home() {
  const storyRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [activeScene, setActiveScene] = useState(0);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

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
      event.preventDefault();
      event.stopPropagation();
      if (Math.abs(event.deltaY) < 6) return;
      activateScene(currentScene + Math.sign(event.deltaY));
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onTouchEnd = (event: TouchEvent) => {
      const endY = event.changedTouches[0]?.clientY ?? touchStartY;
      const distance = touchStartY - endY;
      if (Math.abs(distance) >= 28) activateScene(currentScene + Math.sign(distance));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = ["ArrowDown", "PageDown", " "].includes(event.key) ? 1 : ["ArrowUp", "PageUp"].includes(event.key) ? -1 : 0;
      if (!direction) return;
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
      const response = await fetch("/api/checkout", { method: "POST" });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout is unavailable right now.");
      window.location.assign(result.url);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Checkout is unavailable right now.");
      setCheckoutBusy(false);
    }
  };

  return (
    <main>
      <section className={`scroll-story ${catalogueOpen ? "is-leaving" : ""}`} id="experience" ref={storyRef}>
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
            <button className="browse-builds" type="button" onClick={() => setCatalogueOpen(true)}>Browse more builds <span>↗</span></button>
            <aside className="ember-card" aria-label="Ember preorder details">
              <small>Build 001 · Pre-order</small>
              <h1>Ember</h1>
              <p>A desk pet that grows with every Claude and Codex token you burn.</p>
              <div className="ember-features"><span>Snap-fit kit</span><span>USB-C powered</span><span>Living display</span></div>
              <button type="button" onClick={startCheckout} disabled={checkoutBusy}>{checkoutBusy ? "Opening checkout…" : "Pre-order · $45"}</button>
              {checkoutError && <p className="checkout-error" role="status">{checkoutError}</p>}
            </aside>
          </div>
        </div>
      </section>

      <section className={`catalogue ${catalogueOpen ? "is-open" : ""}`} aria-hidden={!catalogueOpen}>
        <button className="catalogue-back" type="button" onClick={() => setCatalogueOpen(false)} aria-label="Return to the Ember story">← Back</button>
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
    </main>
  );
}
