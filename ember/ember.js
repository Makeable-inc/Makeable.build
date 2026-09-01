const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const animatedImages = [...document.querySelectorAll("[data-animated-src]")];
const header = document.querySelector("[data-site-header]");

function syncHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 18);
}

function setAnimation(image, shouldAnimate) {
  const nextSource = shouldAnimate ? image.dataset.animatedSrc : image.dataset.stillSrc;
  if (nextSource && image.getAttribute("src") !== nextSource) image.src = nextSource;
}

function syncAnimationPreference() {
  if (motionPreference.matches) {
    for (const image of animatedImages) setAnimation(image, false);
    return;
  }

  if (!("IntersectionObserver" in window)) {
    for (const image of animatedImages) setAnimation(image, true);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) setAnimation(entry.target, entry.isIntersecting);
  }, { rootMargin: "180px 0px", threshold: 0.01 });
  for (const image of animatedImages) observer.observe(image);
}

syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });
syncAnimationPreference();
motionPreference.addEventListener?.("change", syncAnimationPreference);

const downloadLinks = [...document.querySelectorAll("[data-download-link]")];
const downloadStatus = document.querySelector("[data-download-status]");
let downloadStatusTimer;

for (const link of downloadLinks) {
  link.addEventListener("pointerdown", () => {
    link.classList.add("is-pressed");
  });

  link.addEventListener("pointerleave", () => {
    link.classList.remove("is-pressed");
  });

  link.addEventListener("click", () => {
    link.classList.remove("is-pressed");
    if (!downloadStatus) return;

    downloadStatus.textContent = "Starting your Ember download…";
    window.clearTimeout(downloadStatusTimer);
    downloadStatusTimer = window.setTimeout(() => {
      downloadStatus.textContent = "";
    }, 8000);
  });
}
