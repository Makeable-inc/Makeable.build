"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import SeenOnRealDesks from "./SeenOnRealDesks";
import BuildBlueprint from "./BuildBlueprint";

type EmberColor = "sage" | "bone" | "blush";
type EmberMarket = "US" | "SG";
type SequenceMode = "desktop" | "mobile";

const emberColors: Array<{ id: EmberColor; label: string; stock?: number }> = [
  { id: "sage", label: "Sage", stock: 5 },
  { id: "bone", label: "Beige" },
  { id: "blush", label: "Sakura", stock: 10 },
];

const emberPrices: Record<EmberMarket, { currency: string; amount: number }> = {
  US: { currency: "USD", amount: 34.99 },
  SG: { currency: "SGD", amount: 44.99 },
};

function BrandStar() {
  return (
    <svg className="brand-star" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
      <path d="M63.8 0 63.3 35.6 98.4 27.5 70.9 49.3 100 61.7 66.5 66 70 100 52 74 43.2 88.7 38.5 71.2 8.5 85.6 28.6 57.5 0 42.5 31.5 40 22.7 9.6 46.3 30.6Z" />
    </svg>
  );
}

export default function Home() {
  const storyRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const catalogueRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [sequenceMode, setSequenceMode] = useState<SequenceMode | null>(null);
  const [activeScene, setActiveScene] = useState(0);
  const [productPresentationVisible, setProductPresentationVisible] = useState(false);
  const [selectedColor, setSelectedColor] = useState<EmberColor>("bone");
  const [selectedMarket, setSelectedMarket] = useState<EmberMarket>("US");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const checkoutCloseRef = useRef<HTMLButtonElement>(null);
  const [checkoutSuccessOpen, setCheckoutSuccessOpen] = useState(false);
  const checkoutSuccessCloseRef = useRef<HTMLButtonElement>(null);
  const [buildEmail, setBuildEmail] = useState("");
  const [buildNotice, setBuildNotice] = useState("");
  const [buildBusy, setBuildBusy] = useState(false);
  const selectedEmberColor = emberColors.find((color) => color.id === selectedColor);
  const selectedPrice = emberPrices[selectedMarket];
  useEffect(() => {
    const locale = navigator.language.toUpperCase();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (locale.endsWith("-SG") || timeZone === "Asia/Singapore") setSelectedMarket("SG");
  }, []);

  useEffect(() => {
    const returnUrl = new URL(window.location.href);
    if (returnUrl.searchParams.get("checkout") !== "success") return;

    const sessionId = returnUrl.searchParams.get("session_id");
    if (!sessionId) return;

    let cancelled = false;
    const verifyCheckout = async () => {
      try {
        const response = await fetch(`/api/checkout/status?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Accept: "application/json" },
        });
        const result = await response.json() as { paid?: boolean };
        if (!cancelled && response.ok && result.paid) {
          setCheckoutSuccessOpen(true);
          returnUrl.searchParams.delete("checkout");
          returnUrl.searchParams.delete("session_id");
          window.history.replaceState({}, "", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
        }
      } catch (error) {
        console.error("Could not verify completed checkout", error);
      }
    };

    void verifyCheckout();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checkoutSuccessOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    checkoutSuccessCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCheckoutSuccessOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [checkoutSuccessOpen]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    checkoutCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !checkoutBusy) setCheckoutOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [checkoutBusy, checkoutOpen]);

  useEffect(() => {
    const updateSequenceMode = () => {
      const mobile = window.matchMedia("(max-width: 900px)").matches
        || (navigator.maxTouchPoints > 0 && window.innerWidth <= 1180);
      const nextMode: SequenceMode = mobile ? "mobile" : "desktop";
      setSequenceMode((currentMode) => currentMode === nextMode ? currentMode : nextMode);
    };

    updateSequenceMode();
    window.addEventListener("resize", updateSequenceMode);
    window.addEventListener("orientationchange", updateSequenceMode);
    return () => {
      window.removeEventListener("resize", updateSequenceMode);
      window.removeEventListener("orientationchange", updateSequenceMode);
    };
  }, []);

  useEffect(() => {
    if (!sequenceMode) return;
    setReady(false);
    setProductPresentationVisible(false);

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
    const catalogue = catalogueRef.current;
    if (!canvas || !story || !catalogue) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const isMobile = sequenceMode === "mobile";
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

    const atSceneBoundary = (direction: number) => direction < 0 && currentScene === 0;

    const activateCatalogue = () => {
      if (transitioning || currentScene !== keyframes.length - 1) return;
      transitioning = true;
      currentScene = keyframes.length;
      setActiveScene(-1);

      lenis.scrollTo(catalogue.offsetTop, {
        duration: 2.2,
        lock: true,
        force: true,
        easing: (value: number) => value * value * value * (value * (value * 6 - 15) + 10),
        onComplete: () => {
          setActiveScene(keyframes.length);
          transitioning = false;
        },
      });
    };

    const onCatalogueRequest = () => activateCatalogue();

    const activateScene = (nextScene: number) => {
      if (transitioning || nextScene === currentScene || nextScene < 0 || nextScene >= keyframes.length) return;
      transitioning = true;
      currentScene = nextScene;
      if (nextScene < keyframes.length - 1) setProductPresentationVisible(false);
      setActiveScene(-1);

      const scrollRange = Math.max(0, story.offsetHeight - window.innerHeight);
      const sceneRange = scrollRange * 0.84;
      lenis.scrollTo(story.offsetTop + (nextScene / (keyframes.length - 1)) * sceneRange, {
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
          if (nextScene === keyframes.length - 1) setProductPresentationVisible(true);
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
      image.src = `/${frameDirectory}/frame_${String(index + 1).padStart(3, "0")}.webp?v=35`;

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
      if (!transitioning && direction > 0 && currentScene === keyframes.length - 1) {
        event.preventDefault();
        event.stopPropagation();
        activateCatalogue();
        return;
      }
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
      if (Math.abs(distance) < 28) return;
      if (!transitioning && direction > 0 && currentScene === keyframes.length - 1) {
        activateCatalogue();
        return;
      }
      if (!transitioning && atSceneBoundary(direction)) return;
      activateScene(currentScene + direction);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = ["ArrowDown", "PageDown", " "].includes(event.key) ? 1 : ["ArrowUp", "PageUp"].includes(event.key) ? -1 : 0;
      if (!direction) return;
      if (!transitioning && direction > 0 && currentScene === keyframes.length - 1) {
        event.preventDefault();
        activateCatalogue();
        return;
      }
      if (!transitioning && atSceneBoundary(direction)) return;
      event.preventDefault();
      activateScene(currentScene + direction);
    };
    story.addEventListener("wheel", onWheel, { passive: false, capture: true });
    story.addEventListener("touchstart", onTouchStart, { passive: true });
    story.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    story.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("makeable:show-catalogue", onCatalogueRequest);

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
      window.removeEventListener("makeable:show-catalogue", onCatalogueRequest);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [sequenceMode]);

  const openCheckout = () => {
    setCheckoutError("");
    setCheckoutOpen(true);
  };

  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!termsAccepted) {
      setCheckoutError("Please agree to the Terms and acknowledge the Privacy Policy.");
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          color: selectedColor,
          market: selectedMarket,
          quantity,
          termsAccepted,
          marketingConsent,
        }),
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
    window.dispatchEvent(new Event("makeable:show-catalogue"));
  };

  const handleBuildInterest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBuildBusy(true);
    setBuildNotice("");
    try {
      const response = await fetch("/api/build-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: buildEmail }),
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json() as { ok?: boolean; error?: string }
        : {};
      if (!response.ok || !result.ok) {
        throw new Error(result.error || (response.status === 404
          ? "Email signup is available on the deployed site."
          : "We could not save your email right now."));
      }
      setBuildEmail("");
      setBuildNotice("You’re on the list - we’ll share Make a Build updates with you.");
    } catch (error) {
      setBuildNotice(error instanceof Error ? error.message : "We could not save your email right now.");
    } finally {
      setBuildBusy(false);
    }
  };

  return (
    <main>
      <section className="scroll-story" id="experience" ref={storyRef}>
        <div className="experience">
          <div className="film-frame">
            <canvas ref={canvasRef} aria-label="Product reveal controlled by scrolling" />
            <div
              className="ember-color-artworks"
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}
            >
              {emberColors.map((color) => (
                <picture
                  className={`ember-color-artwork ${productPresentationVisible && selectedColor === color.id ? "is-visible" : ""}`}
                  key={color.id}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    opacity: productPresentationVisible && selectedColor === color.id ? 1 : 0,
                    visibility: productPresentationVisible && selectedColor === color.id ? "visible" : "hidden",
                    transform: "scale(1.004)",
                    transition: "opacity .5s cubic-bezier(.22, 1, .36, 1), visibility .5s",
                  }}
                >
                  <source media="(max-width: 900px)" srcSet={`/ember-${color.id}-mobile.webp`} />
                  <img
                    src={`/ember-${color.id}-desktop.webp`}
                    alt=""
                    decoding="async"
                    style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </picture>
              ))}
            </div>
            <div className={`loader ${ready ? "is-ready" : ""}`}><span /></div>
            <div className="film-shade" />
          </div>
          <div className={`intro-cue ${activeScene === 0 ? "is-visible" : ""}`} aria-hidden={activeScene !== 0}>
            <span>Scroll to explore Ember</span>
            <i aria-hidden="true">↓</i>
          </div>
          <div className={`product-ui ${productPresentationVisible ? "is-visible" : ""}`} data-selected-color={selectedColor} aria-hidden={!productPresentationVisible}>
            <img className="makeable-logo" src="/makeable-logo-tight.webp" alt="Makeable" />
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
              <div className="ember-price-row">
                <s className="ember-price-was" aria-label="Previous price: 89 dollars and 99 cents USD"><sup>$</sup>89.99</s>
                <span className="price-arrow" aria-hidden="true">→</span>
                <strong className="ember-price" aria-label="Now 34 dollars and 99 cents USD"><sup>$</sup>34.99</strong>
                <span className="discount-tag">61% off</span>
                {selectedEmberColor?.stock != null && (
                  <span className="stock-note" role="status">
                    <span className="stock-flame" aria-hidden="true">🔥</span>
                    Only {selectedEmberColor.stock} left in stock
                  </span>
                )}
              </div>
              <p className="shipping-estimate">Free shipping.</p>
              <button className="preorder-button" type="button" onClick={openCheckout}>
                Pre-order Ember<span aria-hidden="true">✦</span>
              </button>
              <button className="other-builds" type="button" onClick={showOtherBuilds}>Show me other builds.</button>
              {checkoutError && <p className="checkout-error" role="status">{checkoutError}</p>}
            </aside>
          </div>
        </div>
      </section>

      <section className="catalogue" id="builds" ref={catalogueRef} aria-label="Browse more Makeable builds">
        <div className="catalogue-artwork">
          <img className="catalogue-sheet" src="/build-catalogue-page.png?v=2" alt="What will you make? Ember, Study Desk Companion, and Plant Companion build catalogue" />
          <button
            className={`catalogue-preorder ${checkoutBusy ? "is-busy" : ""}`}
            type="button"
            onClick={openCheckout}
            aria-label="Pre-order Ember for 34 dollars and 99 cents USD"
          />
          {checkoutError && <p className="catalogue-checkout-error" role="status">{checkoutError}</p>}
        </div>
      </section>

      <SeenOnRealDesks />

      <section className="make-build-feature" id="make-a-build" aria-labelledby="make-build-title">
        <div className="make-build-copy">
          <span>Feature 02 • Coming soon</span>
          <h2 id="make-build-title">
            Make your<br />own build.
            <sup><BrandStar /></sup>
          </h2>
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
              <button type="submit" disabled={buildBusy} aria-label="Join the Make a Build updates list">
                {buildBusy ? <span className="button-spinner" aria-hidden="true" /> : "→"}
              </button>
            </div>
          </form>
          {buildNotice && <p className="build-notice" role="status">{buildNotice}</p>}
          <a className="preview-build-button" href="/pilot">
            Preview Make a Build <BrandStar />
          </a>
        </div>
        <div className="make-build-visual">
          <BuildBlueprint />
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <img className="footer-logo" src="/makeable-logo-tight.webp" alt="Makeable" />
            <strong>Anything is makeable.</strong>
          </div>
          <div className="footer-socials" aria-label="Makeable social channels">
            <a className="footer-social" href="https://www.instagram.com/makeable.build/" target="_blank" rel="noreferrer">
              <img src="/social-instagram.svg" alt="" aria-hidden="true" /><span>Instagram</span>
            </a>
            <a className="footer-social" href="https://www.linkedin.com/company/makeable-build/" target="_blank" rel="noreferrer">
              <img src="/social-linkedin.svg" alt="" aria-hidden="true" /><span>LinkedIn</span>
            </a>
            <a className="footer-social" href="https://x.com/Makeablebuild" target="_blank" rel="noreferrer">
              <img src="/social-x.svg" alt="" aria-hidden="true" /><span>X</span>
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>@Makeable 2026</span>
        </div>
      </footer>

      {checkoutOpen && (
        <div
          className="checkout-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOpen(false);
          }}
        >
          <form
            className="checkout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            onSubmit={startCheckout}
          >
            <button
              ref={checkoutCloseRef}
              className="checkout-dialog-close"
              type="button"
              aria-label="Close preorder options"
              onClick={() => setCheckoutOpen(false)}
              disabled={checkoutBusy}
            >
              ×
            </button>
            <small>Build 001 preorder</small>
            <h2 id="checkout-title">Make Ember yours.</h2>
            <p className="checkout-shipping">Free shipping. Estimated shipping: October 2026.</p>

            <div className="checkout-summary">
              <span>{selectedEmberColor?.label ?? "Beige"} Ember</span>
              <strong>{selectedPrice.currency} ${(selectedPrice.amount * quantity).toFixed(2)}</strong>
            </div>

            <fieldset className="quantity-picker">
              <legend>Quantity</legend>
              <div>
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  disabled={quantity <= 1 || checkoutBusy}
                >
                  −
                </button>
                <output aria-live="polite" aria-label={`${quantity} Ember kits`}>{quantity}</output>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity((current) => Math.min(10, current + 1))}
                  disabled={quantity >= 10 || checkoutBusy}
                >
                  +
                </button>
              </div>
              <p>Up to 10 kits per order.</p>
            </fieldset>

            <div className="checkout-consents">
              <label>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  required
                />
                <span>
                  I agree to the <a href="/terms/" target="_blank" rel="noreferrer">Terms</a> and acknowledge the <a href="/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a>.
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(event) => setMarketingConsent(event.target.checked)}
                />
                <span>Email me product news, launch updates, and occasional offers.</span>
              </label>
            </div>

            <button className="checkout-continue" type="submit" disabled={checkoutBusy || !termsAccepted}>
              {checkoutBusy ? "Opening secure checkout…" : "Continue to secure checkout"}
              <span aria-hidden="true">→</span>
            </button>
            {checkoutError && <p className="checkout-dialog-error" role="alert">{checkoutError}</p>}
          </form>
        </div>
      )}

      {checkoutSuccessOpen && (
        <div
          className="checkout-success-backdrop"
          role="presentation"
          onMouseDown={() => setCheckoutSuccessOpen(false)}
        >
          <section
            className="checkout-success-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-success-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              ref={checkoutSuccessCloseRef}
              className="checkout-success-close"
              type="button"
              aria-label="Close order confirmation"
              onClick={() => setCheckoutSuccessOpen(false)}
            >
              ×
            </button>
            <span className="checkout-success-kicker">Pre-order confirmed</span>
            <BrandStar />
            <h2 id="checkout-success-title">Ember is yours.</h2>
            <p>Your payment was received. Shipping is free and your Ember pre-order is estimated to ship in October 2026.</p>
            <button
              className="checkout-success-action"
              type="button"
              onClick={() => setCheckoutSuccessOpen(false)}
            >
              Continue exploring
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
