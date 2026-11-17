import { animate, motion } from "framer-motion";
import {
  BatteryFull,
  Check,
  FolderOpen,
  GripVertical,
  Monitor,
  Moon,
  PenLine,
  Plus,
  Sun,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
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
        height="326"
        rx="10"
        className="fill-background stroke-border"
      />
      <path d="M24 92h512" className="stroke-border" />
      <circle cx="41" cy="75" r="3" fill="#ed6a5e" />
      <circle cx="54" cy="75" r="3" fill="#f4bf50" />
      <circle cx="67" cy="75" r="3" fill="#61c454" />
      {chat && (
        <text x="280" y="79" textAnchor="middle" fontSize="11" className="fill-muted-foreground">
          Codex
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
        x="88"
        y="80"
        fontSize="13"
        fontWeight="700"
        fontStyle="italic"
        fontFamily="'New York', 'Iowan Old Style', 'Sitka Text', Cambria, Georgia, serif"
        fill={`url(#${logoId})`}
      >
        Skill Zoo
      </text>
      <rect x="202" y="64" width="156" height="22" rx="5" className="fill-muted" />
      <rect x="307" y="67" width="48" height="16" rx="3" className="fill-background" />
      {(["discover", "local", "settings"] as const).map((tab, index) => (
        <text
          key={tab}
          x={228 + index * 52}
          y="78"
          textAnchor="middle"
          fontSize="8"
          fontWeight={tab === "settings" ? "600" : "400"}
          className={tab === "settings" ? "fill-foreground" : "fill-muted-foreground"}
        >
          {t(`nav.${tab}`)}
        </text>
      ))}
      <Sun
        x="500"
        y="69"
        width="12"
        height="12"
        strokeWidth="1.5"
        className="text-muted-foreground"
      />
      <text x="47" y="124" fontSize="10" className="fill-muted-foreground">
        {t("settings.appearance")}
      </text>
      <path d="M44 132h472" className="stroke-border" />
      <rect x="44" y="141" width="472" height="62" rx="8" className="fill-card stroke-border" />
      <text x="59" y="161" fontSize="9" className="fill-muted-foreground">
        {t("settings.theme.title")}
      </text>
      <g className="text-muted-foreground" strokeWidth="1.5">
        <rect
          x="58"
          y="171"
          width="190"
          height="23"
          rx="4"
          className="fill-background stroke-border"
        />
        <rect
          x="182"
          y="174"
          width="63"
          height="17"
          rx="3"
          className="fill-foreground stroke-none"
        />
        {[Sun, Moon, Monitor].map((Icon, index) => (
          <g key={index}>
            <Icon
              x={65 + index * 62}
              y="178"
              width="9"
              height="9"
              className={index === 2 ? "text-background" : "text-muted-foreground"}
            />
            <text
              x={79 + index * 62}
              y="186"
              fontSize="8"
              stroke="none"
              className={index === 2 ? "fill-background" : "fill-muted-foreground"}
            >
              {t(`settings.theme.${["light", "dark", "system"][index]}`)}
            </text>
          </g>
        ))}
      </g>
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
      <text x="96" y="282" fontSize="8" className="fill-muted-foreground">
        {t("settings.skillCompanion.summaryDescription", { count: time >= 2.7 ? 1 : 0 })}
      </text>
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
      <text x="47" y="325" fontSize="10" className="fill-muted-foreground">
        {t("settings.agentPaths.title")}
      </text>
      <path d="M44 333h472" className="stroke-border" />
      <rect x="44" y="343" width="472" height="25" rx="6" className="fill-card stroke-border" />
      <FolderOpen
        x="59"
        y="350"
        width="11"
        height="11"
        strokeWidth="1.5"
        className="text-muted-foreground"
      />
      <text x="79" y="359" fontSize="8" className="fill-muted-foreground">
        ~/.agents/skills/
      </text>
      <EditorScene time={time} />
    </g>
  );
}

function EditorScene({ time }: { time: number }) {
  const { t } = useTranslation();
  const phrase = t("settings.skillCompanion.guide.phrase");
  const saved = time >= 2.7;
  const typed = phrase.slice(0, Math.ceil(phrase.length * progress(time, 0.3, 1.7)));
  return (
    <g data-scene="command-dialog" opacity={1 - progress(time, 3.1, 0.25)}>
      <rect x="24" y="58" width="512" height="326" rx="10" className="fill-black/20" />
      <rect x="130" y="134" width="300" height="180" rx="9" className="fill-black/10" />
      <rect
        x="130"
        y="131"
        width="300"
        height="180"
        rx="9"
        className="fill-background stroke-border"
      />
      <text x="144" y="153" fontSize="11" fontWeight="600" className="fill-foreground">
        {t("settings.skillCompanion.manageTitle")}
      </text>
      <text x="144" y="170" fontSize="7.5" className="fill-muted-foreground">
        {t("settings.skillCompanion.manageDescription")}
      </text>
      <X
        x="408"
        y="140"
        width="12"
        height="12"
        strokeWidth="1.5"
        className="text-muted-foreground"
      />
      <path d="M130 183h300" className="stroke-border" />
      <GripVertical
        x="140"
        y="204"
        width="12"
        height="12"
        strokeWidth="1.5"
        className="text-muted-foreground/40"
      />
      {!saved && (
        <rect
          x="159"
          y="194"
          width="236"
          height="51"
          rx="5"
          className="fill-background stroke-emerald-500/50"
        />
      )}
      <text x="169" y="216" fontSize="10" className="fill-foreground">
        {typed}
        {!saved && (
          <tspan opacity={Math.floor(time * 2) % 2 === 0 ? 1 : 0} className="fill-emerald-500">
            ▏
          </tspan>
        )}
      </text>
      <rect
        x="399"
        y="201"
        width="21"
        height="22"
        rx="5"
        className={!saved && time >= 2.2 ? "fill-emerald-500/15" : "fill-transparent"}
      />
      {saved ? (
        <PenLine
          x="404"
          y="206"
          width="12"
          height="12"
          strokeWidth="1.5"
          className="text-muted-foreground"
        />
      ) : (
        <>
          <Check
            x="403"
            y="206"
            width="13"
            height="13"
            strokeWidth="1.7"
            className="text-emerald-500"
          />
          <Trash2
            x="404"
            y="231"
            width="12"
            height="12"
            strokeWidth="1.5"
            className="text-muted-foreground/60"
          />
        </>
      )}
      <path d="M130 277h300" className="stroke-border" />
      <rect
        x="141"
        y="287"
        width="126"
        height="17"
        rx="4"
        className="fill-background stroke-border"
      />
      <Plus
        x="147"
        y="291"
        width="9"
        height="9"
        strokeWidth="1.5"
        className="text-muted-foreground"
      />
      <text x="161" y="299" fontSize="8" className="fill-muted-foreground">
        {t("settings.skillCompanion.add")}
      </text>
      {saved ? (
        <g>
          <text x="374" y="299" textAnchor="end" fontSize="8" className="fill-muted-foreground">
            {t("settings.skillCompanion.import")}
          </text>
          <text x="418" y="299" textAnchor="end" fontSize="8" className="fill-muted-foreground">
            {t("settings.skillCompanion.export")}
          </text>
        </g>
      ) : (
        <text x="280" y="298" fontSize="7" className="fill-muted-foreground">
          {t("settings.skillCompanion.guide.saveHint")}
        </text>
      )}
    </g>
  );
}

function TrayScene({ time, phrase }: { time: number; phrase: string }) {
  const { t } = useTranslation();
  const open = progress(time, 3.8) * (1 - progress(time, 6.15, 0.2));
  const submenu = progress(time, 4.9);
  return (
    <g>
      <rect x="12" y="12" width="536" height="27" rx="6" className="fill-muted/80 stroke-border" />
      <text x="49" y="30" fontSize="10" fontWeight="600" className="fill-foreground">
        {time >= 8.2 ? "Codex" : "Skill Zoo"}
      </text>
      <rect
        x="455"
        y="16"
        width="26"
        height="19"
        rx="4"
        className={time >= 3.8 && time < 6.15 ? "fill-foreground/10" : "fill-transparent"}
      />
      <image href={trayIcon} x="460" y="17" width="16" height="16" className="dark:invert" />
      <Wifi
        x="491"
        y="18"
        width="15"
        height="15"
        strokeWidth="1.8"
        className="text-foreground/75"
      />
      <BatteryFull
        x="514"
        y="17"
        width="19"
        height="17"
        strokeWidth="1.6"
        className="text-foreground/75"
      />
      <g data-scene="tray-menu" opacity={open} transform={`translate(0 ${(1 - open) * -4})`}>
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
        <rect
          x="315"
          y="100"
          width="204"
          height="25"
          rx="4"
          className={time >= 4.8 ? "fill-foreground" : "fill-transparent"}
        />
        <text
          x="323"
          y="116"
          fontSize="10"
          className={time >= 4.8 ? "fill-background" : "fill-foreground"}
        >
          {t("settings.skillCompanion.summary")}
        </text>
        <path
          d="m512 108-4 4 4 4"
          className={
            time >= 4.8 ? "fill-none stroke-background" : "fill-none stroke-muted-foreground"
          }
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m512 134-4 4 4 4"
          className="fill-none stroke-muted-foreground"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
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
  const sent = time >= 10.5;
  const hasDraft = time >= 9 && !sent;
  return (
    <g data-scene="chatbot" opacity={progress(time, 8, 0.4)}>
      <WindowFrame chat />
      <g data-scene="chat-context" opacity="0.8">
        <foreignObject x="80" y="110" width="415" height="30">
          <div className="flex justify-end">
            <span className="rounded-[10px] bg-muted px-3.5 py-2 text-[10px] leading-[14px] whitespace-nowrap text-muted-foreground">
              {t("settings.skillCompanion.guide.chatRequest")}
            </span>
          </div>
        </foreignObject>
        <text x="80" y="162" fontSize="9" fontWeight="600" className="fill-muted-foreground">
          Codex
        </text>
        <text x="80" y="179" fontSize="10" className="fill-muted-foreground">
          {t("settings.skillCompanion.guide.chatFindings")}
        </text>
      </g>
      {sent && (
        <>
          <g data-scene="sent-message">
            <foreignObject x="80" y="194" width="415" height="32">
              <div className="flex justify-end">
                <span className="rounded-xl bg-muted px-3.5 py-2 text-xs leading-4 whitespace-nowrap text-foreground">
                  {phrase}
                </span>
              </div>
            </foreignObject>
          </g>
          <g data-scene="reply-pending">
            <text x="80" y="246" fontSize="10" fontWeight="600" className="fill-foreground">
              Codex
            </text>
            {[0, 1, 2].map((index) => (
              <circle
                key={index}
                cx={83 + index * 9}
                cy="262"
                r="2.5"
                className="fill-muted-foreground"
                opacity={
                  0.35 + 0.65 * ((Math.sin((time - 10.5) * Math.PI * 2 - index * 0.9) + 1) / 2)
                }
              />
            ))}
          </g>
        </>
      )}
      <rect
        x="65"
        y="286"
        width="430"
        height="75"
        rx="9"
        className="fill-background stroke-border"
      />
      <text
        x="80"
        y="312"
        fontSize="12"
        className={hasDraft ? "fill-foreground" : "fill-muted-foreground"}
      >
        {hasDraft ? phrase : t("settings.skillCompanion.guide.chatPlaceholder")}
      </text>
      <g data-scene="paste-shortcut" opacity={time >= 8.9 && time < 9.7 ? 1 : 0}>
        <rect x="248" y="246" width="64" height="27" rx="6" className="fill-muted stroke-border" />
        <text x="280" y="264" textAnchor="middle" fontSize="13" className="fill-muted-foreground">
          ⌘ V
        </text>
      </g>
      <rect
        x="463"
        y="331"
        width="22"
        height="21"
        rx="5"
        className={hasDraft ? "fill-foreground" : "fill-muted"}
      />
      {sent ? (
        <rect x="470" y="338" width="8" height="8" rx="1" className="fill-foreground" />
      ) : (
        <path
          d="m470 341 4-4 4 4m-4-4v9"
          className={hasDraft ? "fill-none stroke-background" : "fill-none stroke-muted-foreground"}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}

function DemoCursor({ time }: { time: number }) {
  const close = progress(time, 2.8, 0.2);
  const tray = progress(time, 3.3, 0.4);
  const menu = progress(time, 4.3, 0.5);
  const phrase = progress(time, 5.2, 0.6);
  const chat = progress(time, 8.3, 0.5);
  const send = progress(time, 9.7, 0.5);
  const x = 409 + 5 * close + 54 * tray - 77 * menu - 210 * phrase + 19 * chat + 274 * send;
  const y = 212 - 67 * close - 119 * tray + 86 * menu + 10 * phrase + 190 * chat + 29 * send;
  const click = [2.7, 3.1, 6, 9, 10.5].some((start) => time >= start && time < start + 0.25);
  return (
    <g
      data-scene="cursor"
      opacity={time >= 2 && time < 10.9 ? 1 : 0}
      transform={`translate(${x} ${y})`}
    >
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
    const animation = animate(0, 15, {
      duration: 15,
      ease: "linear",
      repeat: Infinity,
      onUpdate: setTime,
    });
    return () => {
      animation.stop();
    };
  }, [reducedMotion]);

  const demoTime = reducedMotion ? 12 : time;
  const phrase = t("settings.skillCompanion.guide.phrase");

  return (
    <div className="flex justify-center px-6 py-6">
      <svg
        viewBox="0 0 560 408"
        className="w-full max-w-[560px] select-none"
        role="img"
        aria-label={t("settings.skillCompanion.guide.demoDescription")}
      >
        <motion.g
          opacity={
            reducedMotion ? 1 : Math.min(progress(time, 0, 0.4), 1 - progress(time, 14.4, 0.6))
          }
        >
          <SkillZooScene time={demoTime} />
          <ChatScene time={demoTime} phrase={phrase} />
          <TrayScene time={demoTime} phrase={phrase} />
          <g opacity={demoTime >= 6.2 && demoTime < 8 ? 1 : 0}>
            <rect x="160" y="204" width="240" height="40" rx="10" className="fill-black/15" />
            <rect x="160" y="201" width="240" height="40" rx="10" className="fill-foreground" />
            <circle
              cx="186"
              cy="221"
              r="9"
              className="fill-emerald-400/20 dark:fill-emerald-600/15"
            />
            <path
              d="m181 221 3.5 3.5 6.5-7"
              className="fill-none stroke-emerald-400 dark:stroke-emerald-600"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x="297"
              y="225"
              textAnchor="middle"
              fontSize="12"
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
