import { animate, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const progress = (time: number, start: number, duration = 0.3) =>
  Math.max(0, Math.min(1, (time - start) / duration));

function WindowFrame({ chat }: { chat: boolean }) {
  return (
    <g>
      <rect x="44" y="65" width="472" height="260" rx="11" className="fill-card stroke-border" />
      <path d="M44 100h472" className="stroke-border" />
      <circle cx="61" cy="83" r="3.5" className="fill-muted-foreground/30" />
      <circle cx="74" cy="83" r="3.5" className="fill-muted-foreground/20" />
      <circle cx="87" cy="83" r="3.5" className="fill-muted-foreground/15" />
      <text x="280" y="87" textAnchor="middle" fontSize="11" className="fill-muted-foreground">
        {chat ? "Chatbot" : "Skill Zoo"}
      </text>
    </g>
  );
}

function EditorScene({ time, phrase }: { time: number; phrase: string }) {
  const { t } = useTranslation();
  const saved = time >= 2.7;
  return (
    <g opacity={1 - progress(time, 8, 0.4)}>
      <text x="65" y="127" fontSize="13" fontWeight="500" className="fill-foreground">
        {t("settings.skillCompanion.manageTitle")}
      </text>
      <text x="65" y="147" fontSize="10" className="fill-muted-foreground">
        {t("settings.skillCompanion.manageDescription")}
      </text>
      <path d="M65 164h430" className="stroke-border" />
      <g className="fill-muted-foreground/40">
        {[0, 5, 10].map((dy) => (
          <g key={dy}>
            <circle cx="70" cy={185 + dy} r="1" />
            <circle cx="75" cy={185 + dy} r="1" />
          </g>
        ))}
      </g>
      {!saved && (
        <rect
          x="87"
          y="176"
          width="363"
          height="61"
          rx="5"
          className="fill-background stroke-border"
        />
      )}
      <text x="100" y="199" fontSize="12" className="fill-foreground">
        {phrase.slice(0, Math.ceil(phrase.length * progress(time, 0.3, 1.7)))}
      </text>
      {!saved && time < 2.2 && (
        <path
          d={`M${100 + Math.ceil(phrase.length * progress(time, 0.3, 1.7)) * (phrase.length > 20 ? 6 : 12)} 188v14`}
          className="stroke-emerald-500"
        />
      )}
      <rect
        x="461"
        y="177"
        width="29"
        height="27"
        rx="5"
        className={saved ? "fill-transparent" : "fill-emerald-500/10"}
      />
      <path
        d={saved ? "m470 190 9-9 3 3-9 9-4 1Z" : "m469 190 5 5 9-10"}
        className="fill-none stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!saved && (
        <path
          d="M470 218h10m-8 0v9h6v-9m-5-3h4"
          className="fill-none stroke-muted-foreground/60"
          strokeWidth="1.3"
        />
      )}
      <path d="M44 282h472" className="stroke-border" />
      <rect
        x="59"
        y="294"
        width="137"
        height="22"
        rx="4"
        className="fill-background stroke-border"
      />
      <path d="M69 305h8m-4-4v8" className="stroke-muted-foreground" strokeWidth="1.3" />
      <text x="83" y="308" fontSize="10" className="fill-muted-foreground">
        {t("settings.skillCompanion.add")}
      </text>
      <text x="440" y="308" textAnchor="end" fontSize="10" className="fill-muted-foreground">
        {t("settings.skillCompanion.import")}
      </text>
      <text x="496" y="308" textAnchor="end" fontSize="10" className="fill-muted-foreground/50">
        {t("settings.skillCompanion.export")}
      </text>
    </g>
  );
}

function TrayScene({ time, phrase }: { time: number; phrase: string }) {
  const { t } = useTranslation();
  const open = progress(time, 3.8) * (1 - progress(time, 7.8));
  const submenu = progress(time, 4.9);
  return (
    <g>
      <rect x="12" y="12" width="536" height="27" rx="6" className="fill-muted/80 stroke-border" />
      <text x="28" y="30" fontSize="10" fontWeight="500" className="fill-muted-foreground">
        Skill Zoo
      </text>
      <rect
        x="455"
        y="16"
        width="26"
        height="19"
        rx="4"
        className={time >= 3.8 && time < 7.8 ? "fill-foreground/10" : "fill-transparent"}
      />
      <path d="m462 26 6-6 6 6-6 6Z" className="fill-none stroke-foreground" strokeWidth="1.5" />
      <path
        d="M496 23h12m-12 4h12m-12 4h8"
        className="stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <g opacity={open} transform={`translate(0 ${(1 - open) * -4})`}>
        <rect
          x="309"
          y="45"
          width="216"
          height="116"
          rx="7"
          className="fill-background stroke-border"
        />
        <text x="323" y="66" fontSize="10" className="fill-muted-foreground">
          Skill Zoo
        </text>
        <path d="M317 76h200" className="stroke-border" />
        <rect x="315" y="82" width="204" height="27" rx="4" className="fill-muted" />
        <text x="329" y="99" fontSize="11" className="fill-foreground">
          {t("settings.skillCompanion.summary")}
        </text>
        <path d="m508 92 4 4-4 4" className="fill-none stroke-muted-foreground" strokeWidth="1.3" />
        <path
          d="M329 124h61m-61 14h83"
          className="stroke-border"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <g opacity={submenu}>
          <rect
            x="53"
            y="81"
            width="251"
            height="83"
            rx="7"
            className="fill-background stroke-border"
          />
          <rect
            x="59"
            y="87"
            width="239"
            height="29"
            rx="4"
            className={time >= 5.8 ? "fill-emerald-500/15" : "fill-muted/50"}
          />
          <text x="70" y="106" fontSize="11" className="fill-foreground">
            {phrase}
          </text>
          <path d="M61 123h235" className="stroke-border" />
          <path d="M71 142h8m-4-4v8" className="stroke-muted-foreground" strokeWidth="1.3" />
          <text x="88" y="145" fontSize="10" className="fill-muted-foreground">
            {t("settings.skillCompanion.add")}
          </text>
        </g>
      </g>
    </g>
  );
}

