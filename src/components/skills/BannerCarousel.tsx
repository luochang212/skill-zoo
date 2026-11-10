import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { Skeleton } from "@/components/ui/skeleton";
import type { Banner } from "@/types/skills";

const ASPECT = 250 / 420;
const MAX_CARD_W = 460;
const AUTOPLAY_MS = 7000;

function getStyle(diff: number, cardW: number) {
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;

  if (abs === 0) {
    return {
      x: 0,
      scale: 0.91,
      rotateY: 0,
      z: 120,
      opacity: 1,
      zIndex: 20,
      shadow: "0 8px 24px rgba(0,0,0,0.16)",
    };
  }
  if (abs === 1) {
    return {
      x: sign * cardW * 0.54,
      scale: 0.82,
      rotateY: sign * -8,
      z: -50,
      opacity: 0.6,
      zIndex: 10,
      shadow: "0 4px 12px rgba(0,0,0,0.10)",
    };
  }
  if (abs === 2) {
    return {
      x: sign * cardW * 0.96,
      scale: 0.58,
      rotateY: sign * -5,
      z: -110,
      opacity: 0.25,
      zIndex: 5,
      shadow: "0 4px 12px rgba(0,0,0,0.08)",
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
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [current, setCurrent] = useState(0);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageResults, setImageResults] = useState<Record<string, boolean>>({});
  const [dotsHovered, setDotsHovered] = useState(false);
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
  }, [banners.length]);

  useEffect(() => {
    let ignore = false;
    async function loadUrls() {
      setLoading(true);
      setImageUrls([]);
      setCurrent(0);
      const urls = await Promise.all(
        banners.map(async (b) => {
          try {
            const path = await resolveResource(b.image);
            return convertFileSrc(path);
          } catch {
            return "";
          }
        }),
      );
      if (!ignore) {
        setImageUrls(urls);
        setLoading(false);
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

  useEffect(() => {
    if (banners.length <= 1 || reduceMotion) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % banners.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [banners.length, reduceMotion, current]);

  const goTo = useCallback((index: number) => {
    setCurrent(index);
  }, []);

  const goPrev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + banners.length) % banners.length);
  }, [banners.length]);

  const goNext = useCallback(() => {
    setCurrent((prev) => (prev + 1) % banners.length);
  }, [banners.length]);

  const cardW = Math.min(W * 0.6, MAX_CARD_W);
  const cardH = Math.round(cardW * ASPECT);

  const cardStates = useMemo(() => {
    return banners.map((banner, i) => {
      let diff = (i - current + banners.length) % banners.length;
      if (diff > banners.length / 2) diff -= banners.length;
      return { banner, index: i, diff, style: getStyle(diff, cardW) };
    });
  }, [banners, current, cardW]);

  if (!banners.length) return null;

  return (
    <div
      className="relative w-full select-none px-12"
      aria-busy={loading || imageUrls.some((url) => url && imageResults[url] === undefined)}
      style={{ height: `${Math.max(cardH + 80, 240)}px` }}
    >
      <div
        ref={containerRef}
        className="relative mx-auto w-full max-w-[960px] h-[calc(100%-32px)] overflow-hidden"
        style={{ perspective: "1400px" }}
      >
        {cardStates.map(({ banner, index: i, diff, style }) => {
          const url = imageUrls[i];
          const pending = loading || (!!url && imageResults[url] === undefined);
          const loaded = !!url && imageResults[url] === true;
          return (
            <div
              key={i}
              className="absolute top-0 rounded-xl overflow-hidden cursor-pointer bg-muted"
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
                boxShadow: loaded ? style.shadow : "none",
                transition: reduceMotion
                  ? "none"
                  : "transform 0.7s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.7s ease, box-shadow 0.7s ease",
                transformStyle: "preserve-3d",
              }}
              onClick={() => {
                if (diff === 0 && onBannerClick && banner.owner && banner.name) {
                  onBannerClick(banner.owner, banner.name, banner.branch);
                } else {
                  goTo(i);
                }
              }}
            >
              {pending && <Skeleton className="absolute inset-0 h-full w-full rounded-xl" />}
              {url && (
                <img
                  src={url}
                  alt={banner.title}
                  width={420}
                  height={250}
                  className={`w-full h-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
                  draggable={false}
                  onLoad={() => setImageResults((results) => ({ ...results, [url]: true }))}
                  onError={() => setImageResults((results) => ({ ...results, [url]: false }))}
                />
              )}
              {loaded && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              )}
              {!pending && style.zIndex >= 10 && (!banner.hideText || !loaded) && (
                <div
                  className={`absolute bottom-4 left-4 right-4 ${loaded ? "text-white" : "text-foreground"}`}
                >
                  <h3
                    className={`text-base font-semibold truncate ${loaded ? "drop-shadow-md" : ""}`}
                  >
                    {banner.title}
                  </h3>
                  <p
                    className={`text-xs truncate ${loaded ? "text-white/80 drop-shadow-md" : "text-muted-foreground"}`}
                  >
                    {banner.subtitle}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {banners.length > 1 && (
        <>
          <button
            onClick={goPrev}
            className="absolute left-0 top-[calc(50%-16px)] -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55 transition-colors z-30"
            aria-label={t("browse.previousBanner")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goNext}
            className="absolute right-0 top-[calc(50%-16px)] -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55 transition-colors z-30"
            aria-label={t("browse.nextBanner")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}

      {banners.length > 1 && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center rounded-full bg-black/20 px-1 backdrop-blur-sm z-30"
          onMouseEnter={() => setDotsHovered(true)}
          onMouseLeave={() => setDotsHovered(false)}
        >
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className="group flex h-6 items-center justify-center rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
              aria-current={i === current ? "true" : undefined}
              aria-label={t("browse.goToBanner", { index: i + 1 })}
            >
              <span
                className={`h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${
                  i === current
                    ? `w-6 ${dotsHovered ? "bg-white" : "bg-white/30"}`
                    : "w-1.5 bg-white/50 group-hover:bg-white/80"
                }`}
              >
                {i === current && (
                  <span
                    key={`${current}-${reduceMotion}`}
                    className="block h-full w-full origin-left rounded-full bg-white"
                    style={{
                      animation: !reduceMotion
                        ? `banner-progress ${AUTOPLAY_MS}ms linear both`
                        : "none",
                    }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
