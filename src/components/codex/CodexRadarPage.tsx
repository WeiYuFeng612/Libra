import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, Brain, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { settingsApi } from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";

const RADAR_DATA_URL =
  "https://codexradar.com/data/intelligence-efficiency.json";
const RADAR_SITE_URL = "https://codexradar.com";
const RADAR_CONTRIBUTE_URL = "https://deng.codexradar.com";
const AUTO_REFRESH_MS = 60_000;

interface RadarPoint {
  model: string;
  effort: string;
  iq: number;
  passed?: number;
  valid_tasks?: number;
  average_price_usd?: number | null;
  average_minutes?: number | null;
  latest_graded_at?: string;
}

interface RadarPayload {
  source_updated_at: string;
  points: RadarPoint[];
}

interface FamilyMeta {
  label: string;
  color: string;
  order: number;
}

const FAMILY_META: Record<string, FamilyMeta> = {
  "gpt-5.6-sol": { label: "Sol", color: "#fbbf24", order: 0 },
  "gpt-5.6-terra": { label: "Terra", color: "#3b82f6", order: 1 },
  "gpt-5.6-luna": { label: "Luna", color: "#d6e4f7", order: 2 },
  "gpt-5.5": { label: "5.5", color: "#06d9f0", order: 3 },
  "deepseek-v4-flash": {
    label: "DeepSeek V4 Flash",
    color: "#8b5cf6",
    order: 4,
  },
};

const EFFORT_ORDER = ["ultra", "max", "xhigh", "high", "medium", "low"];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRadarPayload = (value: unknown): value is RadarPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<RadarPayload>;
  return (
    typeof payload.source_updated_at === "string" &&
    Array.isArray(payload.points) &&
    payload.points.every(
      (point) =>
        point != null &&
        typeof point === "object" &&
        typeof point.model === "string" &&
        typeof point.effort === "string" &&
        isFiniteNumber(point.iq),
    )
  );
};

const fallbackFamilyMeta = (model: string, index: number): FamilyMeta => ({
  label: model
    .replace(/^gpt-/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase()),
  color: "#94a3b8",
  order: 100 + index,
});