function ChatScene({ time, phrase }: { time: number; phrase: string }) {
  const { t } = useTranslation();
  return (
    <g opacity={progress(time, 8, 0.4)}>
      <path
        d="M237 162h86m-104 16h122"
        className="stroke-border"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect
        x="65"
        y="238"
        width="430"
        height="65"
        rx="9"
        className="fill-background stroke-border"
      />
      <text
        x="80"
        y="264"
        fontSize="12"
        className={time >= 9 ? "fill-foreground" : "fill-muted-foreground"}
      >
        {time >= 9 ? phrase : t("settings.skillCompanion.guide.chatPlaceholder")}
      </text>
      <rect
        x="463"
        y="274"
        width="22"
        height="21"
        rx="5"
        className={time >= 9 ? "fill-foreground" : "fill-muted"}
      />
      <path
        d="m470 284 4-4 4 4m-4-4v9"
        className={time >= 9 ? "fill-none stroke-background" : "fill-none stroke-muted-foreground"}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function DemoCursor({ time }: { time: number }) {
  const tray = progress(time, 3, 0.6);
  const menu = progress(time, 4.3, 0.5);
  const phrase = progress(time, 5.2, 0.6);
  const chat = progress(time, 8.3, 0.5);
  const x = 476 - 8 * tray - 77 * menu - 210 * phrase - 20 * chat;
  const y = 191 - 165 * tray + 70 * menu + 7 * phrase + 160 * chat;
  const click = [2.4, 3.8, 6, 8.9].some((start) => time >= start && time < start + 0.25);
  return (
    <g opacity={time >= 2 && time < 9.5 ? 1 : 0} transform={`translate(${x} ${y})`}>
      {click && <circle r="9" className="fill-emerald-500/15 stroke-emerald-500/30" />}
      <path
        d="M0 0v16l4-4 4 7 3-1-4-7 6-1Z"
        className="fill-foreground stroke-background"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </g>
  );
}

export function CommonCommandsEmptyState() {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [time, setTime] = useState(0);
  const [hovered, setHovered] = useState(false);
  const controls = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    if (reducedMotion) return;
    const animation = animate(0, 13, {
      duration: 13,
      ease: "linear",
      repeat: Infinity,
      onUpdate: setTime,
    });
    controls.current = animation;
    return () => {
      animation.stop();
      controls.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (hovered) controls.current?.pause();
    else controls.current?.play();
  }, [hovered, reducedMotion]);

  const demoTime = reducedMotion ? 9.5 : time;
  const phrase = t("settings.skillCompanion.guide.phrase");

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-8">
      <svg
        viewBox="0 0 560 350"
        className="w-full max-w-[560px]"
        role="img"
        aria-label={t("settings.skillCompanion.guide.demoDescription")}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <motion.g
          opacity={
            reducedMotion ? 1 : Math.min(progress(time, 0, 0.4), 1 - progress(time, 12.4, 0.6))
          }
        >
          <WindowFrame chat={demoTime >= 8.2} />
          <EditorScene time={demoTime} phrase={phrase} />
          <ChatScene time={demoTime} phrase={phrase} />
          <TrayScene time={demoTime} phrase={phrase} />
          <g opacity={demoTime >= 6.5 && demoTime < 8 ? 1 : 0}>
            <rect x="184" y="332" width="192" height="17" rx="8" className="fill-emerald-500/10" />
            <text
              x="280"
              y="344"
              textAnchor="middle"
              fontSize="10"
              className="fill-emerald-600 dark:fill-emerald-400"
            >
              {t("settings.skillCompanion.guide.copied")}
            </text>
          </g>
          {!reducedMotion && <DemoCursor time={time} />}
        </motion.g>
      </svg>
    </div>
  );
}
