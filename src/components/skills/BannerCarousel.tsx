import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Banner } from "@/types/skills";

const ASPECT = 250 / 420;
const MAX_CARD_W = 560;

function getStyle(diff: number, cardW: number) {
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;

  if (abs === 0) {
    return {
      x: 0,
      scale: 1,
      rotateY: 0,
      z: 120,
      opacity: 1,
      zIndex: 20,
      shadow: "0 20px 50px rgba(0,0,0,0.35)",
    };
  }
  if (abs === 1) {
    return {
      x: sign * cardW * 0.58,
      scale: 0.76,
      rotateY: sign * -28,
      z: -50,
      opacity: 0.6,
      zIndex: 10,
      shadow: "0 8px 24px rgba(0,0,0,0.2)",
    };
  }
  if (abs === 2) {
    return {
      x: sign * cardW * 0.96,
      scale: 0.58,
      rotateY: sign * -20,
      z: -110,
      opacity: 0.25,
      zIndex: 5,
      shadow: "0 4px 12px rgba(0,0,0,0.15)",
    };
  }
  return {
    x: sign * cardW * 1.32,
    scale: 0.42,
    rotateY: sign * -12,
    z: -160,
    opacity: 0,
    zIndex: 1,
    shadow: "none",
  };
}

interface BannerCarouselProps {
  banners: Banner[];
  onBannerClick?: (owner: string, name: string, branch?: string) => void;
}

export function BannerCarousel({ banners, onBannerClick }: BannerCarouselProps) {
  const [current, setCurrent] = useState(0);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isHovered, setIsHovered] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadUrls() {
      setLoading(true);
      try {
        const urls = await Promise.all(
          banners.map(async (b) => {
            const path = await resolveResource(b.image);
            return convertFileSrc(path);
          }),
        );
        if (!ignore) {
          setImageUrls(urls);
        }
      } catch {
        // Banner image load failed — proceed with empty state
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    if (banners.length > 0) {
      loadUrls();
    } else {
      setLoading(false);
    }
    return () => {
      ignore = true;
    };
  }, [banners]);

  // Auto-play
  useEffect(() => {
    if (banners.length <= 1 || isHovered) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % banners.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [banners.length, isHovered]);

  const goTo = useCallback((index: number) => {
    setCurrent(index);
  }, []);

  const goPrev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + banners.length) % banners.length);
  }, [banners.length]);

  const goNext = useCallback(() => {
    setCurrent((prev) => (prev + 1) % banners.length);
  }, [banners.length]);

  const cardW = Math.min(W * 0.72, MAX_CARD_W);
  const cardH = Math.round(cardW * ASPECT);

  const cardStates = useMemo(() => {
    return banners.map((_, i) => {
      let diff = (i - current + banners.length) % banners.length;
      if (diff > banners.length / 2) diff -= banners.length;
      return { index: i, diff, style: getStyle(diff, cardW) };
    });
  }, [banners.length, current, cardW]);

  if (!banners.length) return null;

  if (loading) {
    return (
      <div
        className="w-full mb-6 bg-muted animate-pulse rounded-xl"
        style={{ height: "clamp(260px, 42vw, 383px)" }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full mb-6 select-none overflow-hidden"
      style={{ height: `${Math.max(cardH + 50, 240)}px`, perspective: "1400px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative w-full h-full">
        {cardStates.map(({ index: i, diff, style }) => (
          <div
            key={i}
            className="absolute top-0 rounded-xl overflow-hidden cursor-pointer"
            style={{
              left: "50%",
              top: "50%",
              width: `${cardW}px`,
              height: `${cardH}px`,
              marginLeft: `${-cardW / 2}px`,
              marginTop: `${-cardH / 2}px`,
              transform: `translateX(${style.x}px) scale(${style.scale}) rotateY(${style.rotateY}deg) translateZ(${style.z}px)`,
              zIndex: style.zIndex,
              opacity: style.opacity,
              boxShadow: style.shadow,
              transition:
                "transform 0.7s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.7s ease, box-shadow 0.7s ease",
              willChange: "transform, opacity",
              transformStyle: "preserve-3d",
            }}
            onClick={() => {
              if (diff === 0 && onBannerClick && banners[i].owner && banners[i].name) {
                onBannerClick(banners[i].owner!, banners[i].name!, banners[i].branch);
              } else {
                goTo(i);
              }
            }}
          >
            <img
              src={imageUrls[i]}
              alt={banners[i].title}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            {style.zIndex >= 10 && !banners[i].hideText && (
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <h3 className="text-base font-semibold drop-shadow-md truncate">
                  {banners[i].title}
                </h3>
                <p className="text-xs text-white/80 drop-shadow-md truncate">
                  {banners[i].subtitle}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation arrows */}
      {banners.length > 1 && (
        <>
          <button
            onClick={goPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55 transition-colors z-30"
            aria-label="Previous banner"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55 transition-colors z-30"
            aria-label="Next banner"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}

      {/* Dots indicator */}
      {banners.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-30">
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current ? "w-5 bg-white" : "w-1.5 bg-white/50 hover:bg-white/70"
              }`}
              aria-label={`Go to banner ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
