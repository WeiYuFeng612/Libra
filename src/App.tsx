import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Settings,
  Minus,
  Maximize2,
  Minimize2,
  X,
  Book,
  Brain,
  Wrench,
  History,
  BarChart2,
  Radar,
  ExternalLink,
  Download,
  FolderArchive,
  Search,
  FolderOpen,
  KeyRound,
  Shield,
  Cpu,
  LayoutDashboard,
  RefreshCw,
  WandSparkles,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Provider, VisibleApps } from "@/types";
import type { EnvConflict } from "@/types/env";
import { proxyKeys, useProvidersQuery, useSettingsQuery } from "@/lib/query";
import {
  providersApi,
  settingsApi,
  type AppId,
  type ProviderSwitchEvent,
} from "@/lib/api";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useProviderActions } from "@/hooks/useProviderActions";
import { openclawKeys, useOpenClawHealth } from "@/hooks/useOpenClaw";
import { hermesKeys, useOpenHermesWebUI } from "@/hooks/useHermes";
import { hermesApi } from "@/lib/api/hermes";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useUsageCacheBridge } from "@/hooks/useUsageCacheBridge";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import { useScanUnmanagedSkills } from "@/hooks/useSkills";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { deepClone } from "@/utils/deepClone";
import { cn } from "@/lib/utils";
import {
  isWindows,
  isLinux,
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
} from "@/lib/platform";
import { AppSwitcher } from "@/components/AppSwitcher";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { ProviderList } from "@/components/providers/ProviderList";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { UpdateBadge } from "@/components/UpdateBadge";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import { ProxyToggle } from "@/components/proxy/ProxyToggle";
import { ClaudeDesktopRouteToggle } from "@/components/proxy/ClaudeDesktopRouteToggle";
import { FailoverToggle } from "@/components/proxy/FailoverToggle";
import UsageScriptModal from "@/components/UsageScriptModal";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import {
  SkillsPage,
  getSkillsPageHeaderActions,
  type SkillsPageSource,
} from "@/components/skills/SkillsPage";
import UnifiedSkillsPanel from "@/components/skills/UnifiedSkillsPanel";
import { DeepLinkImportDialog } from "@/components/DeepLinkImportDialog";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { UniversalProviderPanel } from "@/components/universal";
import { McpIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import WorkspaceFilesPanel from "@/components/workspace/WorkspaceFilesPanel";
import EnvPanel from "@/components/openclaw/EnvPanel";
import ToolsPanel from "@/components/openclaw/ToolsPanel";
import AgentsDefaultsPanel from "@/components/openclaw/AgentsDefaultsPanel";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesMemoryPanel from "@/components/hermes/HermesMemoryPanel";
import { LibraEnhancePanel } from "@/components/codex/LibraEnhancePanel";
import {
  CodexRadarPage,
  type CodexRadarPageHandle,
} from "@/components/codex/CodexRadarPage";
import appIcon from "@/assets/icons/app-icon.png";

type View =
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "skillsDiscovery"
  | "mcp"
  | "agents"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawAgents"
  | "hermesMemory"
  | "codexRadar"
  | "codexEnhance";

interface SyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

const DEFAULT_DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px
const HEADER_HEIGHT = 34; // px

const STORAGE_KEY = "libra-last-app";
const LEGACY_STORAGE_KEY = "cc-switch-last-app";
const VALID_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
];

const getInitialApp = (): AppId => {
  const legacySaved = localStorage.getItem(LEGACY_STORAGE_KEY) as AppId | null;
  if (
    !localStorage.getItem(STORAGE_KEY) &&
    legacySaved &&
    VALID_APPS.includes(legacySaved)
  ) {
    localStorage.setItem(STORAGE_KEY, legacySaved);
    return legacySaved;
  }
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && VALID_APPS.includes(saved)) {
    return saved;
  }
  return "claude";
};

const VIEW_STORAGE_KEY = "libra-last-view";
const LEGACY_VIEW_STORAGE_KEY = "cc-switch-last-view";
const VALID_VIEWS: View[] = [
  "providers",
  "settings",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "agents",
  "universal",
  "sessions",
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawAgents",
  "hermesMemory",
  "codexRadar",
  "codexEnhance",
];

const getInitialView = (): View => {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
  const legacySaved = localStorage.getItem(
    LEGACY_VIEW_STORAGE_KEY,
  ) as View | null;
  if (
    !localStorage.getItem(VIEW_STORAGE_KEY) &&
    legacySaved &&
    VALID_VIEWS.includes(legacySaved)
  ) {
    localStorage.setItem(VIEW_STORAGE_KEY, legacySaved);
    return legacySaved;
  }
  if (saved && VALID_VIEWS.includes(saved)) {
    return saved;
  }
  return "providers";
};

