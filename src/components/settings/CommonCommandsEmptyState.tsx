import { animate, motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import trayIcon from "../../../src-tauri/icons/tray-template.png";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const progress = (time: number, start: number, duration = 0.3) =>
  Math.max(0, Math.min(1, (time - start) / duration));

function WindowFrame({ chat = false }: { chat?: boolean }) {
  return (
    <g>
      <rect
        x="24"
        y="58"
        width="512"
        height="268"
        rx="10"
        className="fill-background stroke-border"
      />
      <path d="M24 100h512" className="stroke-border" />
      <circle cx="41" cy="79" r="3.5" fill="#ed6a5e" />
      <circle cx="54" cy="79" r="3.5" fill="#f4bf50" />
      <circle cx="67" cy="79" r="3.5" fill="#61c454" />
      {chat && (
        <text x="280" y="83" textAnchor="middle" fontSize="11" className="fill-muted-foreground">
          Chatbot
        </text>
      )}
    </g>
  );
}

function SkillZooScene({ time }: { time: number }) {
  const { t } = useTranslation();
  const logoId = useId();
  return (
    <g data-scene="skill-zoo" opacity={1 - progress(time, 8, 0.4)}>
      <defs>
        <linearGradient id={logoId}>
          {["#c882b4", "#eb5f57", "#f58b57", "#91c882", "#82aadc", "#9b82c8"].map(
            (color, index) => (
              <stop key={color} offset={index / 5} stopColor={color} />
            ),
          )}
        </linearGradient>
      </defs>
      <WindowFrame />
      <text
        x="91"
        y="85"
        fontSize="18"
        fontWeight="700"
        fontStyle="italic"
        fontFamily="'New York', 'Iowan Old Style', 'Sitka Text', Cambria, Georgia, serif"
        fill={`url(#${logoId})`}
      >
        Skill Zoo
      </text>
      <rect x="216" y="67" width="183" height="25" rx="6" className="fill-muted" />
      <rect x="336" y="70" width="60" height="19" rx="4" className="fill-background" />
      {(["discover", "local", "settings"] as const).map((tab, index) => (
        <text
          key={tab}
          x={247 + index * 60}
          y="83"
          textAnchor="middle"
          fontSize="9"
          fontWeight={tab === "settings" ? "600" : "400"}
          className={tab === "settings" ? "fill-foreground" : "fill-muted-foreground"}
        >
          {t(`nav.${tab}`)}
        </text>
      ))}
      <circle cx="505" cy="79" r="5" className="fill-none stroke-muted-foreground" />
      <path
        d="M505 70v2m0 14v2m-9-9h2m14 0h2m-15-6 2 2m8 8 2 2m-12 0 2-2m8-8 2-2"
        className="stroke-muted-foreground"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <text x="47" y="124" fontSize="10" className="fill-muted-foreground">
        {t("settings.appearance")}
      </text>
      <path d="M44 132h472" className="stroke-border" />
      <rect x="44" y="141" width="472" height="62" rx="8" className="fill-card stroke-border" />
      <text x="59" y="161" fontSize="9" className="fill-muted-foreground">
        {t("settings.theme.title")}
      </text>
      <rect
        x="424"
        y="150"
        width="77"
        height="18"
        rx="4"
        className="fill-background stroke-border"
      />
      <path
        d="m487 157 3 3 3-3M59 181h83m6 0h21"
        className="fill-none stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text x="47" y="226" fontSize="10" className="fill-muted-foreground">
        {t("settings.skillCompanion.title")}
      </text>
      <path d="M44 234h472" className="stroke-border" />
      <rect x="44" y="244" width="472" height="57" rx="8" className="fill-card stroke-border" />
      <rect
        x="57"
        y="258"
        width="27"
        height="27"
        rx="7"
        className="fill-background stroke-border"
      />
      <path
        d="M66 265h9v12h-9Zm-3 3v12h9"
        className="fill-none stroke-emerald-500"
        strokeWidth="1.2"
      />
      <text x="96" y="269" fontSize="10" className="fill-foreground">
        {t("settings.skillCompanion.summary")}
      </text>
      <path d="M96 282h120" className="stroke-border" strokeWidth="3" strokeLinecap="round" />
      <rect
        x="441"
        y="261"
        width="60"
        height="23"
        rx="5"
        className="fill-background stroke-border"
      />
      <text x="471" y="276" textAnchor="middle" fontSize="9" className="fill-muted-foreground">
        {t("settings.skillCompanion.manage")}
      </text>
      <EditorScene time={time} />
    </g>
  );
}

function EditorScene({ time }: { time: number }) {
  const { t } = useTranslation();
  const phrase = t("settings.skillCompanion.guide.phrase");
  const saved = time >= 2.7;
  return (
    <g data-scene="command-dialog" opacity={1 - progress(time, 3.1, 0.25)}>
      <rect x="24" y="58" width="512" height="268" rx="10" className="fill-black/25" />
      <rect
        x="85"
        y="112"
        width="390"
        height="194"
        rx="9"
        className="fill-black/10"
        transform="translate(0 3)"
      />
      <rect
        x="85"
        y="109"
        width="390"
        height="194"
        rx="9"
        className="fill-background stroke-border"
      />
      <text x="100" y="131" fontSize="12" fontWeight="600" className="fill-foreground">
        {t("settings.skillCompanion.manageTitle")}
      </text>
      <text x="100" y="148" fontSize="8" className="fill-muted-foreground">
        {t("settings.skillCompanion.manageDescription")}
      </text>
      <path
        d="m450 123 7 7m0-7-7 7"
        className="stroke-muted-foreground"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M85 160h390" className="stroke-border" />
      <g className="fill-muted-foreground/40">
        {[0, 5, 10].map((dy) => (
          <g key={dy}>
            <circle cx="102" cy={181 + dy} r="1" />
            <circle cx="107" cy={181 + dy} r="1" />
          </g>
        ))}
      </g>
      {!saved && (
        <rect
          x="119"
          y="170"
          width="310"
          height="50"
          rx="5"
          className="fill-background stroke-border"
        />
      )}
      <text x="131" y="192" fontSize="11" className="fill-foreground">
        {phrase.slice(0, Math.ceil(phrase.length * progress(time, 0.3, 1.7)))}
      </text>
      <rect
        x="438"
        y="174"
        width="25"
        height="25"
        rx="5"
        className={saved ? "fill-transparent" : "fill-emerald-500/10"}
      />
      <path
        d={saved ? "m445 188 8-8 3 3-8 8-4 1Z" : "m444 187 4 4 8-9"}
        className="fill-none stroke-muted-foreground"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!saved && (
        <path
          d="M445 210h10m-8 0v8h6v-8m-5-3h4"
          className="fill-none stroke-muted-foreground/60"
          strokeWidth="1.2"
        />
      )}
      <path d="M85 265h390" className="stroke-border" />
      <rect
        x="96"
        y="275"
        width="132"
        height="20"
        rx="4"
        className="fill-background stroke-border"
      />
      <path d="M105 285h7m-3.5-3.5v7" className="stroke-muted-foreground" strokeWidth="1.2" />
      <text x="118" y="288" fontSize="9" className="fill-muted-foreground">
        {t("settings.skillCompanion.add")}
      </text>
      {saved ? (
        <g>
          <text x="412" y="288" textAnchor="end" fontSize="9" className="fill-muted-foreground">
            {t("settings.skillCompanion.import")}
          </text>
          <text x="463" y="288" textAnchor="end" fontSize="9" className="fill-muted-foreground">
            {t("settings.skillCompanion.export")}
          </text>
        </g>
      ) : (
        <text x="463" y="288" textAnchor="end" fontSize="7.5" className="fill-muted-foreground">
          {t("settings.skillCompanion.editingHint")}
        </text>
      )}
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
      <text x="49" y="30" fontSize="10" fontWeight="600" className="fill-foreground">
        {time >= 8.2 ? "Chatbot" : "Skill Zoo"}
      </text>
      <rect
        x="455"
        y="16"
        width="26"
        height="19"
        rx="4"
        className={time >= 3.8 && time < 7.8 ? "fill-foreground/10" : "fill-transparent"}
      />
      <image href={trayIcon} x="460" y="17" width="16" height="16" className="dark:invert" />
      <path
        d="M492 24a7 7 0 0 1 12 0m-10 3a4 4 0 0 1 8 0m-5 3h2"
        className="fill-none stroke-muted-foreground"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <rect
        x="515"
        y="22"
        width="15"
        height="8"
        rx="2"
        className="fill-none stroke-muted-foreground"
      />
      <path
        d="M518 24h9v4h-9Zm14 0v4"
        className="fill-muted-foreground stroke-muted-foreground"
        strokeWidth="0.7"
      />
      <g opacity={open} transform={`translate(0 ${(1 - open) * -4})`}>
        <rect
          x="309"
          y="45"
          width="216"
          height="198"
          rx="7"
          className="fill-black/10"
          transform="translate(0 3)"
        />
        <rect
          x="309"
          y="43"
          width="216"
          height="198"
          rx="7"
          className="fill-background stroke-border"
        />
        <text x="323" y="63" fontSize="10" className="fill-foreground">
          {t("settings.skillCompanion.guide.tray.open")}
        </text>
        <text x="323" y="84" fontSize="10" className="fill-foreground">
          {t("settings.skillCompanion.guide.tray.website")}
        </text>
        <path d="M317 94h200" className="stroke-border" />
        <rect x="315" y="100" width="204" height="25" rx="4" className="fill-muted" />
        <text x="323" y="116" fontSize="10" className="fill-foreground">
          {t("settings.skillCompanion.summary")}
        </text>
        <path
          d="m508 108 4 4-4 4m0 18 4 4-4 4"
          className="fill-none stroke-muted-foreground"
          strokeWidth="1.2"
        />
        <text x="323" y="141" fontSize="10" className="fill-foreground">
          {t("settings.skillCompanion.guide.tray.recent")}
        </text>
        <path d="M317 153h200" className="stroke-border" />
        <text x="323" y="174" fontSize="10" className="fill-foreground">
          {t("nav.settings")}
        </text>
        <path d="M317 186h200" className="stroke-border" />
        <text x="323" y="209" fontSize="10" className="fill-foreground">
          {t("settings.skillCompanion.guide.tray.quit")}
        </text>
        <g opacity={submenu}>
          <rect
            x="53"
            y="99"
            width="251"
            height="99"
            rx="7"
            className="fill-black/10"
            transform="translate(0 3)"
          />
          <rect
            x="53"
            y="97"
            width="251"
            height="99"
            rx="7"
            className="fill-background stroke-border"
          />
          <rect
            x="59"
            y="103"
            width="239"
            height="29"
            rx="4"
            className={time >= 5.8 ? "fill-emerald-500/15" : "fill-muted/50"}
          />
          <text x="70" y="122" fontSize="11" className="fill-foreground">
            {phrase}
          </text>
          <path d="M61 140h235" className="stroke-border" />
          <text x="70" y="159" fontSize="10" className="fill-foreground">
            {t("settings.skillCompanion.guide.tray.add")}
          </text>
          <text x="70" y="182" fontSize="9" className="fill-muted-foreground">
            {t("settings.skillCompanion.guide.tray.copyHint")}
          </text>
        </g>
      </g>
    </g>
  );
}

