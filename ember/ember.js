const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const animatedImages = [...document.querySelectorAll("[data-animated-src]")];

function syncAnimationPreference() {
  const reduceMotion = motionPreference.matches;

  for (const image of animatedImages) {
    const nextSource = reduceMotion ? image.dataset.stillSrc : image.dataset.animatedSrc;
    if (nextSource && image.getAttribute("src") !== nextSource) {
      image.src = nextSource;
    }
  }
}

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

    downloadStatus.textContent = "Starting your secure download…";
    window.clearTimeout(downloadStatusTimer);
    downloadStatusTimer = window.setTimeout(() => {
      downloadStatus.textContent = "";
    }, 8000);
  });
}