const formatTimestamp = (value: string, locale: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

export interface CodexRadarPageHandle {
  refresh: () => void;
}

export const CodexRadarPage = forwardRef<CodexRadarPageHandle>(
  function CodexRadarPage(_props, ref) {
    const { i18n, t } = useTranslation();
    const [data, setData] = useState<RadarPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const requestControllerRef = useRef<AbortController | null>(null);

    const refresh = useCallback(async () => {
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      setIsRefreshing(true);

      try {
        const requestUrl = `${RADAR_DATA_URL}?libra=${Date.now()}`;
        const response = await fetch(requestUrl, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload: unknown = await response.json();
        if (!isRadarPayload(payload)) {
          throw new Error(
            t("codexRadar.invalidData", {
              defaultValue: "Codex Radar 返回了无法识别的数据",
            }),
          );
        }

        setData(payload);
        setError(null);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        setError(extractErrorMessage(requestError));
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setIsRefreshing(false);
        }
      }
    }, [t]);

    useImperativeHandle(ref, () => ({ refresh: () => void refresh() }), [
      refresh,
    ]);

    useEffect(() => {
      void refresh();
      const timer = window.setInterval(() => void refresh(), AUTO_REFRESH_MS);
      const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") void refresh();
      };

      window.addEventListener("focus", refreshWhenVisible);
      document.addEventListener("visibilitychange", refreshWhenVisible);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", refreshWhenVisible);
        document.removeEventListener("visibilitychange", refreshWhenVisible);
        requestControllerRef.current?.abort();
      };
    }, [refresh]);

    const families = useMemo(() => {
      if (!data) return [];
      const models = [...new Set(data.points.map((point) => point.model))];
      const metadata = new Map(
        models.map((model, index) => [
          model,
          FAMILY_META[model] ?? fallbackFamilyMeta(model, index),
        ]),
      );

      return models
        .map((model) => ({
          model,
          meta: metadata.get(model)!,
          points: data.points
            .filter((point) => point.model === model)
            .sort((left, right) => {
              const leftIndex = EFFORT_ORDER.indexOf(left.effort);
              const rightIndex = EFFORT_ORDER.indexOf(right.effort);
              return (
                (leftIndex === -1 ? EFFORT_ORDER.length : leftIndex) -
                (rightIndex === -1 ? EFFORT_ORDER.length : rightIndex)
              );
            }),
        }))
        .filter((family) => family.points.length > 0)
        .sort((left, right) => left.meta.order - right.meta.order);
    }, [data]);

    const openExternal = useCallback(async (url: string) => {
      try {
        await settingsApi.openExternal(url);
      } catch (openError) {
        toast.error(extractErrorMessage(openError));
      }
    }, []);

    const locale = i18n.resolvedLanguage || i18n.language || "zh-CN";
    const updatedLabel = data
      ? formatTimestamp(data.source_updated_at, locale)
      : t("codexRadar.loadingTime", { defaultValue: "正在读取更新时间" });

    return (
      <div className="min-h-full overflow-x-hidden bg-[#0b1220] text-[#e5edf7]">
        <div className="mx-auto w-full max-w-[1680px] px-4 py-4">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Brain className="h-7 w-7 shrink-0 text-pink-400" />
              <h1 className="text-xl font-semibold">智力效率</h1>
              <span className="truncate text-xs font-medium text-[#a7b2c3]">
                {updatedLabel}
              </span>
              <span className="inline-flex h-5 items-center gap-1.5 border border-emerald-400/35 bg-emerald-400/10 px-2 text-[10px] font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 bg-emerald-300" />
                {t("codexRadar.live", { defaultValue: "实时" })}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="text-[#a7b2c3] hover:bg-white/10 hover:text-white"
                onClick={() => void refresh()}
                disabled={isRefreshing}
                title={t("codexRadar.refresh", { defaultValue: "刷新数据" })}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-[#a7b2c3] hover:bg-white/10 hover:text-white"
                onClick={() => void openExternal(RADAR_SITE_URL)}
                title={t("codexRadar.openWebsite", {
                  defaultValue: "打开 Codex Radar",
                })}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-y border-[#263449] py-2 text-xs text-[#a7b2c3]">
            <span>
              {t("codexRadar.communitySource", {
                defaultValue: "社区众测数据 · 最近成功更新时间见上方",
              })}
            </span>
            <button
              type="button"
              className="text-[#60a5fa] hover:underline"
              onClick={() => void openExternal(RADAR_CONTRIBUTE_URL)}
            >
              {t("codexRadar.contribute", { defaultValue: "前往贡献 →" })}
            </button>
          </div>

          {error && (
            <div
              className="mb-4 flex items-center gap-2 border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"
              role="status"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{error}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-amber-100 hover:bg-amber-300/10"
                onClick={() => void refresh()}
                title={t("codexRadar.retry", { defaultValue: "重试" })}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {!data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 12 }, (_, index) => (
                <div
                  key={index}
                  className="h-[112px] animate-pulse border border-[#35465f] bg-[#172033]"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {families.map(({ model, meta, points }) => (
                <section
                  key={model}
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
                  aria-label={meta.label}
                >
                  {points.map((point) => {
                    const price = isFiniteNumber(point.average_price_usd)
                      ? `$${point.average_price_usd.toFixed(1)}`
                      : "–";
                    const minutes = isFiniteNumber(point.average_minutes)
                      ? `${Math.round(point.average_minutes)}${t("codexRadar.minutes", { defaultValue: "分钟" })}`
                      : "–";

                    return (
                      <article
                        key={`${point.model}-${point.effort}`}
                        className="grid min-h-[112px] min-w-0 grid-cols-[minmax(0,1fr)_76px] overflow-hidden border bg-[#111827]"
                        style={{
                          borderColor: `${meta.color}70`,
                          boxShadow: `inset 0 3px 0 ${meta.color}`,
                        }}
                        title={`${meta.label} ${point.effort} · IQ ${point.iq.toFixed(1)} · ${price} · ${minutes}`}
                      >
                        <div className="flex min-w-0 flex-col justify-between gap-2 px-3 py-3">
                          <span className="min-w-0 truncate text-xs font-semibold text-[#cbd5e1]">
                            {meta.label} {point.effort}
                          </span>
                          <strong
                            className="text-[34px] font-semibold leading-none"
                            style={{ color: meta.color }}
                          >
                            {point.iq.toFixed(1)}
                          </strong>
                        </div>
                        <div
                          className="grid grid-rows-2 border-l text-center text-sm font-semibold"
                          style={{ borderColor: `${meta.color}40` }}
                        >
                          <span
                            className="flex items-center justify-center border-b px-1"
                            style={{
                              borderColor: `${meta.color}40`,
                              color: meta.color,
                            }}
                          >
                            {price}
                          </span>
                          <span
                            className="flex items-center justify-center px-1"
                            style={{ color: meta.color }}
                          >
                            {minutes}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
);

CodexRadarPage.displayName = "CodexRadarPage";