function ChatScene({ time, phrase }: { time: number; phrase: string }) {
  const { t } = useTranslation();
  return (
    <g data-scene="chatbot" opacity={progress(time, 8, 0.4)}>
      <WindowFrame chat />
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
  const close = progress(time, 2.8, 0.2);
  const tray = progress(time, 3.3, 0.4);
  const menu = progress(time, 4.3, 0.5);
  const phrase = progress(time, 5.2, 0.6);
  const chat = progress(time, 8.3, 0.5);
  const x = 449 + 5 * close + 14 * tray - 77 * menu - 210 * phrase - 20 * chat;
  const y = 187 - 61 * close - 100 * tray + 86 * menu + 11 * phrase + 141 * chat;
  const click = [2.4, 3.1, 3.8, 6, 8.9].some((start) => time >= start && time < start + 0.25);
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

  useEffect(() => {
    if (reducedMotion) return;
    const animation = animate(0, 13, {
      duration: 13,
      ease: "linear",
      repeat: Infinity,
      onUpdate: setTime,
    });
    return () => {
      animation.stop();
    };
  }, [reducedMotion]);

  const demoTime = reducedMotion ? 9.5 : time;
  const phrase = t("settings.skillCompanion.guide.phrase");

  return (
    <div className="flex justify-center px-6 py-8">
      <svg
        viewBox="0 0 560 350"
        className="w-full max-w-[560px]"
        role="img"
        aria-label={t("settings.skillCompanion.guide.demoDescription")}
      >
        <motion.g
          opacity={
            reducedMotion ? 1 : Math.min(progress(time, 0, 0.4), 1 - progress(time, 12.4, 0.6))
          }
        >
          <SkillZooScene time={demoTime} />
          <ChatScene time={demoTime} phrase={phrase} />
          <TrayScene time={demoTime} phrase={phrase} />
          <g opacity={demoTime >= 6.5 && demoTime < 8 ? 1 : 0}>
            <rect x="153" y="191" width="254" height="42" rx="10" className="fill-black/15" />
            <rect x="153" y="188" width="254" height="42" rx="10" className="fill-foreground" />
            <circle
              cx="181"
              cy="209"
              r="10"
              className="fill-emerald-400/20 dark:fill-emerald-600/15"
            />
            <path
              d="m176 209 3.5 3.5 6.5-7"
              className="fill-none stroke-emerald-400 dark:stroke-emerald-600"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x="297"
              y="214"
              textAnchor="middle"
              fontSize="13"
              fontWeight="500"
              className="fill-background"
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
