import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  CircleCheck,
  ExternalLink,
  FileDown,
  FolderOpen,
  Gauge,
  KeyRound,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import appIcon from "@/assets/icons/app-icon.png";

type LibraSettings = {
  enhancementsEnabled: boolean;
  pluginMarketplaceUnlock: boolean;
  pluginAutoExpand: boolean;
  modelWhitelistUnlock: boolean;
  sessionDelete: boolean;
  markdownExport: boolean;
  projectMove: boolean;
  fastButton: boolean;
  fastStartup: boolean;
  forceInstallPlugin: boolean;
  computerUseGuard: boolean;
};

type ApplyResult = {
  status: string;
  message: string;
  debugPort?: number;
  injected: boolean;
};

type FeatureKey =
  | "fastButton"
  | "fastStartup"
  | "modelWhitelistUnlock"
  | "markdownExport"
  | "projectMove"
  | "sessionDelete"
  | "pluginMarketplaceUnlock";

type Feature = {
  key: FeatureKey;
  label: string;
  detail: string;
  icon: typeof Gauge;
};

const featureGroups: Array<{
  id: string;
  title: string;
  description: string;
  features: Feature[];
}> = [
  {
    id: "model",
    title: "模型与启动",
    description: "让 Codex 的服务模式和可选模型保持可控。",
    features: [
      {
        key: "fastButton",
        label: "Fast 按钮",
        detail: "在 composer 中显示 Fast / Standard 服务模式切换。",
        icon: Gauge,
      },
      {
        key: "fastStartup",
        label: "快速启动",
        detail: "缩短 Statsig 无法访问时的等待时间。",
        icon: Play,
      },
      {
        key: "modelWhitelistUnlock",
        label: "模型白名单解锁",
        detail: "把配置与兼容端点返回的模型加入选择器。",
        icon: KeyRound,
      },
    ],
  },
  {
    id: "sessions",
    title: "会话工具",
    description: "为当前工作流补齐导出、整理和清理操作。",
    features: [
      {
        key: "markdownExport",
        label: "Markdown 导出",
        detail: "在会话菜单导出带时间戳的 Markdown 文件。",
        icon: FileDown,
      },
      {
        key: "projectMove",
        label: "会话项目移动",
        detail: "将会话移动到普通对话或其他本地项目。",
        icon: FolderOpen,
      },
      {
        key: "sessionDelete",
        label: "会话删除",
        detail: "在会话列表增加删除操作，保留原有会话管理。",
        icon: Trash2,
      },
    ],
  },
  {
    id: "extensions",
    title: "插件与权限",
    description: "按需放开插件市场和官方功能入口。",
    features: [
      {
        key: "pluginMarketplaceUnlock",
        label: "插件市场解锁",
        detail: "放宽市场过滤并显示可用的官方插件。",
        icon: PackageCheck,
      },
    ],
  },
];

function Toggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "flex h-5 w-9 shrink-0 items-center border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#4fc1ff] disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[#007acc] bg-[#007acc]"
          : "border-[#666] bg-[#3c3c3c]",
      )}
    >
      <span
        className={cn(
          "block h-3.5 w-3.5 bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function LibraEnhancePanel({ onOpenAuth }: { onOpenAuth: () => void }) {
  const [settings, setSettings] = useState<LibraSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await invoke<LibraSettings>("get_libra_enhancements"));
    } catch (error) {
      toast.error(`读取 Libra 增强设置失败: ${String(error)}`);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const enabledFeatureCount = useMemo(
    () =>
      settings
        ? featureGroups
            .flatMap((group) => group.features)
            .filter((feature) => settings[feature.key]).length
        : 0,
    [settings],
  );

  const update = async (
    key: FeatureKey | "enhancementsEnabled",
    value: boolean,
  ) => {
    try {
      setSettings(
        await invoke<LibraSettings>("set_libra_enhancement", { key, value }),
      );
    } catch (error) {
      toast.error(`保存增强设置失败: ${String(error)}`);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const result = await invoke<ApplyResult>("apply_libra_enhancements");
      if (result.injected) toast.success(result.message);
      else toast.warning(result.message);
    } catch (error) {
      toast.error(`应用增强失败: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    try {
      const path = await invoke<string>("force_install_codex_plugin");
      toast.success(`Libra 增强插件已准备: ${path}`);
      await load();
    } catch (error) {
      toast.error(`强制安装插件失败: ${String(error)}`);
    }
  };

  const toggleGuard = async (value: boolean) => {
    try {
      await invoke("set_computer_use_guard", { enabled: value });
      setSettings((current) =>
        current ? { ...current, computerUseGuard: value } : current,
      );
      toast.success(
        value
          ? "Windows Computer Use Guard 已启用"
          : "Windows Computer Use Guard 已关闭",
      );
    } catch (error) {
      toast.error(`更新 Computer Use Guard 失败: ${String(error)}`);
    }
  };

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4fc1ff]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#1e1e1e] px-4 py-4 text-[#d4d4d4] sm:px-6 sm:py-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-col gap-4 border-b border-[#3c3c3c] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#3c3c3c] bg-[#252526] p-2">
              <img
                src={appIcon}
                alt="Libra"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-xs font-medium tracking-[0.18em] text-[#4fc1ff]">
                  LIBRA / CODEX
                </span>
                <span className="flex items-center gap-1 border border-[#235a3f] bg-[#123120] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#89d185]">
                  <CircleCheck className="h-3 w-3" />
                  {settings.enhancementsEnabled ? "已启用" : "已暂停"}
                </span>
              </div>
              <h2 className="mt-1 text-xl font-semibold text-white">
                Codex 增强
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#9d9d9d]">
                用紧凑的本地控制台管理 Codex
                页面增强。设置独立保存，不改写原有配置数据。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#c5c5c5] hover:bg-[#2a2d2e] hover:text-white"
              onClick={() => void load()}
              title="刷新增强设置"
              aria-label="刷新增强设置"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-[#454545] bg-transparent text-[#d4d4d4] hover:bg-[#2a2d2e] hover:text-white"
              onClick={onOpenAuth}
            >
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              官方登录
            </Button>
            <Button
              size="sm"
              className="bg-[#0e639c] text-white hover:bg-[#1177bb]"
              onClick={() => void apply()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {busy ? "应用中" : "应用增强"}
            </Button>
          </div>
        </header>

        <section className="border border-[#3c3c3c] bg-[#252526]">
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-[#4fc1ff]" />
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-sm font-medium text-white">页面增强</h3>
                  <span className="font-mono text-xs text-[#858585]">
                    {enabledFeatureCount}/7 项已配置
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-[#9d9d9d]">
                  关闭后重新打开或刷新 Codex 页面即可恢复原样。
                </p>
              </div>
            </div>
            <Toggle
              checked={settings.enhancementsEnabled}
              label="切换 Codex 页面增强"
              onChange={() =>
                void update(
                  "enhancementsEnabled",
                  !settings.enhancementsEnabled,
                )
              }
            />
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-3">
          {featureGroups.map((group) => (
            <section
              key={group.id}
              className="border border-[#3c3c3c] bg-[#252526]"
            >
              <div className="border-b border-[#3c3c3c] px-4 py-3">
                <h3 className="text-sm font-medium text-white">
                  {group.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">
                  {group.description}
                </p>
              </div>
              <div className="divide-y divide-[#3c3c3c]">
                {group.features.map(({ key, label, detail, icon: Icon }) => {
                  const checked = settings[key];
                  return (
                    <div
                      key={key}
                      className="flex min-h-[88px] items-start gap-3 px-4 py-3"
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          checked ? "text-[#4fc1ff]" : "text-[#858585]",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">
                          {label}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">
                          {detail}
                        </p>
                      </div>
                      <Toggle
                        checked={checked}
                        disabled={!settings.enhancementsEnabled}
                        label={`切换${label}`}
                        onChange={() => void update(key, !checked)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="border border-[#3c3c3c] bg-[#252526]">
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4fc1ff]" />
                <div>
                  <h3 className="text-sm font-medium text-white">
                    Windows Computer Use Guard
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">
                    为 Codex 写入独立安全策略文件，便携版可随时撤销。
                  </p>
                </div>
              </div>
              <Toggle
                checked={settings.computerUseGuard}
                label="切换 Windows Computer Use Guard"
                onChange={() => void toggleGuard(!settings.computerUseGuard)}
              />
            </div>
          </section>

          <section className="border border-[#3c3c3c] bg-[#252526]">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4fc1ff]" />
                <div>
                  <h3 className="text-sm font-medium text-white">
                    特殊插件强制安装
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">
                    写入 Libra 插件清单，配合插件市场解锁使用。
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-[#454545] bg-transparent text-[#d4d4d4] hover:bg-[#2a2d2e] hover:text-white"
                onClick={() => void install()}
              >
                <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                {settings.forceInstallPlugin ? "插件已准备" : "安装插件"}
              </Button>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[#3c3c3c] pt-3 font-mono text-xs text-[#858585]">
          <ExternalLink className="h-3.5 w-3.5 text-[#4fc1ff]" />
          <span>需要 Codex 暴露本地调试端口。</span>
          <span className="text-[#5f5f5f]">默认 9229 / 9333 / 9222</span>
        </footer>
      </div>
    </div>
  );
}
