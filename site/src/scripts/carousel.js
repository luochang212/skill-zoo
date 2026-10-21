export function initCarousel() {
  // ── 3D Cover Flow carousel ──
  const ASPECT = 2200 / 1400;
  const isMobile = () => window.innerWidth < 768;
  const carousel = document.getElementById("carousel");
  const wrapper = document.getElementById("carousel-wrapper");
  const dotsContainer = document.getElementById("carousel-dots");
  let current = 0,
    carouselTimer;

  const cards = [...carousel.querySelectorAll('.carousel-card')].map((card, i) => {
    const dot = dotsContainer.children[i];
    card.addEventListener('click', () => {
      if (i !== current) goTo(i);
    });
    dot.addEventListener('click', () => goTo(i));
    return { card, dot };
  });
  carousel.classList.add('carousel-ready');

  function getStyle(diff, cardW, mobile) {
    const abs = Math.abs(diff);
    const sign = diff < 0 ? -1 : 1;
    if (abs === 0) {
      return {
        x: 0,
        scale: 1,
        ry: 0,
        z: 120,
        opacity: 1,
        zIdx: 20,
        shadow:
          "0 1px 3px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.08), 0 22px 50px rgba(0,0,0,0.12)",
      };
    }
    if (abs === 1) {
      return {
        x: sign * cardW * (mobile ? 0.26 : 0.32),
        scale: mobile ? 0.72 : 0.78,
        ry: sign * (mobile ? -12 : -22),
        z: -50,
        opacity: mobile ? 0.4 : 0.55,
        zIdx: 10,
        shadow: "0 2px 6px rgba(0,0,0,0.05), 0 6px 18px rgba(0,0,0,0.07)",
      };
    }
    return {
      x: sign * cardW * (mobile ? 0.36 : 0.48),
      scale: mobile ? 0.55 : 0.62,
      ry: sign * (mobile ? -8 : -15),
      z: -110,
      opacity: 0,
      zIdx: 5,
      shadow: "0 2px 8px rgba(0,0,0,0.03)",
    };
  }

  function carouselLayout() {
    const n = cards.length;
    const mobile = isMobile();
    const desktopCardMax = window.innerWidth >= 1600 ? 1120 : 720;
    const cardW = Math.min(
      wrapper.clientWidth * (mobile ? 0.76 : 0.78),
      mobile ? 620 : desktopCardMax,
    );
    const cardH = cardW / ASPECT;
    wrapper.style.height = `${Math.max(cardH + (mobile ? 60 : 88), 280)}px`;
    cards.forEach(({ card, dot }, i) => {
      let diff = (i - current + n) % n;
      if (diff > n / 2) diff -= n;
      const s = getStyle(diff, cardW, mobile);
      card.style.width = `${cardW}px`;
      card.style.marginLeft = `${-cardW / 2}px`;
      card.style.marginTop = `${-cardH / 2}px`;
      card.style.transform = `translateX(${s.x}px) scale(${s.scale}) rotateY(${s.ry}deg) translateZ(${s.z}px)`;
      card.style.zIndex = s.zIdx;
      card.style.opacity = s.opacity;
      card.style.boxShadow = s.shadow;
      dot.classList.toggle("active", i === current);
    });
  }

  function goTo(idx) {
    clearInterval(carouselTimer);
    current = idx;
    carouselLayout();
    carouselTimer = setInterval(
      () => goTo((current + 1) % cards.length),
      8000,
    );
  }

  carouselLayout();
  carouselTimer = setInterval(
    () => goTo((current + 1) % cards.length),
    8000,
  );

  let carouselResizePending = false;
  window.addEventListener("resize", () => {
    if (!carouselResizePending) {
      carouselResizePending = true;
      requestAnimationFrame(() => {
        carouselLayout();
        carouselResizePending = false;
      });
    }
  });

  // Carousel touch/swipe
  let touchStartX = 0,
    touchStartY = 0,
    touchMoved = false;
  wrapper.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    },
    { passive: true },
  );
  wrapper.addEventListener(
    "touchmove",
    (e) => {
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > dy) {
        touchMoved = true;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  wrapper.addEventListener("touchend", (e) => {
    if (!touchMoved) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) < 50) return;
    goTo(
      dx < 0
        ? (current + 1) % cards.length
        : (current - 1 + cards.length) % cards.length,
    );
  });

}