function App() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const sharedFeatureApp: AppId =
    activeApp === "claude-desktop" ? "claude" : activeApp;
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [skillsDiscoverySource, setSkillsDiscoverySource] =
    useState<SkillsPageSource>("repos");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState("general");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isRestartingChatGPT, setIsRestartingChatGPT] = useState(false);
  const [isRestartAfterSwitchOpen, setIsRestartAfterSwitchOpen] =
    useState(false);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  const { data: settingsData } = useSettingsQuery();
  const useAppWindowControls =
    isLinux() && (settingsData?.useAppWindowControls ?? false);
  const dragBarHeight = useAppWindowControls ? 32 : DEFAULT_DRAG_BAR_HEIGHT;
  const contentTopOffset = dragBarHeight + HEADER_HEIGHT;
  const visibleApps: VisibleApps = settingsData?.visibleApps ?? {
    claude: true,
    "claude-desktop": true,
    codex: true,
    gemini: true,
    grokbuild: true,
    opencode: true,
    openclaw: true,
    hermes: true,
  };

  const getFirstVisibleApp = (): AppId => {
    if (visibleApps.claude) return "claude";
    if (visibleApps["claude-desktop"]) return "claude-desktop";
    if (visibleApps.codex) return "codex";
    if (visibleApps.gemini) return "gemini";
    if (visibleApps.grokbuild) return "grokbuild";
    if (visibleApps.opencode) return "opencode";
    if (visibleApps.openclaw) return "openclaw";
    if (visibleApps.hermes) return "hermes";
    return "claude"; // fallback
  };

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  // Fallback from sessions view when switching to an app without session support
  useEffect(() => {
    if (
      currentView === "sessions" &&
      sharedFeatureApp !== "claude" &&
      sharedFeatureApp !== "codex" &&
      sharedFeatureApp !== "grokbuild" &&
      sharedFeatureApp !== "opencode" &&
      sharedFeatureApp !== "openclaw" &&
      sharedFeatureApp !== "gemini" &&
      sharedFeatureApp !== "hermes"
    ) {
      setCurrentView("providers");
    }
  }, [sharedFeatureApp, currentView]);

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<EnvConflict[]>([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);

  useUsageCacheBridge();

  const promptPanelRef = useRef<any>(null);
  const mcpPanelRef = useRef<any>(null);
  const skillsPageRef = useRef<any>(null);
  const unifiedSkillsPanelRef = useRef<any>(null);
  const codexRadarRef = useRef<CodexRadarPageHandle>(null);
  // 订阅未管理 Skill 的共享缓存（实际扫描由 UnifiedSkillsPanel 进入页面时触发）。
  // 这里 enabled 默认 false，仅用于「导入」按钮的绿点提示，不主动发起扫描。
  const { data: unmanagedSkills } = useScanUnmanagedSkills();
  const hasUnmanagedSkills = (unmanagedSkills?.length ?? 0) > 0;
  const addActionButtonClass = "shrink-0";

  const {
    isRunning: isProxyRunning,
    takeoverStatus,
    status: proxyStatus,
  } = useProxyStatus();
  const isCurrentAppTakeoverActive = takeoverStatus?.[activeApp] || false;
  const activeProviderId = useMemo(() => {
    const target = proxyStatus?.active_targets?.find(
      (t) => t.app_type === activeApp,
    );
    return target?.provider_id;
  }, [proxyStatus?.active_targets, activeApp]);

  const { data, isLoading, refetch } = useProvidersQuery(activeApp, {
    isProxyRunning,
  });
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const isOpenClawView =
    activeApp === "openclaw" &&
    (currentView === "providers" ||
      currentView === "workspace" ||
      currentView === "sessions" ||
      currentView === "openclawEnv" ||
      currentView === "openclawTools" ||
      currentView === "openclawAgents");
  const { data: openclawHealthWarnings = [] } =
    useOpenClawHealth(isOpenClawView);
  const hasSkillsSupport = sharedFeatureApp !== "openclaw";
  const hasSessionSupport =
    sharedFeatureApp === "claude" ||
    sharedFeatureApp === "codex" ||
    sharedFeatureApp === "grokbuild" ||
    sharedFeatureApp === "opencode" ||
    sharedFeatureApp === "openclaw" ||
    sharedFeatureApp === "gemini" ||
    sharedFeatureApp === "hermes";
  const currentViewTitle = (() => {
    switch (currentView) {
      case "providers":
        return t("provider.title", { defaultValue: "Providers" });
      case "settings":
        return t("settings.title");
      case "prompts":
        return t("prompts.title", { appName: t(`apps.${sharedFeatureApp}`) });
      case "skills":
      case "skillsDiscovery":
        return t("skills.title");
      case "mcp":
        return t("mcp.unifiedPanel.title");
      case "agents":
        return t("agents.title");
      case "universal":
        return t("universalProvider.title", {
          defaultValue: "Unified providers",
        });
      case "sessions":
        return t("sessionManager.title");
      case "workspace":
        return t("workspace.title");
      case "openclawEnv":
        return t("openclaw.env.title");
      case "openclawTools":
        return t("openclaw.tools.title");
      case "openclawAgents":
        return t("openclaw.agents.title");
      case "hermesMemory":
        return t("hermes.memory.title");
      case "codexRadar":
        return "Codex Radar";
      case "codexEnhance":
        return "Libra Codex+";
    }
  })();

  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(
    activeApp,
    isProxyRunning,
    isProxyRunning && isCurrentAppTakeoverActive,
  );

  const disableOmoMutation = useDisableCurrentOmo();
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim();
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const handleRestartChatGPT = async () => {
    if (isRestartingChatGPT) return;
    setIsRestartingChatGPT(true);
    try {
      await settingsApi.restartChatGPT();
      toast.success(t("header.restartChatGPTSuccess"));
    } catch (error) {
      toast.error(t("header.restartChatGPTFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    } finally {
      setIsRestartingChatGPT(false);
    }
  };

  const handleProviderSwitch = async (provider: Provider) => {
    const switched = await switchProvider(provider);
    if (switched && activeApp === "codex") {
      setIsRestartAfterSwitchOpen(true);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupListener = async () => {
      try {
        const off = await providersApi.onSwitched(
          async (event: ProviderSwitchEvent) => {
            if (event.appType === activeApp) {
              await refetch();
            }
          },
        );
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
      } catch (error) {
        console.error("[App] Failed to subscribe provider switch event", error);
      }
    };

    void setupListener();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [activeApp, refetch]);

  useTauriEvent("universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to update tray menu", error);
    }
  });

  // 应用项目后刷新相关缓存（providers 由既有 provider-switched 监听承接；
  // proxy 状态由后端直接改 DB，不走 mutation，必须显式刷新）
  useTauriEvent("profile-applied", async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({
      queryKey: proxyKeys.takeoverStatus,
    });
    await queryClient.invalidateQueries({ queryKey: proxyKeys.status });
    await queryClient.invalidateQueries({
      queryKey: ["providers", "claude-desktop"],
    });
  });

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "webdav-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.webdavSync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "s3-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.s3Sync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<{ appType: string; providerName: string }>(
    "proxy-official-warning",
    (payload) => {
      toast.warning(
        t("notifications.proxyOfficialWarning", {
          name: payload.providerName,
          defaultValue: `当前供应商 ${payload.providerName} 是官方供应商，建议切换到第三方供应商后再使用代理接管`,
        }),
        { duration: 8000 },
      );
    },
  );

  useEffect(() => {
    let active = true;
    let unlistenResize: (() => void) | undefined;

    const setupWindowStateSync = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const syncWindowMaximizedState = async () => {
          const maximized = await currentWindow.isMaximized();
          if (active) {
            setIsWindowMaximized(maximized);
          }
        };

        await syncWindowMaximizedState();
        unlistenResize = await currentWindow.onResized(() => {
          void syncWindowMaximizedState();
        });
      } catch (error) {
        console.error("[App] Failed to sync window maximized state", error);
      }
    };

    void setupWindowStateSync();
    return () => {
      active = false;
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    // settingsData 未加载时跳过，避免用 fallback false 覆盖 Rust 侧已设好的装饰状态
    if (!settingsData) return;

    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };

    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    checkEnvOnStartup();
  }, []);

  useEffect(() => {
    const checkMigration = async () => {
      try {
        const migrated = await invoke<boolean>("get_migration_result");
        if (migrated) {
          toast.success(
            t("migration.success", { defaultValue: "配置迁移成功" }),
            { closeButton: true },
          );
        }
      } catch (error) {
        console.error("[App] Failed to check migration result:", error);
      }
    };

    checkMigration();
  }, [t]);

  useEffect(() => {
    const checkSkillsMigration = async () => {
      try {
        const result = await invoke<{ count: number; error?: string } | null>(
          "get_skills_migration_result",
        );
        if (result?.error) {
          toast.error(t("migration.skillsFailed"), {
            description: t("migration.skillsFailedDescription"),
            closeButton: true,
          });
          console.error("[App] Skills SSOT migration failed:", result.error);
          return;
        }
        if (result && result.count > 0) {
          toast.success(t("migration.skillsSuccess", { count: result.count }), {
            closeButton: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["skills"] });
        }
      } catch (error) {
        console.error("[App] Failed to check skills migration result:", error);
      }
    };

    checkSkillsMigration();
  }, [t, queryClient]);

  useEffect(() => {
    const checkEnvOnSwitch = async () => {
      try {
        const conflicts = await checkEnvConflicts(activeApp);

        if (conflicts.length > 0) {
          setEnvConflicts((prev) => {
            const existingKeys = new Set(
              prev.map((c) => `${c.varName}:${c.sourcePath}`),
            );
            const newConflicts = conflicts.filter(
              (c) => !existingKeys.has(`${c.varName}:${c.sourcePath}`),
            );
            return [...prev, ...newConflicts];
          });
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    checkEnvOnSwitch();
  }, [activeApp]);

  const currentViewRef = useRef(currentView);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCurrentView("settings");
        return;
      }

      if (event.key !== "Escape" || event.defaultPrevented) return;

      if (document.body.style.overflow === "hidden") return;

      const view = currentViewRef.current;
      if (view === "providers") return;

      if (isTextEditableTarget(event.target)) return;

      event.preventDefault();
      setCurrentView(view === "skillsDiscovery" ? "skills" : "providers");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const handleEditProvider = async ({
    provider,
    originalId,
  }: {
    provider: Provider;
    originalId?: string;
  }) => {
    await updateProvider(provider, originalId);
    setEditingProvider(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      await providersApi.removeFromLiveConfig(provider.id, activeApp);
      // Invalidate queries to refresh the isInConfig state
      if (activeApp === "opencode") {
        await queryClient.invalidateQueries({
          queryKey: ["opencodeLiveProviderIds"],
        });
      } else if (activeApp === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds,
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
      } else if (activeApp === "hermes") {
        await queryClient.invalidateQueries({
          queryKey: hermesKeys.liveProviderIds,
        });
      }
      toast.success(
        t("notifications.removeFromConfigSuccess", {
          defaultValue: "已从配置移除",
        }),
        { closeButton: true },
      );
    } else {
      await deleteProvider(provider.id);
    }
    setConfirmAction(null);
  };

  const generateUniqueProviderCopyKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    const newSortIndex =
      provider.sortIndex !== undefined ? provider.sortIndex + 1 : undefined;

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
      addToLive?: boolean;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: deepClone(provider.settingsConfig),
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      sortIndex: newSortIndex, // 复制原 sortIndex + 1
      meta: provider.meta ? deepClone(provider.meta) : undefined,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (
      activeApp === "opencode" ||
      activeApp === "openclaw" ||
      activeApp === "hermes"
    ) {
      let liveProviderIds: string[] = [];
      try {
        liveProviderIds =
          activeApp === "opencode"
            ? await queryClient.ensureQueryData({
                queryKey: ["opencodeLiveProviderIds"],
                queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
              })
            : activeApp === "openclaw"
              ? await queryClient.ensureQueryData({
                  queryKey: openclawKeys.liveProviderIds,
                  queryFn: () => providersApi.getOpenClawLiveProviderIds(),
                })
              : await queryClient.ensureQueryData({
                  queryKey: hermesKeys.liveProviderIds,
                  queryFn: () => providersApi.getHermesLiveProviderIds(),
                });
      } catch (error) {
        console.error(
          "[App] Failed to load live provider IDs for duplication",
          error,
        );
        const errorMessage = extractErrorMessage(error);
        toast.error(
          t("provider.duplicateLiveIdsLoadFailed", {
            defaultValue: "读取配置中的供应商标识失败，请先修复配置后再试",
          }) + (errorMessage ? `: ${errorMessage}` : ""),
        );
        return;
      }
      const existingKeys = Array.from(
        new Set([...Object.keys(providers), ...liveProviderIds]),
      );
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        existingKeys,
      );
      duplicatedProvider.addToLive = false;
    }

    if (provider.sortIndex !== undefined) {
      const updates = Object.values(providers)
        .filter(
          (p) =>
            p.sortIndex !== undefined &&
            p.sortIndex >= newSortIndex! &&
            p.id !== provider.id,
        )
        .map((p) => ({
          id: p.id,
          sortIndex: p.sortIndex! + 1,
        }));

      if (updates.length > 0) {
        try {
          await providersApi.updateSortOrder(updates, activeApp);
        } catch (error) {
          console.error("[App] Failed to update sort order", error);
          toast.error(
            t("provider.sortUpdateFailed", {
              defaultValue: "排序更新失败",
            }),
          );
          return; // 如果排序更新失败，不继续添加
        }
      }
    }

    await addProvider(duplicatedProvider);
  };

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      const selectedDir = await settingsApi.pickDirectory();
      if (!selectedDir) {
        return;
      }

      await providersApi.openTerminal(provider.id, activeApp, {
        cwd: selectedDir,
      });
      toast.success(
        t("provider.terminalOpened", {
          defaultValue: "终端已打开",
        }),
      );
    } catch (error) {
      console.error("[App] Failed to open terminal", error);
      const errorMessage = extractErrorMessage(error);
      toast.error(
        t("provider.terminalOpenFailed", {
          defaultValue: "打开终端失败",
        }) + (errorMessage ? `: ${errorMessage}` : ""),
      );
    }
  };

  const handleImportSuccess = async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: ["providers"],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers"],
        type: "all",
      });
    } catch (error) {
      console.error("[App] Failed to refresh providers after import", error);
      await refetch();
    }
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to refresh tray menu", error);
    }
  };

  const notifyWindowControlError = (error: unknown) => {
    toast.error(
      t("notifications.windowControlFailed", {
        defaultValue: "窗口控制失败：{{error}}",
        error: extractErrorMessage(error),
      }),
    );
  };

  const handleWindowMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("[App] Failed to minimize window", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowToggleMaximize = async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.toggleMaximize();
      setIsWindowMaximized(await currentWindow.isMaximized());
    } catch (error) {
      console.error("[App] Failed to toggle maximize", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("[App] Failed to close window", error);
      notifyWindowControlError(error);
    }
  };

  const handleOpenSkillsDiscovery = () => {
    setSkillsDiscoverySource("repos");
    setCurrentView("skillsDiscovery");
  };

  const renderContent = () => {
    const content = (() => {
      switch (currentView) {
        case "settings":
          return (
            <SettingsPage
              open={true}
              onOpenChange={() => setCurrentView("providers")}
              onImportSuccess={handleImportSuccess}
              defaultTab={settingsDefaultTab}
            />
          );
        case "prompts":
          return (
            <PromptPanel
              ref={promptPanelRef}
              open={true}
              onOpenChange={() => setCurrentView("providers")}
              appId={sharedFeatureApp}
            />
          );
        case "hermesMemory":
          return <HermesMemoryPanel />;
        case "codexRadar":
          return <CodexRadarPage ref={codexRadarRef} />;
        case "codexEnhance":
          return (
            <LibraEnhancePanel
              onOpenAuth={() => {
                setSettingsDefaultTab("auth");
                setCurrentView("settings");
              }}
            />
          );
        case "skills":
          return (
            <UnifiedSkillsPanel
              ref={unifiedSkillsPanelRef}
              onOpenDiscovery={handleOpenSkillsDiscovery}
              currentApp={
                sharedFeatureApp === "openclaw" ? "claude" : sharedFeatureApp
              }
            />
          );
        case "skillsDiscovery":
          return (
            <SkillsPage
              ref={skillsPageRef}
              initialApp={
                sharedFeatureApp === "openclaw" ? "claude" : sharedFeatureApp
              }
              onSourceChange={setSkillsDiscoverySource}
            />
          );
        case "mcp":
          return (
            <UnifiedMcpPanel
              ref={mcpPanelRef}
              onOpenChange={() => setCurrentView("providers")}
            />
          );
        case "agents":
          return (
            <AgentsPanel onOpenChange={() => setCurrentView("providers")} />
          );
        case "universal":
          return (
            <div className="px-6 pt-4">
              <UniversalProviderPanel />
            </div>
          );

        case "sessions":
          return (
            <SessionManagerPage
              key={sharedFeatureApp}
              appId={sharedFeatureApp}
            />
          );
        case "workspace":
          return <WorkspaceFilesPanel />;
        case "openclawEnv":
          return <EnvPanel />;
        case "openclawTools":
          return <ToolsPanel />;
        case "openclawAgents":
          return <AgentsDefaultsPanel />;
        default:
          return (
            <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-12 px-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeApp}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <ProviderList
                      providers={providers}
                      currentProviderId={currentProviderId}
                      appId={activeApp}
                      isLoading={isLoading}
                      isProxyRunning={isProxyRunning}
                      isProxyTakeover={
                        isProxyRunning && isCurrentAppTakeoverActive
                      }
                      activeProviderId={activeProviderId}
                      onSwitch={handleProviderSwitch}
                      onEdit={(provider) => {
                        setEditingProvider(provider);
                      }}
                      onDelete={(provider) =>
                        setConfirmAction({ provider, action: "delete" })
                      }
                      onRemoveFromConfig={
                        activeApp === "opencode" ||
                        activeApp === "openclaw" ||
                        activeApp === "hermes"
                          ? (provider) =>
                              setConfirmAction({ provider, action: "remove" })
                          : undefined
                      }
                      onDisableOmo={
                        activeApp === "opencode" ? handleDisableOmo : undefined
                      }
                      onDisableOmoSlim={
                        activeApp === "opencode"
                          ? handleDisableOmoSlim
                          : undefined
                      }
                      onDuplicate={handleDuplicateProvider}
                      onConfigureUsage={setUsageProvider}
                      onOpenWebsite={handleOpenWebsite}
                      onOpenTerminal={
                        activeApp === "claude" ? handleOpenTerminal : undefined
                      }
                      onCreate={() => setIsAddOpen(true)}
                      onSetAsDefault={
                        activeApp === "openclaw"
                          ? setAsDefaultModel
                          : activeApp === "hermes"
                            ? switchProvider
                            : undefined
                      }
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          );
      }
    })();

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          className="flex-1 min-h-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    );
  };

  const sidebarActionClass =
    "libra-sidebar-action w-full justify-start gap-2 px-2.5 text-left";

  const renderSidebarContent = () => {
    if (currentView === "providers") {
      return (
        <>
          <section className="libra-sidebar-section">
            <p className="libra-sidebar-section-label">
              {t("provider.appSelection", { defaultValue: "Applications" })}
            </p>
            <AppSwitcher
              activeApp={activeApp}
              onSwitch={setActiveApp}
              visibleApps={visibleApps}
            />
          </section>

          <section className="libra-sidebar-section space-y-2">
            {activeApp !== "opencode" &&
              activeApp !== "openclaw" &&
              activeApp !== "hermes" && (
                <div className="flex flex-wrap items-center gap-2">
                  {activeApp === "claude-desktop" ? (
                    <ClaudeDesktopRouteToggle />
                  ) : (
                    settingsData?.enableLocalProxy && (
                      <ProxyToggle activeApp={activeApp} />
                    )
                  )}
                  {activeApp !== "claude-desktop" &&
                    settingsData?.enableFailoverToggle && (
                      <FailoverToggle activeApp={activeApp} />
                    )}
                </div>
              )}
            {(settingsData?.showProfileSwitcher ?? true) && (
              <ProfileSwitcher activeApp={activeApp} />
            )}
          </section>

          <Button
            variant="liquid"
            onClick={() => setIsAddOpen(true)}
            className={cn(
              "mx-3 mb-4 w-[calc(100%-1.5rem)]",
              addActionButtonClass,
            )}
          >
            <Plus className="h-4 w-4" />
            {t("provider.addProvider")}
          </Button>

          <section className="libra-sidebar-section">
            <p className="libra-sidebar-section-label">
              {t("common.tools", { defaultValue: "Tools" })}
            </p>
            <div className="space-y-0.5">
              {activeApp === "hermes" ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("skills")}
                    className={sidebarActionClass}
                  >
                    <Wrench className="h-4 w-4" />
                    {t("skills.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("hermesMemory")}
                    className={sidebarActionClass}
                  >
                    <Brain className="h-4 w-4" />
                    {t("hermes.memory.title")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openHermesWebUI()}
                    className={sidebarActionClass}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    {t("hermes.webui.open")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("mcp")}
                    className={sidebarActionClass}
                  >
                    <McpIcon size={16} />
                    {t("mcp.title")}
                  </Button>
                </>
              ) : activeApp === "openclaw" ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("workspace")}
                    className={sidebarActionClass}
                  >
                    <FolderOpen className="h-4 w-4" />
                    {t("workspace.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("openclawEnv")}
                    className={sidebarActionClass}
                  >
                    <KeyRound className="h-4 w-4" />
                    {t("openclaw.env.title")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("openclawTools")}
                    className={sidebarActionClass}
                  >
                    <Shield className="h-4 w-4" />
                    {t("openclaw.tools.title")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("openclawAgents")}
                    className={sidebarActionClass}
                  >
                    <Cpu className="h-4 w-4" />
                    {t("openclaw.agents.title")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("sessions")}
                    className={sidebarActionClass}
                  >
                    <History className="h-4 w-4" />
                    {t("sessionManager.title")}
                  </Button>
                </>
              ) : (
                <>
                  {activeApp === "codex" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRestartChatGPT()}
                      disabled={isRestartingChatGPT}
                      className={sidebarActionClass}
                    >
                      <RefreshCw
                        className={cn(
                          "h-4 w-4",
                          isRestartingChatGPT && "animate-spin",
                        )}
                      />
                      {t("header.restartChatGPT")}
                    </Button>
                  )}
                  {activeApp === "codex" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentView("codexEnhance")}
                      className={sidebarActionClass}
                    >
                      <WandSparkles className="h-4 w-4" />
                      Libra Codex+
                    </Button>
                  )}
                  {hasSkillsSupport && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentView("skills")}
                      className={sidebarActionClass}
                    >
                      <Wrench className="h-4 w-4" />
                      {t("skills.manage")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("prompts")}
                    className={sidebarActionClass}
                  >
                    <Book className="h-4 w-4" />
                    {t("prompts.manage")}
                  </Button>
                  {hasSessionSupport && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentView("sessions")}
                      className={sidebarActionClass}
                    >
                      <History className="h-4 w-4" />
                      {t("sessionManager.title")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView("mcp")}
                    className={sidebarActionClass}
                  >
                    <McpIcon size={16} />
                    {t("mcp.title")}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentView("agents")}
                className={sidebarActionClass}
              >
                <Cpu className="h-4 w-4" />
                {t("agents.title")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentView("universal")}
                className={sidebarActionClass}
              >
                <Layers3 className="h-4 w-4" />
                {t("universalProvider.title", {
                  defaultValue: "Unified providers",
                })}
              </Button>
            </div>
          </section>
        </>
      );
    }

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentView("providers")}
          className="libra-sidebar-action mx-3 mt-3 w-[calc(100%-1.5rem)] justify-start gap-2 px-2.5"
        >
          <Layers3 className="h-4 w-4" />
          {t("provider.title", { defaultValue: "Providers" })}
        </Button>

        <section className="libra-sidebar-section mt-3">
          <p className="libra-sidebar-section-label">
            {t("common.actions", { defaultValue: "Actions" })}
          </p>
          <div className="space-y-0.5">
            {currentView === "prompts" && (
              <Button
                variant="liquid"
                size="sm"
                onClick={() => promptPanelRef.current?.openAdd()}
                className="w-full"
              >
                <Plus className="h-4 w-4" />
                {t("prompts.add")}
              </Button>
            )}
            {currentView === "codexRadar" && (
              <>
                <Button
                  variant="liquid"
                  size="sm"
                  onClick={() => codexRadarRef.current?.refresh()}
                  className="w-full"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("codexRadar.refresh", { defaultValue: "刷新数据" })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void settingsApi
                      .openExternal("https://codexradar.com")
                      .catch((error) =>
                        toast.error(extractErrorMessage(error)),
                      );
                  }}
                  className={sidebarActionClass}
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("codexRadar.openWebsite", {
                    defaultValue: "打开 Codex Radar",
                  })}
                </Button>
              </>
            )}
            {currentView === "mcp" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => mcpPanelRef.current?.openImport()}
                  className={sidebarActionClass}
                >
                  <Download className="h-4 w-4" />
                  {t("mcp.importExisting")}
                </Button>
                <Button
                  variant="liquid"
                  size="sm"
                  onClick={() => mcpPanelRef.current?.openAdd()}
                  className="w-full"
                >
                  <Plus className="h-4 w-4" />
                  {t("mcp.addMcp")}
                </Button>
              </>
            )}
            {currentView === "skills" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    unifiedSkillsPanelRef.current?.openRestoreFromBackup()
                  }
                  className={sidebarActionClass}
                >
                  <History className="h-4 w-4" />
                  {t("skills.restoreFromBackup.button")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    unifiedSkillsPanelRef.current?.openInstallFromZip()
                  }
                  className={sidebarActionClass}
                >
                  <FolderArchive className="h-4 w-4" />
                  {t("skills.installFromZip.button")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => unifiedSkillsPanelRef.current?.openImport()}
                  className={sidebarActionClass}
                >
                  <Download className="h-4 w-4" />
                  {t("skills.import")}
                  {hasUnmanagedSkills && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenSkillsDiscovery}
                  className={sidebarActionClass}
                >
                  <Search className="h-4 w-4" />
                  {t("skills.discover")}
                </Button>
              </>
            )}
            {currentView === "skillsDiscovery" &&
              getSkillsPageHeaderActions(skillsDiscoverySource).map(
                ({ key, labelKey, Icon, execute }) => (
                  <Button
                    key={key}
                    variant="ghost"
                    size="sm"
                    onClick={() => execute(skillsPageRef.current)}
                    className={sidebarActionClass}
                  >
                    <Icon className="h-4 w-4" />
                    {t(labelKey)}
                  </Button>
                ),
              )}
            {currentView === "settings" && isCurrentAppTakeoverActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSettingsDefaultTab("usage")}
                className={sidebarActionClass}
              >
                <BarChart2 className="h-4 w-4" />
                {t("usage.title", { defaultValue: "Usage" })}
              </Button>
            )}
          </div>
        </section>
      </>
    );
  };

  return (
    <div
      className="libra-vscode-shell flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30"
      style={{ overflowX: "hidden", paddingTop: contentTopOffset }}
    >
      {(dragBarHeight > 0 || useAppWindowControls) && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-end px-2"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag", height: dragBarHeight } as any}
        >
          {useAppWindowControls && (
            <div
              className="flex items-center gap-1"
              style={{ WebkitAppRegion: "no-drag" } as any}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowMinimize()}
                title={t("header.windowMinimize")}
                className="h-7 w-7"
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowToggleMaximize()}
                title={
                  isWindowMaximized
                    ? t("header.windowRestore")
                    : t("header.windowMaximize")
                }
                className="h-7 w-7"
              >
                {isWindowMaximized ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowClose()}
                title={t("header.windowClose")}
                className="h-7 w-7 hover:bg-red-500/15 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}
      {showEnvBanner && envConflicts.length > 0 && (
        <EnvWarningBanner
          conflicts={envConflicts}
          onDismiss={() => {
            setShowEnvBanner(false);
            sessionStorage.setItem("env_banner_dismissed", "true");
          }}
          onDeleted={async () => {
            try {
              const allConflicts = await checkAllEnvConflicts();
              const flatConflicts = Object.values(allConflicts).flat();
              setEnvConflicts(flatConflicts);
              if (flatConflicts.length === 0) {
                setShowEnvBanner(false);
              }
            } catch (error) {
              console.error(
                "[App] Failed to re-check conflicts after deletion:",
                error,
              );
            }
          }}
        />
      )}

      <header
        className="libra-titlebar fixed z-50 w-full border-b border-border"
        {...DRAG_REGION_ATTR}
        style={
          {
            ...DRAG_REGION_STYLE,
            top: dragBarHeight,
            height: HEADER_HEIGHT,
          } as any
        }
      >
        <div
          className="flex h-full items-center justify-between gap-2 px-2"
          {...DRAG_REGION_ATTR}
          style={{ ...DRAG_REGION_STYLE } as any}
        >
          <div
            className="flex min-w-0 items-center gap-2"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            <a
              href="https://libra.irises.cc"
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1.5 px-1 text-sm font-semibold tracking-wide text-foreground hover:text-primary"
              title="https://libra.irises.cc"
            >
              <img
                src={appIcon}
                alt="Libra"
                className="h-4 w-4 object-contain"
              />
              <span>Libra</span>
            </a>
            <span className="h-4 border-l border-border" aria-hidden="true" />
            <span className="truncate text-xs text-muted-foreground">
              {currentViewTitle}
            </span>
          </div>
          <div
            className="flex shrink-0 items-center gap-0.5"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            {isCurrentAppTakeoverActive && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSettingsDefaultTab("usage");
                  setCurrentView("settings");
                }}
                title={t("usage.title", { defaultValue: "Usage" })}
                className="h-7 w-7"
              >
                <BarChart2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <UpdateBadge
              onClick={() => {
                setSettingsDefaultTab("about");
                setCurrentView("settings");
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSettingsDefaultTab("general");
                setCurrentView("settings");
              }}
              title={t("common.settings")}
              className="h-7 w-7"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
              className="h-7 w-7"
              title={
                isSidebarCollapsed
                  ? t("common.showSidebar", { defaultValue: "Show sidebar" })
                  : t("common.hideSidebar", { defaultValue: "Hide sidebar" })
              }
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="libra-workbench flex min-h-0 flex-1 overflow-hidden">
        <aside className="libra-activitybar flex w-12 shrink-0 flex-col justify-between">
          <div className="flex flex-col items-center gap-1 pt-1">
            <a
              href="https://libra.irises.cc"
              target="_blank"
              rel="noreferrer"
              className="libra-activity-brand mb-1 flex h-10 w-10 items-center justify-center"
              title="Libra"
            >
              <img
                src={appIcon}
                alt="Libra"
                className="h-6 w-6 object-contain"
              />
            </a>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentView("providers")}
              className={cn(
                "libra-activity-item",
                currentView === "providers" && "is-active",
              )}
              title={t("provider.title", { defaultValue: "Providers" })}
            >
              <Layers3 className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentView("codexRadar")}
              className={cn(
                "libra-activity-item",
                currentView === "codexRadar" && "is-active",
              )}
              title="Codex Radar"
            >
              <Radar className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentView("prompts")}
              className={cn(
                "libra-activity-item",
                currentView === "prompts" && "is-active",
              )}
              title={t("prompts.manage")}
            >
              <Book className="h-5 w-5" />
            </Button>
            {hasSkillsSupport && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentView("skills")}
                className={cn(
                  "libra-activity-item",
                  (currentView === "skills" ||
                    currentView === "skillsDiscovery") &&
                    "is-active",
                )}
                title={t("skills.manage")}
              >
                <Wrench className="h-5 w-5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentView("mcp")}
              className={cn(
                "libra-activity-item",
                currentView === "mcp" && "is-active",
              )}
              title={t("mcp.title")}
            >
              <McpIcon size={20} />
            </Button>
            {hasSessionSupport && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentView("sessions")}
                className={cn(
                  "libra-activity-item",
                  currentView === "sessions" && "is-active",
                )}
                title={t("sessionManager.title")}
              >
                <History className="h-5 w-5" />
              </Button>
            )}
            {activeApp === "codex" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentView("codexEnhance")}
                className={cn(
                  "libra-activity-item",
                  currentView === "codexEnhance" && "is-active",
                )}
                title="Libra Codex+"
              >
                <WandSparkles className="h-5 w-5" />
              </Button>
            )}
          </div>
          <div className="flex flex-col items-center gap-1 pb-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSettingsDefaultTab("general");
                setCurrentView("settings");
              }}
              className={cn(
                "libra-activity-item",
                currentView === "settings" && "is-active",
              )}
              title={t("common.settings")}
            >
              <Settings className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
              className="libra-activity-item"
              title={
                isSidebarCollapsed
                  ? t("common.showSidebar", { defaultValue: "Show sidebar" })
                  : t("common.hideSidebar", { defaultValue: "Hide sidebar" })
              }
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>
          </div>
        </aside>

        <aside
          className={cn(
            "libra-sidebar flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden border-r border-border transition-[width,opacity] duration-150",
            isSidebarCollapsed && "w-0 border-r-0 opacity-0",
          )}
          aria-hidden={isSidebarCollapsed}
        >
          <div className="libra-sidebar-heading flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {currentViewTitle}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarCollapsed(true)}
              className="h-6 w-6 shrink-0"
              title={t("common.hideSidebar", { defaultValue: "Hide sidebar" })}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {renderSidebarContent()}
          </div>
          <div className="libra-sidebar-status flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isProxyRunning ? "bg-emerald-400" : "bg-muted-foreground/50",
              )}
            />
            {isProxyRunning
              ? t("proxy.running", { defaultValue: "Local service running" })
              : t("proxy.stopped", { defaultValue: "Local service stopped" })}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="libra-editor-tab flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <span className="truncate text-xs text-foreground">
              {currentViewTitle}
            </span>
            {currentView === "providers" && (
              <span className="truncate text-[11px] text-muted-foreground">
                {t(`apps.${activeApp}`)}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto animate-fade-in">
            {isOpenClawView && openclawHealthWarnings.length > 0 && (
              <OpenClawHealthBanner warnings={openclawHealthWarnings} />
            )}
            {renderContent()}
          </div>
        </main>
      </div>

      <AddProviderDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        appId={activeApp}
        onSubmit={addProvider}
      />

      <EditProviderDialog
        open={Boolean(editingProvider)}
        provider={effectiveEditingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null);
          }
        }}
        onSubmit={handleEditProvider}
        appId={activeApp}
        isProxyTakeover={isCurrentAppTakeoverActive}
      />

      {effectiveUsageProvider && (
        <UsageScriptModal
          key={effectiveUsageProvider.id}
          provider={effectiveUsageProvider}
          appId={activeApp}
          isOpen={Boolean(usageProvider)}
          onClose={() => setUsageProvider(null)}
          onSave={(script) => {
            if (usageProvider) {
              void saveUsageScript(usageProvider, script);
            }
          }}
        />
      )}

      <ConfirmDialog
        isOpen={isRestartAfterSwitchOpen}
        title={t("header.restartChatGPTAfterSwitchTitle")}
        message={t("header.restartChatGPTAfterSwitchDescription")}
        confirmText={t("header.restartChatGPTAfterSwitchConfirm")}
        cancelText={t("header.restartChatGPTAfterSwitchCancel")}
        variant="info"
        onConfirm={() => {
          setIsRestartAfterSwitchOpen(false);
          void handleRestartChatGPT();
        }}
        onCancel={() => setIsRestartAfterSwitchOpen(false)}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.action === "remove"
            ? t("confirm.removeProvider")
            : t("confirm.deleteProvider")
        }
        message={
          confirmAction
            ? confirmAction.action === "remove"
              ? t("confirm.removeProviderMessage", {
                  name: confirmAction.provider.name,
                })
              : t("confirm.deleteProviderMessage", {
                  name: confirmAction.provider.name,
                })
            : ""
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        isOpen={launchDashboardOpen}
        title={t("hermes.webui.launchConfirmTitle")}
        message={t("hermes.webui.launchConfirmMessage")}
        confirmText={t("hermes.webui.launchConfirmAction")}
        variant="info"
        onConfirm={() => {
          setLaunchDashboardOpen(false);
          void (async () => {
            try {
              await hermesApi.launchDashboard();
              toast.success(t("hermes.webui.launching"));
            } catch (error) {
              toast.error(t("hermes.webui.launchFailed"), {
                description: extractErrorMessage(error) || undefined,
              });
            }
          })();
        }}
        onCancel={() => setLaunchDashboardOpen(false)}
      />

      <DeepLinkImportDialog />
      <FirstRunNoticeDialog />
    </div>
  );
}

export default App;
