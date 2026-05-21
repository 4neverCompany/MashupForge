'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Loader2, 
  Image as ImageIcon, 
  Download, 
  Sparkles, 
  Maximize2, 
  X, 
  Trash2, 
  Bookmark, 
  BookmarkCheck, 
  LayoutGrid, 
  Settings, 
  RefreshCw, 
  Search, 
  Filter, 
  Video,
  Columns,
  MinusCircle,
  Tag,
  FolderPlus,
  Plus,
  Minus,
  ChevronDown,
  XCircle,
  CheckCircle2,
  Folder,
  Save,
  FolderOpen,
  Zap,
  Palette,
  Sun,
  Camera,
  Ban,
  Edit3,
  Lightbulb,
  Calendar,
  CalendarDays,
  Grid,
  Menu,
  LogOut,
  Copy,
  Check,
  Wand2,
  Clock,
  Send,
  TrendingUp,
  ImageOff,
} from 'lucide-react';
import {
  useMashup,
  GeneratedImage,
  LEONARDO_MODELS,
  MODEL_PROMPT_GUIDES,
  Collection,
  GenerateOptions,
  ScheduledPost,
  ART_STYLES,
  LIGHTING_OPTIONS,
  CAMERA_ANGLES,
  ASPECT_RATIOS,
  IMAGE_SIZES,
  type ViewType,
} from './MashupContext';
import { LEONARDO_SHARED_STYLES, getModelProviderLabel } from '@/types/mashup';
import { suggestParametersAI, type ParamSuggestion, type PerModelSuggestion } from '@/lib/param-suggest';
import { pushIdeaToStudio } from '@/lib/push-idea-to-studio';
import { ParamSuggestionCard } from './ParamSuggestionCard';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';
import { PipelineStatusStrip } from './PipelineStatusStrip';
import { DailyDigest } from './ideas/DailyDigest';
import { GalleryFilterBar } from './GalleryFilterBar';
// Lazy-loaded — the Pipeline tab pulls in smart-scheduler logic +
// its own local state tree and isn't needed on first paint. ssr:false
// because it reads localStorage during initial render.
const PipelinePanel = dynamic(
  () => import('./PipelinePanel').then((m) => m.PipelinePanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading pipeline…
      </div>
    ),
  }
);
import { streamAIToString, extractJsonArrayFromLLM, extractJsonObjectFromLLM } from '@/lib/aiClient';
import { enhancePromptForModel } from '@/lib/modelOptimizer';
import { getModelSpec } from '@/lib/model-specs';
import { getErrorMessage } from '@/lib/errors';
import { recordOutcome } from '@/lib/outcome-tracker';
import { findPostingBlock, isStillScheduled } from '@/lib/post-approval-gate';
import { postDueState } from '@/lib/autopost-due';
import { getAllRejectedImageIds } from '@/lib/gallery-visibility';
import { useSmartScheduler } from '@/hooks/useSmartScheduler';
import { SmartScheduleModal } from './SmartScheduleModal';
import {
  loadEngagementData,
  computeWeekScores,
  findBestSlots,
  type SlotScoreBreakdown,
  type SlotScore,
  type ExistingPost,
} from '@/lib/smartScheduler';
import {
  HeatmapTint,
  TopSlotStar,
  HeatmapToggleButton,
  HeatmapLegend,
  HeatmapTooltip,
} from './WeekHeatmap';
import type { CarouselGroup } from './MashupContext';
import type { PostPlatform } from '@/types/mashup';
import TimePicker24 from './TimePicker24';
import { formatTime24, formatTimeShort } from './TimePicker24';
import { SettingsModal, type PiStatus, type PiBusy } from './SettingsModal';
import { CollectionModal } from './CollectionModal';
import { ImageDetailModal } from './ImageDetailModal';
import { BulkTagModal } from './BulkTagModal';
import { LazyImg } from './LazyImg';
import { AspectPreview } from './postready/AspectPreview';
import { PostReadyCard } from './postready/PostReadyCard';
import { PostReadyCarouselCard } from './postready/PostReadyCarouselCard';
import { PostReadyDndGrid, DraggableSingleWrapper, CarouselReorderSlot, type DndMoveHandler } from './postready/PostReadyDndGrid';
import { DndUndoToast } from './postready/DndUndoToast';
import { EmptyGalleryState } from './EmptyGalleryState';
import { GalleryCard } from './GalleryCard';
// V050-002 Phase 1: per-view modules under components/views. Phase 1
// extracts the two simplest views (Ideas, Pipeline) as a proof of the
// presentational/props-bag pattern. Phase 2 (post-ready, captioning,
// gallery, studio/compare) is tracked in docs/bmad/reviews/V050-002.md.
import { IdeasView } from './views/IdeasView';
import { PipelineView } from './views/PipelineView';
// TECHDEBT-001: ui tokens are imported aliased to `ui*` to avoid
// collision with `status` field names that local handlers iterate over.
import { status as uiStatus, gold as uiGold, surface as uiSurface } from '@/lib/ui-tokens';
import { computeCarouselView as computeCarouselViewPure, type PostItem } from '@/lib/carouselView';
import { sortPostItems } from '@/lib/post-ready-sort';
import { proposeTagGroups } from '@/hooks/useCollections';

/**
 * Auto-sizing textarea that grows with its content. Resets to
 * scrollHeight on every render so deletions shrink it too. Shared by
 * Captioning Studio and Post Ready tabs so long captions don't get
 * clipped behind a fixed row count.
 */
interface AutoTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
}
function AutoTextarea({ minRows = 2, className, value, ...rest }: AutoTextareaProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={`resize-none overflow-hidden ${className || ''}`}
      {...rest}
    />
  );
}

import { useAuth } from '@/hooks/useAuth';
import { useDesktopConfig } from '@/hooks/useDesktopConfig';
import { showToast } from '@/components/Toast';

export function MainContent() {
  const { logout } = useAuth();
  const { isDesktop, credentials: desktopCreds } = useDesktopConfig();
  const { 
    images, 
    savedImages, 
    collections,
    isGenerating, 
    progress, 
    settings,
    updateSettings,
    settingsSaveState,
    generateImages,
    generatePostContent,
    rerollImage, 
    saveImage, 
    deleteImage,
    updateImageTags,
    createCollection,
    deleteCollection,
    addImageToCollection,
    removeImageFromCollection,
    toggleApproveImage,
    generateComparison,
    pickComparisonWinner,
    comparisonResults,
    clearComparison,
    deleteComparisonResult,
    autoTagImage,
    autoGenerateCollectionInfo,
    bulkUpdateImageTags,
    setImageStatus,
    view,
    setView,
    comparisonPrompt,
    setComparisonPrompt,
    comparisonOptions,
    setComparisonOptions,
    ideas,
    clearIdeas,
    updateIdeaStatus,
    deleteIdea,
    isSidebarOpen,
    setIsSidebarOpen
  } = useMashup();
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');
  const [filterModel, setFilterModel] = useState('all');
  const [filterUniverse, setFilterUniverse] = useState('all');
  const [tagQuery, setTagQuery] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState('all');
  const [selectedForBatch, setSelectedForBatch] = useState<Set<string>>(new Set());
  const [dragOverCollection, setDragOverCollection] = useState<string | null>(null);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isAutoTagging, setIsAutoTagging] = useState(false);

  const checkApiKey = async () => {
    const w = window as typeof window & { aistudio?: { hasSelectedApiKey(): Promise<boolean>; openSelectKey(): Promise<void> } };
    if (typeof window !== 'undefined' && w.aistudio) {
      const has = await w.aistudio.hasSelectedApiKey();
      setHasApiKey(has);
      if (!has) {
        await w.aistudio.openSelectKey();
        const nowHas = await w.aistudio.hasSelectedApiKey();
        setHasApiKey(nowHas);
      }
    }
  };
  
  // Comparison state
  const [comparisonModels, setComparisonModels] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  /** Per-model parameter preview (set by pi when prompt changes). */
  const [modelPreviews, setModelPreviews] = useState<Record<string, { prompt?: string; style?: string; aspectRatio?: string; negativePrompt?: string; lighting?: string; angle?: string }>>({});
  /** V030-007: smart pre-fill suggestion card visibility + payload. */
  const [paramSuggestion, setParamSuggestion] = useState<ParamSuggestion | null>(null);
  /** V030-008-per-model: per-model overrides from the suggestion card Apply. */
  const [perModelOverrides, setPerModelOverrides] = useState<Record<string, { style?: string; aspectRatio?: string; negativePrompt?: string }>>({});
  /** V030-008: pi.dev is reasoning about parameters — show spinner while it works. */
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  // Track which image is currently having its caption generated so we can
  // show a per-card spinner while the pi caption request runs. Keyed by
  // image id.
  const [preparingPostId, setPreparingPostId] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null);

  // Captioning Studio tab state
  const [captioningFilter, setCaptioningFilter] = useState<'all' | 'captioned' | 'uncaptioned'>('all');
  // Whether the tab auto-groups similar images into carousel cards
  // (reuses the Post Ready computeCarouselView logic). Default ON.
  const [captioningGrouped, setCaptioningGrouped] = useState(true);
  // When grouping is OFF, users can check individual cards and manually
  // promote a selection to a carousel group.
  const [captioningSelected, setCaptioningSelected] = useState<Set<string>>(new Set());
  // Carousel picker modal: multi-source image picker for grouping
  // savedImages into a carousel from ANY subset (not just auto-detected).
  const [showCarouselPicker, setShowCarouselPicker] = useState(false);
  const [pickerTargetGroupId, setPickerTargetGroupId] = useState<string | null>(null);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  // Post-Ready manual carousel grouping selection (parallel to
  // captioningSelected). Lets the user check 2+ Post-Ready single cards
  // and promote them into a carousel group without leaving the tab.
  const [postReadySelected, setPostReadySelected] = useState<Set<string>>(new Set());
  const [batchCaptioning, setBatchCaptioning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  // Captioning tab "remove" confirmation — tracks which image id is pending
  // confirmation so we can show an inline ✓/✗ pair instead of window.confirm.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  // Image id currently copied (for the brief "Copied" affordance on the
  // Post Ready tab). Auto-clears after a short timeout.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Post Ready scheduling state ────────────────────────────────────
  // PostPlatform is exported from @/types/mashup and shared with the
  // useSmartScheduler hook + SmartScheduleModal component.

  // Per-card platform selection (defaults set when the card first renders).
  const [postPlatformSel, setPostPlatformSel] = useState<Record<string, PostPlatform[]>>({});
  // Per-card date/time pickers.
  const [postSchedule, setPostSchedule] = useState<Record<string, { date: string; time: string }>>({});
  // Per-card posting spinner state ('posting' | 'scheduling' | null).
  const [postBusy, setPostBusy] = useState<Record<string, 'posting' | 'scheduling' | null>>({});
  // Transient status line per card ('Posted!', 'Scheduled for ...', error msg).
  const [postStatus, setPostStatus] = useState<Record<string, string | null>>({});
  // Post Ready view toggle + calendar navigation.
  const [postReadyView, setPostReadyView] = useState<'grid' | 'calendar' | 'history'>('grid');
  // V082-POST-READY-SORT: user-chosen sort for the grid view.
  //   savedAt   — when the image landed in Post Ready (newest first)
  //   scheduled — by scheduled post time, soonest first (unscheduled last)
  //   created   — by image creation time parsed from `img-<ts>-…` id
  // Default is savedAt — matches the prior computeCarouselView ordering.
  const [postReadySort, setPostReadySort] =
    useState<'savedAt' | 'scheduled' | 'created'>('savedAt');
  const [calendarMode, setCalendarMode] = useState<'week' | 'month'>('week');
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  // Inline edit popover state for the week view — only one open at a time.
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  // Drag state for rescheduling scheduled posts via HTML5 DnD.
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  // Fix 3 (mmx brief): drop-to-delete trash zone at the foot of the week
  // calendar. `dragOverTrash` drives the highlight; `pendingTrashId` opens
  // a confirmation dialog before the post is removed from settings.
  const [dragOverTrash, setDragOverTrash] = useState(false);
  const [pendingTrashId, setPendingTrashId] = useState<string | null>(null);
  // V040-001: engagement heatmap overlay. Persisted to settings on toggle
  // so the user's choice survives reloads.
  const [heatmapEnabled, setHeatmapEnabled] = useState<boolean>(
    () => settings.heatmapEnabled ?? false,
  );
  const [heatmapHover, setHeatmapHover] = useState<{
    cellKey: string;
    rect: DOMRect;
    date: Date;
    hour: number;
    isAvailable: boolean;
  } | null>(null);
  const heatmapHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fix 4 (mmx brief): the calendar's inline edit popover renders above
  // the week grid, so opening a chip near the bottom would force the user
  // to scroll up to see it. Scroll the popover into view whenever the
  // selection changes so the image + edit form is always reachable in one
  // step. block:'nearest' avoids a janky jump when the popover is already
  // visible.
  const editPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editingPostId) return;
    // rAF gives the popover one paint cycle to mount before we measure it.
    const raf = requestAnimationFrame(() => {
      editPopoverRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [editingPostId]);
  // Click-to-schedule: when the user clicks an empty calendar cell, open
  // a modal with an image picker + platform toggles + time. `time` is a
  // full HH:MM string so picking e.g. 14:30 doesn't silently truncate to
  // the hour. null when closed.
  const [calendarSlotClick, setCalendarSlotClick] = useState<{
    date: string;
    time: string;
    imageId?: string;
    platforms?: PostPlatform[];
  } | null>(null);

  // Batch "Schedule All" mini-modal state.
  const [showScheduleAll, setShowScheduleAll] = useState(false);

  const hasPlatformCreds = (p: PostPlatform): boolean => {
    switch (p) {
      case 'instagram':
        if (settings.apiKeys.instagram?.accessToken && settings.apiKeys.instagram?.igAccountId) return true;
        if (isDesktop && desktopCreds.hasInstagramToken && desktopCreds.hasInstagramAccountId) return true;
        return false;
      case 'pinterest':
        if (settings.apiKeys.pinterest?.accessToken) return true;
        if (isDesktop && desktopCreds.hasPinterestCreds) return true;
        return false;
      case 'twitter':
        if (settings.apiKeys.twitter?.appKey && settings.apiKeys.twitter?.appSecret &&
            settings.apiKeys.twitter?.accessToken && settings.apiKeys.twitter?.accessSecret) return true;
        if (isDesktop && desktopCreds.hasTwitterCreds) return true;
        return false;
      case 'discord':
        if (settings.apiKeys.discordWebhook) return true;
        if (isDesktop && desktopCreds.hasDiscordCreds) return true;
        return false;
    }
  };

  const availablePlatforms = (): PostPlatform[] => {
    return (['instagram', 'pinterest', 'twitter', 'discord'] as PostPlatform[]).filter(hasPlatformCreds);
  };

  // PROP-016: smart scheduler hook — owns slot computation state.
  const smartScheduler = useSmartScheduler({
    postCount: 1,                          // updated per-call via trigger options
    scheduledPosts: settings.scheduledPosts || [],
    defaultPlatforms: availablePlatforms(),
    igAccessToken: settings.apiKeys?.instagram?.accessToken,
    igAccountId: settings.apiKeys?.instagram?.igAccountId,
  });

  /** Return the per-card selection, initialising to "all available" on first access. */
  const getSelectedPlatforms = (id: string): PostPlatform[] => {
    if (postPlatformSel[id]) return postPlatformSel[id];
    return availablePlatforms();
  };

  // V040-001: keep React state and persisted setting in sync. Persists
  // through `updateSettings` so it survives page reloads and matches
  // the rest of the toggle-button pattern used in this file.
  const toggleHeatmap = useCallback(() => {
    setHeatmapEnabled((prev) => {
      const next = !prev;
      updateSettings({ heatmapEnabled: next });
      return next;
    });
    // Closing the overlay also closes any in-flight tooltip.
    setHeatmapHover(null);
    if (heatmapHoverTimer.current) {
      clearTimeout(heatmapHoverTimer.current);
      heatmapHoverTimer.current = null;
    }
  }, [updateSettings]);

  // V040-001: hide tooltip on scroll / Escape. Scroll closes immediately
  // because the anchor rect would otherwise drift away from the cell.
  useEffect(() => {
    if (!heatmapHover) return;
    const close = () => setHeatmapHover(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [heatmapHover]);

  const togglePlatformFor = (id: string, p: PostPlatform) => {
    setPostPlatformSel((prev) => {
      const current = prev[id] || availablePlatforms();
      const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
      return { ...prev, [id]: next };
    });
  };

  /** Default schedule — today's date, an hour from now. Memoised per image id. */
  const getSchedule = (id: string): { date: string; time: string } => {
    if (postSchedule[id]) return postSchedule[id];
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const date = d.toISOString().slice(0, 10);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { date, time };
  };

  const setScheduleFor = (id: string, patch: Partial<{ date: string; time: string }>) => {
    setPostSchedule((prev) => ({
      ...prev,
      [id]: { ...getSchedule(id), ...patch },
    }));
  };

  const buildCredentialsPayload = () => ({
    instagram: settings.apiKeys.instagram,
    twitter: settings.apiKeys.twitter,
    pinterest: settings.apiKeys.pinterest,
    discord: { webhookUrl: settings.apiKeys.discordWebhook },
  });

  /** Post a single image immediately to the selected platforms. */
  const postImageNow = async (img: GeneratedImage, platforms: PostPlatform[]) => {
    if (platforms.length === 0) return;
    // BUG-CRIT-011: enforce the approval gate at the manual click site.
    // Without this check, Post Now bypassed ScheduledPost.status entirely
    // and rejected/pending pipeline content went live anyway.
    const block = findPostingBlock([img.id], settings.scheduledPosts);
    if (block) {
      setPostStatus((prev) => ({ ...prev, [img.id]: block.message }));
      return;
    }
    setPostBusy((prev) => ({ ...prev, [img.id]: 'posting' }));
    setPostStatus((prev) => ({ ...prev, [img.id]: null }));
    try {
      const res = await fetch('/api/social/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: formatPost(img),
          platforms,
          mediaUrl: img.url,
          mediaBase64: img.base64,
          credentials: buildCredentialsPayload(),
        }),
      });
      let data: { error?: string };
      try {
        data = await res.json() as { error?: string };
      } catch {
        throw new Error(`Server error (HTTP ${res.status}) — check logs`);
      }
      if (!res.ok) throw new Error(data.error || 'Post failed');
      patchImage(img, {
        postedAt: Date.now(),
        postedTo: platforms,
        postError: undefined,
      });
      recordOutcome({
        imageId: img.id,
        prompt: img.prompt,
        style: img.style ?? '',
        aspectRatio: img.aspectRatio ?? '',
        model: img.modelInfo?.modelName ?? img.modelInfo?.modelId ?? '',
        status: 'posted',
        platform: platforms.join(','),
        timestamp: Date.now(),
      });
      setPostStatus((prev) => ({
        ...prev,
        [img.id]: `Posted to ${platforms.join(', ')} ✓`,
      }));
    } catch (e: unknown) {
      const reason = getErrorMessage(e);
      patchImage(img, { postError: reason });
      setPostStatus((prev) => ({
        ...prev,
        [img.id]: `Error: ${reason}`,
      }));
    } finally {
      setPostBusy((prev) => ({ ...prev, [img.id]: null }));
    }
  };

  /**
   * Persist or update a ScheduledPost in settings.scheduledPosts.
   *
   * If an existing non-carousel scheduled post already references this
   * image, we patch it in place instead of appending — otherwise clicking
   * Schedule after editing the date/time/caption would create a duplicate
   * card for the same image. Carousel-bound posts are owned by
   * scheduleCarousel and intentionally skipped here.
   */
  /**
   * Collision check for manual scheduling.
   * Treats a slot as taken when a non-terminal ScheduledPost shares the
   * same date+time AND any platform overlap, *excluding* the image(s)
   * being rescheduled and (for carousels) siblings in the same group.
   * Returns the colliding post or null.
   */
  const findScheduleCollision = (
    date: string,
    time: string,
    platforms: readonly string[],
    ignoreImageIds: Set<string>,
    ignoreCarouselGroupId?: string | null,
  ): ScheduledPost | null => {
    const existing = settings.scheduledPosts || [];
    const wanted = new Set<string>(platforms);
    for (const p of existing) {
      if (p.status === 'posted' || p.status === 'rejected' || p.status === 'failed') continue;
      if (ignoreImageIds.has(p.imageId)) continue;
      if (ignoreCarouselGroupId && p.carouselGroupId === ignoreCarouselGroupId) continue;
      if (p.date !== date || p.time !== time) continue;
      const pPlatforms = p.platforms || [];
      if (pPlatforms.some((pl) => wanted.has(pl))) return p;
    }
    return null;
  };

  /**
   * BUG-FIX: when smart schedule has fewer slots than posts, find the
   * next-best unconsumed slots so remaining posts spread rather than
   * piling onto the same form.{date,time}. `consumedKeys` tracks slots
   * already allocated in the same confirm pass.
   */
  const findExtraSlots = (
    needed: number,
    existingPosts: ScheduledPost[],
    consumedKeys: Set<string>,
  ): SlotScore[] => {
    const allScheduled: ExistingPost[] = [
      ...existingPosts.map((p) => ({ date: p.date, time: p.time, status: p.status })),
      ...[...consumedKeys].map((key) => {
        const [date, time] = key.split('T');
        return { date, time, status: 'scheduled' as const };
      }),
    ];
    return findBestSlots(allScheduled, needed);
  };

  const scheduleImage = (img: GeneratedImage, platforms: PostPlatform[], date: string, time: string) => {
    if (!date || !time || platforms.length === 0) return;
    const collision = findScheduleCollision(date, time, platforms, new Set([img.id]));
    if (collision) {
      const wanted = new Set<string>(platforms);
      const platformLabel = (collision.platforms || []).find((pl) => wanted.has(pl)) || 'that platform';
      showToast(`Already scheduled at ${date} ${time} on ${platformLabel}.`, 'error');
      return;
    }
    const caption = formatPost(img);
    updateSettings((prev) => {
      const existingPosts = prev.scheduledPosts || [];
      // RESCHED-FIX: only reuse the entry if it's still active. A 'posted'
      // or 'rejected' entry is terminal — patching it would silently
      // rewrite history and the Post Ready card would keep showing the
      // terminal status for the new schedule. Treat 'failed' as active so
      // the user can retry by re-scheduling.
      const editableIdx = existingPosts.findIndex(
        (p) =>
          p.imageId === img.id &&
          !p.carouselGroupId &&
          p.status !== 'posted' &&
          p.status !== 'rejected',
      );
      if (editableIdx !== -1) {
        const reusedId = existingPosts[editableIdx].id;
        // RESCHED-FIX: mirror the in-place reschedule to the server
        return {
          scheduledPosts: existingPosts.map((p, i) =>
            i === editableIdx
              ? { ...p, date, time, platforms, caption, status: 'scheduled' }
              : p
          ),
        };
      }
      const scheduled: ScheduledPost = {
        id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        imageId: img.id,
        date,
        time,
        platforms,
        caption,
        status: 'scheduled',
      };
      return { scheduledPosts: [...existingPosts, scheduled] };
    });
    // BUG-CRIT-013: surface the image in the Post Ready tab. Before
    // this, scheduling from anywhere outside Post Ready (e.g. directly
    // from a calendar slot or a captioning card) created the
    // ScheduledPost but left the image with isPostReady=false, so it
    // was invisible in Post Ready even though it had a real schedule.
    if (!img.isPostReady) patchImage(img, { isPostReady: true });
    setPostStatus((prev) => ({
      ...prev,
      [img.id]: `Scheduled for ${date} ${time}`,
    }));
  };

  /**
   * Cancel a scheduled post for this image WITHOUT rejecting it.
   *
   * Distinct from `rejectScheduledPost` (which flips status to 'rejected'
   * so the daemon stops acting on it) and from `deleteImage` (which blows
   * the image away entirely). "Cancel schedule" just drops any
   * non-posted ScheduledPost entries for the image so the card reverts
   * to the plain "Ready" state — the user can then re-schedule or post
   * now. Already-posted entries are preserved so posting history is
   * never retroactively hidden.
   */
  const unschedulePost = (img: GeneratedImage) => {
    // SCHED-POST-ROBUST: cancel any matching server queue entries
    // before the local filter wipes them. Best-effort.
    updateSettings((prev) => ({
      scheduledPosts: (prev.scheduledPosts || []).filter(
        (p) => p.imageId !== img.id || p.status === 'posted',
      ),
    }));
    setPostStatus((prev) => ({ ...prev, [img.id]: 'Schedule canceled' }));
  };

  /** Cancel schedule for every image in a carousel item. */
  const unscheduleCarousel = (images: GeneratedImage[], statusKey: string) => {
    const ids = new Set(images.map((i) => i.id));
    updateSettings((prev) => ({
      scheduledPosts: (prev.scheduledPosts || []).filter(
        (p) => !ids.has(p.imageId) || p.status === 'posted',
      ),
    }));
    setPostStatus((prev) => ({ ...prev, [statusKey]: 'Schedule canceled' }));
  };

  // ── Calendar helpers ───────────────────────────────────────────────
  /** Start-of-day for a Date (strips time). */
  const startOfDay = (d: Date) => {
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    return n;
  };
  /** Monday-anchored start of the week containing d. */
  const startOfWeek = (d: Date) => {
    const n = startOfDay(d);
    const day = n.getDay(); // 0=Sun
    const mondayOffset = (day + 6) % 7; // days to subtract to reach Monday
    n.setDate(n.getDate() - mondayOffset);
    return n;
  };
  const addDays = (d: Date, n: number) => {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  };
  const toYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  /** Colour class for a scheduled-post status badge on the calendar. */
  const calendarColorFor = (status?: ScheduledPost['status']): string => {
    if (status === 'posted') return 'bg-emerald-500/80 border-emerald-400/60 text-emerald-50';
    if (status === 'failed') return 'bg-red-500/80 border-red-400/60 text-red-50';
    if (status === 'rejected') return 'bg-zinc-500/80 border-zinc-400/60 text-zinc-50';
    if (status === 'pending_approval') return 'bg-indigo-500/80 border-indigo-400/60 text-indigo-50';
    return 'bg-amber-500/80 border-amber-400/60 text-amber-50';
  };
  /** 24-hour labels 00..23 used by the week-view row header. */
  const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

  /** Look up the most relevant scheduled post for an image id.
   *  RESCHED-FIX: prefer an active (non-terminal) post over older
   *  posted/rejected entries so the Post Ready card reflects the
   *  user's most recent reschedule, not a stale terminal entry. */
  const latestScheduleFor = (imageId: string): ScheduledPost | undefined => {
    const all = settings.scheduledPosts || [];
    let active: ScheduledPost | undefined;
    let fallback: ScheduledPost | undefined;
    for (let i = all.length - 1; i >= 0; i--) {
      const p = all[i];
      if (p.imageId !== imageId) continue;
      const isTerminal = p.status === 'posted' || p.status === 'rejected';
      if (!isTerminal && !active) active = p;
      else if (!fallback) fallback = p;
    }
    return active ?? fallback;
  };

  // ── Carousel grouping (Post Ready tab) ─────────────────────────────
  // Pure logic lives in lib/carouselView.ts (TEST-001). This wrapper
  // just supplies the explicit-groups slice from settings so call
  // sites stay terse.
  const computeCarouselView = useCallback(
    (ready: GeneratedImage[]): PostItem[] =>
      computeCarouselViewPure(ready, settings.carouselGroups || []),
    [settings.carouselGroups],
  );

  /**
   * Persist a manual carousel group. If imageIds has fewer than 2
   * entries we auto-ungroup instead (a carousel of 1 is just a post).
   */
  const persistCarouselGroup = useCallback((id: string, imageIds: string[], patch?: Partial<CarouselGroup>) => {
    const groups = settings.carouselGroups || [];
    if (imageIds.length < 2) {
      updateSettings({ carouselGroups: groups.filter((g) => g.id !== id) });
      return;
    }
    const existing = groups.find((g) => g.id === id);
    if (existing) {
      updateSettings({
        carouselGroups: groups.map((g) => (g.id === id ? { ...g, ...patch, imageIds } : g)),
      });
    } else {
      updateSettings({
        carouselGroups: [...groups, { id, imageIds, status: 'draft', ...patch }],
      });
    }
  }, [settings.carouselGroups, updateSettings]);

  /** Separate a carousel — drop the explicit group and its images revert to singles. */
  const separateCarousel = (groupId: string) => {
    const groups = settings.carouselGroups || [];
    updateSettings({ carouselGroups: groups.filter((g) => g.id !== groupId) });
  };

  /** Remove a single image from a carousel group. Auto-ungroups at <2. */
  const removeFromCarousel = (groupId: string, imageId: string) => {
    const groups = settings.carouselGroups || [];
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const nextIds = g.imageIds.filter((id) => id !== imageId);
    persistCarouselGroup(groupId, nextIds);
  };

  const dndUndoStackRef = useRef<CarouselGroup[][]>([]);
  const [dndUndoToast, setDndUndoToast] = useState<string | null>(null);

  const undoLastDndMove = useCallback(() => {
    const prev = dndUndoStackRef.current.pop();
    if (!prev) return;
    updateSettings({ carouselGroups: prev });
    setDndUndoToast(null);
  }, [updateSettings]);

  const dndMoveHandler: DndMoveHandler = {
    moveImageToCarousel: (imageId: string, sourceCarouselId: string | null, targetCarouselId: string) => {
      const groups = [...(settings.carouselGroups || [])].map((g) => ({ ...g, imageIds: [...g.imageIds] }));
      dndUndoStackRef.current.push(
        JSON.parse(JSON.stringify(settings.carouselGroups || [])),
      );

      if (sourceCarouselId) {
        const src = groups.find((g) => g.id === sourceCarouselId);
        if (src) {
          src.imageIds = src.imageIds.filter((id) => id !== imageId);
        }
      }

      if (targetCarouselId.startsWith('new-group-')) {
        const targetImageId = targetCarouselId.replace('new-group-', '');
        if (targetImageId === imageId) { dndUndoStackRef.current.pop(); return; }
        groups.push({ id: `manual-${targetImageId}`, imageIds: [targetImageId, imageId], status: 'draft' as const });
      } else if (targetCarouselId.startsWith('auto-')) {
        const anchorId = targetCarouselId.slice('auto-'.length);
        const currentItems = computeCarouselViewPure(postReadyImages, settings.carouselGroups || []);
        const autoItem = currentItems.find(
          (item): item is Extract<typeof item, { kind: 'carousel' }> =>
            item.kind === 'carousel' && item.id === targetCarouselId,
        );
        if (!autoItem) { dndUndoStackRef.current.pop(); return; }
        const existingIds = autoItem.images.map((i) => i.id);
        if (existingIds.includes(imageId)) { dndUndoStackRef.current.pop(); return; }
        groups.push({ id: `manual-${anchorId}`, imageIds: [...existingIds, imageId], status: 'draft' as const });
      } else {
        const tgt = groups.find((g) => g.id === targetCarouselId);
        if (tgt) {
          if (tgt.imageIds.includes(imageId)) { dndUndoStackRef.current.pop(); return; }
          tgt.imageIds.push(imageId);
        } else {
          dndUndoStackRef.current.pop();
          return;
        }
      }

      const cleaned = groups.filter((g) => g.imageIds.length >= 2);
      updateSettings({ carouselGroups: cleaned });
      setDndUndoToast('Image moved');
    },
    moveImageToNewGroup: (imageId: string, sourceCarouselId: string | null) => {
      if (!sourceCarouselId) return;
      dndUndoStackRef.current.push(
        JSON.parse(JSON.stringify(settings.carouselGroups || [])),
      );
      removeFromCarousel(sourceCarouselId, imageId);
      setDndUndoToast('Image separated');
    },
    moveCarouselGroup: (groupId: string, beforeGroupId: string | null) => {
      const groups = [...(settings.carouselGroups || [])];
      const fromIdx = groups.findIndex((g) => g.id === groupId);
      if (fromIdx === -1) return; // auto-detected carousel — no-op

      // Snapshot for undo BEFORE mutating.
      dndUndoStackRef.current.push(
        JSON.parse(JSON.stringify(settings.carouselGroups || [])),
      );

      const [moved] = groups.splice(fromIdx, 1);
      // Resolve insertion point. `null` (trailing slot) and slots before
      // non-carousel items (single-image cards whose id is an image id, not
      // a group id) both fall through to "insert at end" — safer than
      // silently snapping to position 0.
      const beforeIdx = beforeGroupId === null
        ? -1
        : groups.findIndex((g) => g.id === beforeGroupId);
      const insertIdx = beforeIdx === -1 ? groups.length : beforeIdx;
      groups.splice(insertIdx, 0, moved);
      updateSettings({ carouselGroups: groups });
      setDndUndoToast('Carousel reordered');
    },
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && dndUndoStackRef.current.length > 0) {
        e.preventDefault();
        undoLastDndMove();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLastDndMove]);

  /** Open the multi-source image picker for an existing or new group. */
  const openCarouselPicker = (targetGroupId: string | null) => {
    setPickerTargetGroupId(targetGroupId);
    // Seed selection with the group's current members when editing.
    if (targetGroupId) {
      const g = (settings.carouselGroups || []).find((x) => x.id === targetGroupId);
      setPickerSelected(new Set(g?.imageIds || []));
    } else {
      setPickerSelected(new Set());
    }
    setShowCarouselPicker(true);
  };

  /** Confirm picker selection → persist a new or updated carousel group. */
  const confirmCarouselPicker = () => {
    const ids = Array.from(pickerSelected);
    if (ids.length < 2) {
      setShowCarouselPicker(false);
      return;
    }
    const id = pickerTargetGroupId || `manual-${ids[0]}`;
    persistCarouselGroup(id, ids);
    setShowCarouselPicker(false);
    setPickerTargetGroupId(null);
    setPickerSelected(new Set());
    // After creating a fresh group, flip the tab into grouped view so
    // the user sees the result immediately.
    if (!pickerTargetGroupId) setCaptioningGrouped(true);
  };

  /**
   * Schedule a whole carousel: creates one ScheduledPost per image in the
   * group at the shared date/time/platforms. The auto-post worker picks
   * these up when the time hits; Instagram carousel-mode is still handled
   * by postCarouselNow when the user clicks Post Now.
   *
   * If an existing carouselGroupId already covers exactly this set of
   * images, we patch those posts in place so re-editing date/time/caption
   * doesn't duplicate the carousel.
   */
  const scheduleCarousel = (
    item: Extract<PostItem, { kind: 'carousel' }>,
    platforms: PostPlatform[],
    date: string,
    time: string
  ) => {
    if (platforms.length === 0 || !date || !time || item.images.length === 0) return;
    const imageIds = new Set(item.images.map((i) => i.id));
    // Match the existing group-match logic below: if a group already
    // covers exactly these images, we're rescheduling it (no collision).
    const existingForGroup = (settings.scheduledPosts || []).filter(
      (p) => p.carouselGroupId && imageIds.has(p.imageId),
    );
    const existingGroupId = existingForGroup[0]?.carouselGroupId ?? null;
    const collision = findScheduleCollision(date, time, platforms, imageIds, existingGroupId);
    if (collision) {
      const wanted = new Set<string>(platforms);
      const platformLabel = (collision.platforms || []).find((pl) => wanted.has(pl)) || 'that platform';
      showToast(`Already scheduled at ${date} ${time} on ${platformLabel}.`, 'error');
      return;
    }
    const caption = item.group?.caption || formatPost(item.images[0]);

    updateSettings((prev) => {
      const existingPosts = prev.scheduledPosts || [];

      // Find an existing carouselGroupId whose posts cover exactly this
      // item's image set. Iterating to the end means the LAST match wins
      // if the user somehow has stale duplicates — newest grouping is kept.
      const byGroup = new Map<string, ScheduledPost[]>();
      for (const p of existingPosts) {
        if (!p.carouselGroupId || !imageIds.has(p.imageId)) continue;
        const list = byGroup.get(p.carouselGroupId) || [];
        list.push(p);
        byGroup.set(p.carouselGroupId, list);
      }
      let matchGroupId: string | null = null;
      for (const [gid, posts] of byGroup) {
        const postImgIds = new Set(posts.map((p) => p.imageId));
        if (
          postImgIds.size === imageIds.size &&
          [...imageIds].every((id) => postImgIds.has(id))
        ) {
          matchGroupId = gid;
        }
      }

      if (matchGroupId) {
        return {
          scheduledPosts: existingPosts.map((p) =>
            p.carouselGroupId === matchGroupId
              ? { ...p, date, time, platforms, caption }
              : p
          ),
        };
      }

      const nowStamp = Date.now();
      const groupId = `carousel-grp-${nowStamp}-${Math.random().toString(36).slice(2, 8)}`;
      const newPosts: ScheduledPost[] = item.images.map((img, idx) => ({
        id: `post-${nowStamp}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        imageId: img.id,
        date,
        time,
        platforms,
        caption,
        status: 'scheduled' as const,
        carouselGroupId: groupId,
      }));
      // SCHED-POST-ROBUST: mirror to the server queue. Each carousel
      // member is pushed with its own mediaUrl; the cron groups by
      // carouselGroupId and assembles mediaUrls = [member1.url, ...]
      // (see app/api/social/cron-fire/route.ts:fireOne). All members
      return { scheduledPosts: [...existingPosts, ...newPosts] };
    });
    // BUG-CRIT-013: surface every image in the carousel in Post Ready,
    // matching scheduleImage's per-image behaviour. Without this,
    // scheduling a carousel from outside Post Ready left all siblings
    // invisible in the Post Ready tab.
    for (const img of item.images) {
      if (!img.isPostReady) patchImage(img, { isPostReady: true });
    }
    setPostStatus((prev) => ({
      ...prev,
      [`carousel-${item.id}`]: `Scheduled carousel for ${date} ${time}`,
    }));
  };

  /** Post a whole carousel now — fans out to platforms with the full mediaUrls array. */
  const postCarouselNow = async (
    item: Extract<PostItem, { kind: 'carousel' }>,
    platforms: PostPlatform[]
  ) => {
    if (platforms.length === 0 || item.images.length === 0) return;
    const key = `carousel-${item.id}`;
    // BUG-CRIT-011: a single rejected (or pending-approval) sibling
    // blocks the whole carousel. Bulk-rejecting in the approval queue
    // marks each ScheduledPost in the group; without this gate the
    // user could still publish the entire carousel via Post Now.
    const block = findPostingBlock(
      item.images.map((i) => i.id),
      settings.scheduledPosts,
    );
    if (block) {
      setPostStatus((prev) => ({ ...prev, [key]: block.message }));
      return;
    }
    setPostBusy((prev) => ({ ...prev, [key]: 'posting' }));
    setPostStatus((prev) => ({ ...prev, [key]: null }));
    try {
      const caption = item.group?.caption || formatPost(item.images[0]);
      const mediaUrls = item.images.map((i) => i.url).filter(Boolean) as string[];
      const res = await fetch('/api/social/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption,
          platforms,
          mediaUrls,
          credentials: buildCredentialsPayload(),
        }),
      });
      // POST-NONJSON-DIAG (2026-05-21): defensively wrap res.json() to
      // match the other three /api/social/post call sites. Without this,
      // a non-JSON response body bubbled the raw V8 SyntaxError directly
      // into the carousel-post toast ("Unexpected token R, Request En...
      // is not valid JSON"), masking which upstream produced the failure.
      let data: { error?: string };
      try {
        data = await res.json() as { error?: string };
      } catch {
        throw new Error(`Server error (HTTP ${res.status}) — check logs`);
      }
      if (!res.ok) throw new Error(data.error || 'Carousel post failed');
      const stamp = Date.now();
      for (const ci of item.images) {
        patchImage(ci, {
          postedAt: stamp,
          postedTo: platforms,
          postError: undefined,
        });
      }
      setPostStatus((prev) => ({ ...prev, [key]: `Posted carousel to ${platforms.join(', ')} ✓` }));
    } catch (e: unknown) {
      const reason = getErrorMessage(e);
      for (const ci of item.images) {
        patchImage(ci, { postError: reason });
      }
      setPostStatus((prev) => ({ ...prev, [key]: `Error: ${reason}` }));
    } finally {
      setPostBusy((prev) => ({ ...prev, [key]: null }));
    }
  };

  /** Write text to clipboard and flash a "Copied" state on the given key. */
  const copyWithFeedback = async (text: string, feedbackKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(feedbackKey);
      setTimeout(() => {
        setCopiedId((current) => (current === feedbackKey ? null : current));
      }, 1500);
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  /** Format a single image's caption + hashtags as a ready-to-paste post. */
  const formatPost = (img: GeneratedImage): string => {
    const caption = img.postCaption || '';
    const tags = (img.postHashtags || []).join(' ');
    return tags ? `${caption}\n\n${tags}` : caption;
  };

  /** Merge partial updates into an image and persist. */
  const patchImage = (img: GeneratedImage, patch: Partial<GeneratedImage>) => {
    saveImage({ ...img, ...patch });
  };

  /**
   * REFACTOR-001 / SHOULDFIX-002 — single shared fan-out for carousel
   * captions, covering both the "call AI on anchor, propagate" path AND
   * the "anchor already has a caption, propagate verbatim" path.
   *
   * Four sites used to have parallel inline copies of "get a caption
   * for the anchor (via AI or via its existing caption), then propagate
   * caption + hashtags to siblings": batchCaptionImages' needsAi=true
   * branch, batchCaptionImages' needsAi=false propagation-only branch
   * (SHOULDFIX-002), the captioning-view per-card Generate button, and
   * the post-ready Regen button. The copies drifted (notably WARN-1's
   * per-image overwrite guard existed only in batch).
   *
   * Source of truth rule:
   *   - If anchor has no caption OR caller forces regen → call AI.
   *   - Otherwise → reuse anchor's existing caption (no AI cost).
   *
   * Callers pass `{ force: true }` when an explicit user "Regenerate"
   * should overwrite siblings' existing captions AND re-call AI even
   * when the anchor is already captioned.
   *
   * Returns the (possibly updated) anchor for callers that need it.
   */
  const fanCaptionToGroup = async (
    anchor: GeneratedImage,
    rest: GeneratedImage[],
    opts: { force?: boolean } = {},
  ): Promise<GeneratedImage | undefined> => {
    const force = opts.force === true;
    // SHOULDFIX-002: if anchor already has a caption and caller didn't
    // force regen, propagate it verbatim — no AI call. Unifies what
    // used to be an inline branch in batchCaptionImages.
    const useExisting = !force && !!anchor.postCaption;
    const withCaption = useExisting ? anchor : await generatePostContent(anchor);
    if (!withCaption?.postCaption) return withCaption;
    // V040-003: route the sibling fan-out through the shared verbatim
    // propagator so the WARN-1 "don't overwrite a manually-edited
    // sibling caption" guard lives in exactly one place.
    propagateCaptionToGroup(rest, withCaption.postCaption, withCaption.postHashtags, {
      skipExisting: !force,
      excludeId: anchor.id,
    });
    return withCaption;
  };

  /**
   * V040-003: verbatim caption propagation across a carousel group.
   * Single helper for every "set this caption on every image in the
   * group" action — captioning-view and post-ready-view textarea
   * onChange (where the user just typed something), plus
   * fanCaptionToGroup's sibling fan-out after AI generation.
   *
   * - `skipExisting`: when true, leaves images that already carry a
   *   `postCaption` untouched. Matches fanCaptionToGroup's WARN-1
   *   guard. Live-typing call sites pass false (or omit) so every
   *   image stays in sync with the editor.
   * - `excludeId`: when set, skips the image with that id entirely.
   *   fanCaptionToGroup uses it to avoid re-patching the anchor
   *   (which `generatePostContent` already wrote).
   * - `hashtags === undefined` leaves each image's hashtags intact —
   *   the textarea callers don't touch hashtags.
   */
  const propagateCaptionToGroup = (
    group: GeneratedImage[],
    caption: string,
    hashtags: string[] | undefined,
    opts: { skipExisting?: boolean; excludeId?: string } = {},
  ) => {
    const { skipExisting = false, excludeId } = opts;
    for (const ci of group) {
      if (excludeId && ci.id === excludeId) continue;
      if (skipExisting && ci.postCaption) continue;
      const patch: Partial<GeneratedImage> = { postCaption: caption };
      if (hashtags !== undefined) patch.postHashtags = hashtags;
      patchImage(ci, patch);
    }
  };

  /** Remove one hashtag by index and persist. */
  const removeHashtag = (img: GeneratedImage, index: number) => {
    const next = (img.postHashtags || []).filter((_, i) => i !== index);
    patchImage(img, { postHashtags: next });
  };

  /**
   * Generate captions for every visible uncaptioned image.
   *
   * PROP-019/OPT-004: runs up to CONCURRENCY entries in parallel via a
   * worker pool. Cap matches PROP-017's pipeline captioning pool and
   * respects pi.dev rate limits.
   *
   * Carousel-aware: when the captioning view is grouped, each carousel
   * counts as ONE caption job — caption the anchor once, fan the result
   * out to every image in the group. Mirrors the per-card Generate button.
   */
  const batchCaptionImages = async (candidates: GeneratedImage[]) => {
    type Entry =
      | { kind: 'single'; img: GeneratedImage }
      | { kind: 'carousel'; anchor: GeneratedImage; rest: GeneratedImage[] };

    const entries: Entry[] = [];
    if (captioningGrouped) {
      for (const v of computeCarouselView(candidates)) {
        if (v.kind === 'carousel') {
          if (v.images.every((i) => i.postCaption)) continue;
          const [anchor, ...rest] = v.images;
          // SHOULDFIX-002: fanCaptionToGroup internally decides whether
          // to call AI (anchor has no caption) or propagate the
          // anchor's existing caption (no AI cost). Both branches live
          // in the helper now — no inline divergence.
          entries.push({ kind: 'carousel', anchor, rest });
        } else if (!v.img.postCaption) {
          entries.push({ kind: 'single', img: v.img });
        }
      }
    } else {
      for (const img of candidates) {
        if (!img.postCaption) entries.push({ kind: 'single', img });
      }
    }

    if (entries.length === 0) return;
    const total = entries.length;
    setBatchCaptioning(true);
    setBatchProgress({ done: 0, total });
    try {
      const CONCURRENCY = 3;
      let cursor = 0;
      let done = 0;
      const runWorker = async () => {
        while (true) {
          const i = cursor++;
          if (i >= total) return;
          const entry = entries[i];
          const anchor = entry.kind === 'single' ? entry.img : entry.anchor;
          setPreparingPostId(anchor.id);
          try {
            if (entry.kind === 'carousel') {
              await fanCaptionToGroup(anchor, entry.rest);
            } else {
              await generatePostContent(anchor);
            }
          } catch {
            // individual batch failure — continue to next entry
          }
          done++;
          setBatchProgress({ done, total });
        }
      };
      const workerCount = Math.min(CONCURRENCY, total);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    } finally {
      setPreparingPostId(null);
      setBatchCaptioning(false);
      // Leave the final progress on screen briefly so the user sees "N/N".
      setTimeout(() => setBatchProgress(null), 2000);
    }
  };

  // Pi.dev runtime status, polled when the Settings panel is open.
  const [piStatus, setPiStatus] = useState<PiStatus | null>(null);
  const [piBusy, setPiBusy] = useState<PiBusy>(null);
  const [piError, setPiError] = useState<string | null>(null);
  const [piSetupMsg, setPiSetupMsg] = useState<string | null>(null);
  // Renamed from mmxSetupMsg in NCA-INTEGRATION-DESIGN; the AI agent's
  // setup-message string is now provider-agnostic (used for nca-side
  // success/pending banners). Multimodal mmx flows have their own state.
  const [ncaSetupMsg, setNcaSetupMsg] = useState<string | null>(null);
  const piAutoBootRef = useRef(false);

  const refreshPiStatus = async (): Promise<PiStatus | null> => {
    try {
      const res = await fetch('/api/pi/status');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json() as PiStatus;
      setPiStatus(data);
      return data;
    } catch (e: unknown) {
      setPiError(getErrorMessage(e) || 'Failed to fetch pi status');
      return null;
    }
  };

  // Autonomous pi boot: on first mount, check status → install if missing
  // → start if installed but not running. Runs once per page load. Auth is
  // the only step that requires user action (Sign In button below).
  useEffect(() => {
    if (piAutoBootRef.current) return;
    piAutoBootRef.current = true;
    (async () => {
      const initial = await refreshPiStatus();
      if (!initial) return;

      let s = initial;
      if (!s.installed) {
        setPiBusy('install');
        try {
          const res = await fetch('/api/pi/install', { method: 'POST' });
          const data = await res.json() as { success?: boolean; stderr?: string; error?: string };
          if (!res.ok || data.success === false) {
            setPiError(data.stderr || data.error || 'Auto-install failed');
          }
        } catch (e) {
          setPiError(getErrorMessage(e) || 'Auto-install failed');
        } finally {
          setPiBusy(null);
        }
        s = (await refreshPiStatus()) || s;
      }

      if (s.installed && s.authenticated && !s.running) {
        setPiBusy('start');
        try {
          const res = await fetch('/api/pi/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt: settings.agentPrompt || '' }),
          });
          const data = await res.json() as { success?: boolean; error?: string };
          if (!res.ok || data.success === false) {
            setPiError(data.error || 'Auto-start failed');
          }
        } catch (e) {
          setPiError(getErrorMessage(e) || 'Auto-start failed');
        } finally {
          setPiBusy(null);
        }
        await refreshPiStatus();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showSettings) refreshPiStatus();
  }, [showSettings]);

  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener('mashup:open-settings', handler);
    return () => window.removeEventListener('mashup:open-settings', handler);
  }, []);

  // handlePiInstall / handlePiStart / handlePiStop intentionally removed —
  // pi install + start are autonomous (see piAutoBootRef effect). Only the
  // auth step (handlePiSetup → /api/pi/setup) requires user interaction.

  const handlePiSetup = async () => {
    setPiBusy('setup');
    setPiError(null);
    try {
      const res = await fetch('/api/pi/setup', { method: 'POST' });
      const data = await res.json() as { success?: boolean; error?: string; tmuxSession?: string };
      if (!res.ok || data.success === false) {
        setPiError(data.error || 'Setup failed');
      } else {
        setPiSetupMsg(data.tmuxSession || 'pi-setup');
      }
    } finally {
      setPiBusy(null);
    }
  };

  const PREDEFINED_PROMPTS = [
    "Darth Vader as a Space Marine in the Warhammer 40k universe, grimdark style",
    "Iron Man's Hulkbuster armor redesigned by Mandalorian armorers, Beskar plating",
    "Batman investigating a Genestealer Cult in the underhive of Necromunda",
    "The Millennium Falcon being chased by a fleet of Borg Cubes",
    "Wonder Woman wielding a Thunder Hammer leading a charge against Chaos Daemons"
  ];

  /**
   * Set when the user pushes an Idea Board concept into Compare — tells
   * the comparisonResults watcher below to auto-collapse the resulting
   * images into a single CarouselGroup once they're all ready, but only
   * when pipelineCarouselMode is on. Ref (not state) so flipping it
   * doesn't cause a re-render and the watcher reads the freshest value.
   */
  const pendingIdeaCarouselRef = useRef(false);

  const handlePushIdeaToCompare = async (prompt: string) => {
    // V050-006: body extracted to lib/push-idea-to-studio.ts so the
    // wiring (param-suggest call, state setter fan-out) is unit-testable.
    await pushIdeaToStudio(prompt, {
      setIsPushing,
      setView,
      setComparisonPrompt,
      setComparisonModels,
      setComparisonOptions,
      setParamSuggestion,
      armCarouselWatcher: () => { pendingIdeaCarouselRef.current = true; },
      suggest: suggestParametersAI,
      availableModels: LEONARDO_MODELS,
      modelGuides: MODEL_PROMPT_GUIDES,
      availableStyles: LEONARDO_SHARED_STYLES,
      savedImages,
    });
  };

  /**
   * Auto-collapse Ideas Board comparison runs into a single carousel.
   * Fires when: (1) the user just pushed an idea into Compare (ref armed),
   * (2) pipelineCarouselMode is on, and (3) all comparisonResults are in
   * the 'ready' state with usable media. Creates one CarouselGroup in
   * settings.carouselGroups and disarms the ref so a subsequent manual
   * Compare run isn't also grouped.
   */
  useEffect(() => {
    if (!pendingIdeaCarouselRef.current) return;
    if (!settings.pipelineCarouselMode) {
      pendingIdeaCarouselRef.current = false;
      return;
    }
    if (comparisonResults.length < 2) return;
    const allReady = comparisonResults.every(
      (img) => img.status === 'ready' && (img.base64 || img.url),
    );
    if (!allReady) return;
    pendingIdeaCarouselRef.current = false;
    const nowStamp = Date.now();
    const groupId = `carousel-idea-${nowStamp}-${Math.random().toString(36).slice(2, 8)}`;
    persistCarouselGroup(
      groupId,
      comparisonResults.map((i) => i.id),
      { status: 'draft' },
    );
  }, [comparisonResults, settings.pipelineCarouselMode, persistCarouselGroup]);

  useEffect(() => {
    const storedModels = localStorage.getItem('mashup_comparison_models');
    if (storedModels) {
      try {
        const parsed = JSON.parse(storedModels);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setComparisonModels(parsed);
          return;
        }
      } catch {
        // parse failure — fall through to defaults below
      }
    }
    // Default: all three models selected
    setComparisonModels(LEONARDO_MODELS.map(m => m.id));
  }, []);

  useEffect(() => {
    localStorage.setItem('mashup_comparison_models', JSON.stringify(comparisonModels));
  }, [comparisonModels]);

  // Clean up stale per-model overrides when comparison models change.
  useEffect(() => {
    setPerModelOverrides(prev => {
      const modelSet = new Set(comparisonModels);
      const filtered = Object.fromEntries(
        Object.entries(prev).filter(([key]) => modelSet.has(key))
      );
      // Avoid unnecessary re-render if nothing changed.
      if (Object.keys(filtered).length === Object.keys(prev).length) return prev;
      return filtered;
    });
  }, [comparisonModels]);

  /** Preview per-model parameters whenever the prompt or models change. */
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!comparisonPrompt.trim() || comparisonModels.length === 0) {
      setModelPreviews({});
      return;
    }
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      const previews: Record<string, { prompt?: string; style?: string; aspectRatio?: string; negativePrompt?: string; lighting?: string; angle?: string }> = {};
      await Promise.all(comparisonModels.map(async (modelId) => {
        try {
          const overrides = perModelOverrides[modelId];
          const enh = await enhancePromptForModel(comparisonPrompt, modelId, {
            style: overrides?.style ?? comparisonOptions.style,
            aspectRatio: overrides?.aspectRatio ?? comparisonOptions.aspectRatio,
            negativePrompt: overrides?.negativePrompt ?? comparisonOptions.negativePrompt,
          });
          previews[modelId] = {
            prompt: enh.prompt,
            style: enh.style,
            aspectRatio: enh.aspectRatio,
            negativePrompt: enh.negativePrompt,
          };
        } catch { /* ignore */ }
      }));
      setModelPreviews(prev => {
        const same = Object.keys(prev).length === Object.keys(previews).length
          && Object.entries(prev).every(([k, v]) => JSON.stringify(v) === JSON.stringify(previews[k]));
        return same ? prev : previews;
      });
    }, 800);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [
    comparisonPrompt,
    comparisonModels,
    comparisonOptions.style,
    comparisonOptions.aspectRatio,
    comparisonOptions.negativePrompt,
    perModelOverrides,
  ]);

  // BUG-CRIT-011: live ref so the auto-poster can re-check status
  // immediately before each fetch. The outer effect's snapshot is taken
  // when the tick fires; if the user rejects a post mid-loop the
  // snapshot still says 'scheduled' and the post would publish anyway.
  // Reading scheduledPostsRef.current at fetch time closes that race.
  const scheduledPostsRef = useRef(settings.scheduledPosts);
  useEffect(() => {
    scheduledPostsRef.current = settings.scheduledPosts;
  }, [settings.scheduledPosts]);

  // Auto-posting effect
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!settings.scheduledPosts || settings.scheduledPosts.length === 0) return;

      const now = new Date();
      // Snapshot the list of posts we'll consider for THIS tick. We only
      // compute statuses against this snapshot, but persist via a
      // functional updater that merges patches by id — so any new posts
      // the user (or the pipeline) added during the async loop are
      // preserved instead of being clobbered.
      const snapshot = [...settings.scheduledPosts];

      // Shared credentials payload — same shape as postCarouselNow /
      // postImageNow so the /api/social/post route doesn't care whether
      // the publish was triggered manually or by the worker.
      const credentials = {
        instagram: settings.apiKeys.instagram,
        twitter: settings.apiKeys.twitter,
        pinterest: settings.apiKeys.pinterest,
        discord: { webhookUrl: settings.apiKeys.discordWebhook },
      };

      // Posts handled as part of a carousel group — we skip these when
      // we encounter their siblings later in the loop so each group is
      // published exactly once.
      const processedIds = new Set<string>();
      // id → next status. Applied via functional updater at the end so
      // we never overwrite the latest scheduledPosts list.
      const statusPatches = new Map<string, ScheduledPost['status']>();

      for (const post of snapshot) {
        if (processedIds.has(post.id)) continue;
        if (post.status !== 'scheduled') continue;
        // AUTOPOST-INVALID-DATE-FIX: see lib/autopost-due.ts. The previous
        // inline `if (now < postDate) continue;` let malformed date/time
        // fields fall through (Invalid Date comparisons are false) so
        // single-image posts with corrupted scheduling fields fired
        // unconditionally on the first auto-poster tick.
        const due = postDueState(post, now);
        if (due === 'invalid') {
          console.error('[auto-poster] skipping post with invalid date/time', {
            postId: post.id,
            date: post.date,
            time: post.time,
            status: post.status,
          });
          continue;
        }
        if (due === 'future') continue;

        // ── Carousel branch ────────────────────────────────────────
        if (post.carouselGroupId) {
          const groupPosts = snapshot.filter(
            (p) => p.carouselGroupId === post.carouselGroupId && p.status === 'scheduled'
          );

          // They share a date/time by construction, but double-check
          // in case the user edited one of them.
          const allDue = groupPosts.every((p) => postDueState(p, now) === 'due');
          if (!allDue) {
            groupPosts.forEach((gp) => processedIds.add(gp.id));
            continue;
          }

          const groupImages = groupPosts
            .map((gp) => savedImages.find((img) => img.id === gp.imageId))
            .filter((x): x is GeneratedImage => !!x);

          if (groupImages.length === 0) {
            groupPosts.forEach((gp) => {
              statusPatches.set(gp.id, 'failed');
              processedIds.add(gp.id);
            });
            continue;
          }

          // BUG-CRIT-011: re-check live status of every group member
          // right before the fetch. If the user rejected any sibling
          // between snapshot and now, abort the whole carousel publish.
          const liveScheduledPosts = scheduledPostsRef.current;
          const groupStillPostable = groupPosts.every((gp) =>
            isStillScheduled(gp.id, liveScheduledPosts),
          );
          if (!groupStillPostable) {
            groupPosts.forEach((gp) => processedIds.add(gp.id));
            continue;
          }

          try {
            const mediaUrls = groupImages.map((i) => i.url).filter(Boolean) as string[];
            // Fix 5 (mmx brief): old content sometimes lands here with
            // every Leonardo URL expired AND no base64 fallback. Bail
            // early with an actionable error instead of letting the
            // server try to fetch dead URLs.
            if (mediaUrls.length === 0) {
              throw new Error(
                'No usable image source — every carousel member is missing both url and base64 (Leonardo URL likely expired)'
              );
            }
            const res = await fetch('/api/social/post', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                caption: post.caption,
                platforms: post.platforms,
                mediaUrls,
                credentials,
              }),
            });
            let data: { error?: string };
            try { data = await res.json() as { error?: string }; }
            catch { throw new Error(`Server error (HTTP ${res.status})`); }
            if (!res.ok) throw new Error(data.error || 'Failed to post carousel');

            groupPosts.forEach((gp) => {
              statusPatches.set(gp.id, 'posted');
              processedIds.add(gp.id);
            });
          } catch (e: unknown) {
            const reason = e instanceof Error ? e.message : String(e);
            // Fix 5: surface the failure reason on every member's chip
            // and log structured context so old-content failures are
            // diagnosable instead of mysteriously red.
            console.error('[auto-poster] carousel publish failed', {
              postId: post.id,
              carouselGroupId: post.carouselGroupId,
              date: post.date,
              time: post.time,
              platforms: post.platforms,
              memberCount: groupPosts.length,
              reason,
            });
            const groupKey = `carousel-${post.carouselGroupId ?? post.id}`;
            setPostStatus((prev) => ({ ...prev, [groupKey]: `Error: ${reason}` }));
            groupPosts.forEach((gp) => {
              statusPatches.set(gp.id, 'failed');
              processedIds.add(gp.id);
              setPostStatus((prev) => ({ ...prev, [gp.imageId]: `Error: ${reason}` }));
            });
            showToast(`Scheduled carousel post failed: ${reason}`, 'error');
          }
          continue;
        }

        // ── Single-image branch (existing behaviour) ─────────────
        const image = savedImages.find((img) => img.id === post.imageId);
        if (!image) {
          // Fix 5: explain the missing-image case so users understand
          // why an old post failed (image was pruned from gallery).
          const reason = `Source image ${post.imageId} no longer exists in gallery`;
          console.error('[auto-poster] image missing', { postId: post.id, imageId: post.imageId });
          setPostStatus((prev) => ({ ...prev, [post.imageId]: `Error: ${reason}` }));
          statusPatches.set(post.id, 'failed');
          continue;
        }

        // BUG-CRIT-011: re-check live status right before the fetch.
        // If the user rejected this post between snapshot and now,
        // skip without marking failed — the rejection is a normal
        // outcome, not a posting error.
        if (!isStillScheduled(post.id, scheduledPostsRef.current)) {
          continue;
        }

        try {
          // Fix 5 (mmx brief): old content fails when both image.url is
          // a stale Leonardo signed URL AND no base64 fallback survives.
          // Pre-flight the missing-source case so the failure reason is
          // user-actionable instead of a generic "Failed to post".
          if (!image.url && !image.base64) {
            throw new Error(
              'No usable image source — both url and base64 are missing (Leonardo URL likely expired and image was never re-hosted)'
            );
          }
          if (!post.platforms || post.platforms.length === 0) {
            throw new Error('No platforms selected on the scheduled post');
          }
          const res = await fetch('/api/social/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caption: post.caption,
              platforms: post.platforms,
              mediaUrl: image.url,
              mediaBase64: image.base64,
              credentials,
            }),
          });

          let data: { error?: string };
          try { data = await res.json() as { error?: string }; }
          catch { throw new Error(`Server error (HTTP ${res.status})`); }
          if (!res.ok) throw new Error(data.error || 'Failed to post');

          statusPatches.set(post.id, 'posted');
        } catch (e: unknown) {
          const reason = e instanceof Error ? e.message : String(e);
          console.error('[auto-poster] single publish failed', {
            postId: post.id,
            imageId: post.imageId,
            date: post.date,
            time: post.time,
            platforms: post.platforms,
            hasUrl: !!image.url,
            hasBase64: !!image.base64,
            reason,
          });
          setPostStatus((prev) => ({ ...prev, [post.imageId]: `Error: ${reason}` }));
          statusPatches.set(post.id, 'failed');
          showToast(`Scheduled post failed: ${reason}`, 'error');
        }
      }

      if (statusPatches.size > 0) {
        updateSettings((prev) => ({
          scheduledPosts: (prev.scheduledPosts || []).map((p) =>
            statusPatches.has(p.id) ? { ...p, status: statusPatches.get(p.id)! } : p
          ),
        }));
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [settings.scheduledPosts, settings.apiKeys, savedImages, updateSettings]);

  const allTags = useMemo(
    () => Array.from(new Set(savedImages.flatMap(img => img.tags || []))).sort(),
    [savedImages],
  );

  const displayedImages = useMemo(() => {
    // V080-DEV-002: hide images whose ScheduledPosts are all 'rejected'.
    // BUG-DEV-003 stopped these from being orphaned (pipelinePending is
    // cleared on reject so deletion / debug surfaces can see them); this
    // layer keeps them out of the user-visible Gallery per Maurice's call.
    // Images with mixed statuses or no posts at all stay visible.
    const allRejectedImageIds = getAllRejectedImageIds(settings.scheduledPosts || []);
    return (view === 'studio' ? images : savedImages)
      .filter(img => {
        // V040-HOTFIX-007: Gallery shows finalized images only. Pipeline
        // images awaiting approval carry pipelinePending=true and are
        // hidden here; they reappear when the user approves the
        // associated ScheduledPost via the pipeline approval queue.
        if (img.pipelinePending === true) return false;
        if (allRejectedImageIds.has(img.id)) return false;
        const matchesSearch = img.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             img.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesModel = filterModel === 'all' || img.modelInfo?.modelId === filterModel;
        const matchesUniverse = filterUniverse === 'all' || img.universe === filterUniverse;
        const matchesCollection = selectedCollectionId === 'all' || img.collectionId === selectedCollectionId;

        const matchesTag = !tagQuery.trim() || (() => {
          const query = tagQuery.toLowerCase();
          const orParts = query.split(/\s+or\s+|,/i);
          return orParts.some(part => {
            const andParts = part.trim().split(/\s+and\s+|;/i);
            return andParts.every(term => {
              term = term.trim();
              if (term.startsWith('not ') || term.startsWith('-')) {
                const excluded = term.replace(/^not\s+|-/, '').trim();
                return !img.tags?.some(t => t.toLowerCase() === excluded);
              } else {
                return img.tags?.some(t => t.toLowerCase() === term);
              }
            });
          });
        })();

        return matchesSearch && matchesModel && matchesUniverse && matchesCollection && matchesTag;
      })
      .sort((a, b) => {
        const timeA = a.savedAt || 0;
        const timeB = b.savedAt || 0;
        return sortBy === 'newest' ? timeB - timeA : timeA - timeB;
      });
  }, [view, images, savedImages, settings.scheduledPosts, searchQuery, filterModel, filterUniverse, selectedCollectionId, tagQuery, sortBy]);

  /**
   * Active Post-Ready images — everything flagged `isPostReady` EXCEPT:
   *  - posts where every scheduled entry has already been sent (→ History)
   *  - images with postedAt (manually posted without a scheduled post → History)
   * Images with no scheduledPosts at all (freshly captioned, not yet scheduled)
   * are kept here — `every` on an empty list returns true, so we explicitly
   * require at least one 'posted' post before hiding.
   */
  const postReadyImages = useMemo(() => {
    const allPosts = settings.scheduledPosts || [];
    const filtered = savedImages.filter((i) => {
      if (i.isPostReady !== true) return false;
      // Manually posted (Post Now) without a scheduled post → History
      if (i.postedAt) return false;
      const posts = allPosts.filter((p) => p.imageId === i.id);
      if (posts.length === 0) return true;
      return !posts.every((p) => p.status === 'posted');
    });
    // Sort: scheduled items first (soonest date+time at top), unscheduled after.
    const upcomingFor = (imageId: string) =>
      allPosts.find((p) => p.imageId === imageId && p.status !== 'posted');
    return filtered.slice().sort((a, b) => {
      const aPost = upcomingFor(a.id);
      const bPost = upcomingFor(b.id);
      if (aPost && bPost) {
        const aTime = new Date(`${aPost.date}T${aPost.time}`).getTime();
        const bTime = new Date(`${bPost.date}T${bPost.time}`).getTime();
        return aTime - bTime;
      }
      if (aPost) return -1;
      if (bPost) return 1;
      return 0;
    });
  }, [savedImages, settings.scheduledPosts]);

  /**
   * History — Post-Ready images that are done:
   *  - All their ScheduledPosts have been posted, OR
   *  - They have a postedAt timestamp (manually posted via Post Now)
   * Shown in the History view so the user can still see what went out
   * without cluttering the active grid.
   */
  const postedImages = useMemo(
    () =>
      savedImages.filter((i) => {
        if (i.isPostReady !== true) return false;
        // Manually posted (Post Now) without a scheduled post → History
        if (i.postedAt && i.postedAt > 0) return true;
        const posts = (settings.scheduledPosts || []).filter((p) => p.imageId === i.id);
        return posts.length > 0 && posts.every((p) => p.status === 'posted');
      }),
    [savedImages, settings.scheduledPosts],
  );

  const galleryStats = useMemo(() => {
    let tagged = 0;
    let captioned = 0;
    for (const img of savedImages) {
      if (img.tags && img.tags.length > 0) tagged++;
      if (img.postCaption) captioned++;
    }
    return { total: savedImages.length, tagged, captioned };
  }, [savedImages]);

  const handlePushToCompare = (prompt: string, options: GenerateOptions) => {
    setComparisonPrompt(prompt);
    setComparisonOptions(options);
    setView('compare');
  };

  // V082-PARAM-SCRIPT: deterministic rule engine. Reads the prompt for
  // subject/style/theme cues, looks up each model's supported parameters,
  // and emits per-model panels that respect each model's capabilities.
  // The pi.dev variant was retired (it produced wrong values for
  // capability-aware models); rule-based is now the normal path.
  const handleSuggestParameters = async () => {
    if (!comparisonPrompt.trim()) {
      showToast('Enter a prompt first so we can suggest parameters.', 'error');
      return;
    }
    setIsSuggesting(true);
    try {
      // AI-PARAM-SUGGEST (2026-05-20): route the AI call through the
      // user's selected text-AI backend (settings.activeAiAgent). The
      // capability-aware post-filter inside suggestParametersAI strips
      // any field the AI hallucinates that violates a model's spec, so
      // we don't repeat the V082 failure of proposing styles for
      // gpt-image-1.5 etc. If the AI fails / parse fails, it silently
      // falls back to the rule engine.
      const suggestion = await suggestParametersAI(
        {
          prompt: comparisonPrompt,
          availableModels: LEONARDO_MODELS,
          modelGuides: MODEL_PROMPT_GUIDES,
          availableStyles: LEONARDO_SHARED_STYLES,
          savedImages,
          includedModelIds: comparisonModels,
        },
        {
          aiCall: (message, signal) =>
            streamAIToString(message, {
              provider: settings.activeAiAgent,
              mode: 'chat',
              signal,
            }),
        },
      );
      setParamSuggestion(suggestion);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleApplySuggestion = (
    modelIds: string[],
    options: Partial<GenerateOptions>,
    perModel: Record<string, PerModelSuggestion>,
  ) => {
    setComparisonModels(prev => {
      const merged = new Set(prev);
      for (const id of modelIds) merged.add(id);
      return Array.from(merged);
    });
    setComparisonOptions(prev => ({ ...prev, ...options }));
    // V030-008-per-model: extract per-model overrides so each model
    // can use its own style / aspectRatio / negativePrompt during
    // preview and generation instead of sharing the first model's values.
    const overrides: Record<string, { style?: string; aspectRatio?: string; negativePrompt?: string }> = {};
    for (const id of modelIds) {
      const entry = perModel[id];
      if (!entry) continue;
      overrides[id] = entry.type === 'image'
        ? {
            aspectRatio: entry.aspectRatio,
            style: entry.style,
            negativePrompt: entry.negativePrompt,
          }
        : { aspectRatio: entry.aspectRatio };
    }
    setPerModelOverrides(overrides);
    setParamSuggestion(null);
    showToast('Parameters applied. You can still tweak anything before generating.', 'success');
  };

  const handleCompare = async () => {
    if (comparisonModels.length < 2) {
      showToast('Please select at least 2 models to compare.', 'error');
      return;
    }
    if (!comparisonPrompt.trim()) {
      showToast('Please enter a prompt for comparison.', 'error');
      return;
    }

    setIsComparing(true);
    try {
      // Merge per-model overrides into cached enhancements so each model
      // uses its own style / aspectRatio / negativePrompt during generation.
      const mergedEnhancements: Record<string, { prompt?: string; style?: string; aspectRatio?: string; negativePrompt?: string }> = { ...modelPreviews };
      for (const [id, overrides] of Object.entries(perModelOverrides)) {
        mergedEnhancements[id] = {
          ...mergedEnhancements[id],
          ...overrides,
        };
      }
      await generateComparison(comparisonPrompt, comparisonModels, comparisonOptions, mergedEnhancements);
    } catch {
      // generateComparison already surfaces error via setComparisonError
    } finally {
      setIsComparing(false);
    }
  };

  const handleAnimate = async (img: GeneratedImage, isBatch: boolean = false) => {
    if (!img.imageId) {
      if (!isBatch) showToast('Only images generated with Leonardo.AI can be animated currently.', 'error');
      return;
    }
    
    setImageStatus(img.id, 'animating');
    
    try {
      let duration = settings.defaultAnimationDuration || 5;
      let style = settings.defaultAnimationStyle || 'Standard';

      // Dynamically determine best duration and style
      try {
        const dynamicText = await streamAIToString(
          `Analyze this image prompt: "${img.prompt}".
        Determine the best video animation duration (3, 5, or 10 seconds) and the best animation style (Standard, Cinematic, Dynamic, Slow Motion, Fast Motion).
        - Use 3 or 5 seconds for simple actions or portraits.
        - Use 10 seconds for complex scenes, epic landscapes, or slow-motion.
        - Choose a style that fits the mood (e.g., Cinematic for epic scenes, Dynamic for action, Slow Motion for dramatic moments).
        Return ONLY a JSON object with keys "duration" (number) and "style" (string).`,
          { mode: 'generate', provider: settings.activeAiAgent, model: settings.activeTextModel }
        );
        const dynamicSettings = extractJsonObjectFromLLM(dynamicText);
        const rawDuration = dynamicSettings.duration;
        if (rawDuration === 3 || rawDuration === 5 || rawDuration === 10) {
          duration = rawDuration;
        }
        const rawStyle = dynamicSettings.style;
        if (typeof rawStyle === 'string' && rawStyle.length > 0) {
          style = rawStyle;
        }

        // Update settings in UI to reflect the dynamically chosen values
        updateSettings({
          defaultAnimationDuration: duration as 3 | 5 | 10,
          defaultAnimationStyle: style
        });
      } catch {
        // parse failure — use settings defaults for duration/style
      }

      let videoPrompt = style === 'Standard' ? img.prompt : `${img.prompt}. Motion style: ${style}`;
      try {
        const enhanced = await streamAIToString(
          `The user wants to animate an image based on this prompt: "${img.prompt}". Enhance this prompt for a video animation. Focus heavily on "what if" scenarios, alternative universes, different timelines, and epic crossovers for Star Wars, Marvel, DC, and Warhammer 40k. Motion style: ${style}. Return ONLY the enhanced animation prompt as a single string.`,
          { mode: 'enhance', provider: settings.activeAiAgent, model: settings.activeTextModel }
        );
        if (enhanced.trim()) videoPrompt = enhanced.trim();
      } catch {
        // enhancement failed — proceed with original videoPrompt
      }

      const res = await fetch('/api/leonardo-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt,
          imageId: img.imageId,
          duration: duration,
          model: settings.defaultVideoModel || 'ray-v2',
          apiKey: settings.apiKeys.leonardo
        })
      });

      if (!res.ok) {
        let errMessage = 'Failed to animate image';
        try {
          const err = await res.json() as { error?: string };
          errMessage = err.error || errMessage;
        } catch (e) {
          const text = await res.text();
          errMessage = `Server error (${res.status}): ${text.slice(0, 100)}...`;
        }
        throw new Error(errMessage);
      }

      const data = await res.json() as { generationId?: string };

      if (data.generationId) {
        let status = 'PENDING';
        let attempts = 0;
        let videoUrl = '';
        
        while (status !== 'COMPLETE' && attempts < 60) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
          const statusRes = await fetch(`/api/leonardo/${data.generationId}`);
          if (!statusRes.ok) {
            const errText = await statusRes.text();
            throw new Error(`Failed to check status: ${errText.slice(0, 100)}`);
          }
          const statusData = await statusRes.json() as { status?: string; url?: string; error?: string };
          status = statusData.status ?? 'PENDING';
          if (status === 'COMPLETE') {
            videoUrl = statusData.url ?? '';
          } else if (status === 'FAILED') {
            throw new Error(statusData.error || 'Leonardo video generation failed');
          }
        }
        
        if (status !== 'COMPLETE') {
          throw new Error('Timeout waiting for Leonardo video generation');
        }
        
        if (videoUrl) {
          let finalVideoUrl = videoUrl;
          // Watermark logic for video could be added here if supported by a backend service, 
          // but since we can't easily overlay video watermarks in browser without ffmpeg,
          // we will handle it via CSS overlay in the UI.

          const ensureTags = async (prompt: string, existingTags?: string[]) => {
            if (existingTags && existingTags.length > 0) return existingTags;
            try {
              const text = await streamAIToString(
                `Analyze this image prompt: "${prompt}". Generate 5-8 fitting tags (universe, character, style, theme). Return ONLY a JSON array of strings.`,
                { mode: 'tag', provider: settings.activeAiAgent, model: settings.activeTextModel }
              );
              const parsed = extractJsonArrayFromLLM(text);
              const strTags = parsed.filter((t): t is string => typeof t === 'string');
              return strTags.length > 0 ? strTags : ['Mashup'];
            } catch {
              return ['Mashup'];
            }
          };

          const generatedTags = await ensureTags(videoPrompt, img.tags);

          const newImg: GeneratedImage = {
            id: `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url: finalVideoUrl,
            prompt: `Animated: ${img.prompt}`,
            tags: generatedTags,
            savedAt: Date.now(),
            isVideo: true,
            modelInfo: {
              provider: 'leonardo',
              modelId: settings.defaultVideoModel || 'ray-v2',
              modelName: settings.defaultVideoModel === 'kling-video-o-3' ? 'Kling O3 Omni' : settings.defaultVideoModel === 'kling-3.0' ? 'Kling 3.0' : settings.defaultVideoModel === 'ray-v2' ? 'Ray V2' : 'Ray V1'
            }
          };
          saveImage(newImg);
          if (!isBatch) showToast('Video generated and saved to gallery!', 'pipeline-ready');
        }
      }
    } catch (e: unknown) {
      if (!isBatch) showToast(`Animation failed: ${getErrorMessage(e)}`, 'error');
    } finally {
      setImageStatus(img.id, 'ready');
    }
  };

  const handleBatchAnimate = async () => {
    const imagesToAnimate = savedImages.filter(img => selectedForBatch.has(img.id) && img.imageId && !img.isVideo);
    if (imagesToAnimate.length === 0) {
      showToast('No valid Leonardo images selected for animation.', 'error');
      return;
    }
    setSelectedForBatch(new Set());
    await Promise.allSettled(imagesToAnimate.map(img => handleAnimate(img, true)));
  };

  const handleBatchDelete = () => {
    const ids = Array.from(selectedForBatch);
    if (ids.length === 0) return;
    for (const id of ids) deleteImage(id, true);
    setSelectedForBatch(new Set());
    showToast(`Deleted ${ids.length} image${ids.length === 1 ? '' : 's'}.`, 'success');
  };

  const handleBatchCaption = () => {
    if (selectedForBatch.size === 0) return;
    setView('captioning');
  };

  const handleBatchPostReady = async () => {
    const targets = savedImages.filter(img => selectedForBatch.has(img.id));
    if (targets.length === 0) return;
    await Promise.allSettled(
      targets.map(img => saveImage({ ...img, isPostReady: true })),
    );
    setSelectedForBatch(new Set());
    setView('post-ready');
  };

  const handleSelectAllGallery = () => {
    setSelectedForBatch(new Set(displayedImages.map(img => img.id)));
  };

  const handleClearGallerySelection = () => {
    setSelectedForBatch(new Set());
  };

  const handleBatchAddToCollection = (collectionId: string) => {
    const ids = Array.from(selectedForBatch);
    if (ids.length === 0) return;
    for (const id of ids) addImageToCollection(id, collectionId);
    setSelectedForBatch(new Set());
    const collection = collections.find(c => c.id === collectionId);
    showToast(
      `${ids.length} image${ids.length === 1 ? '' : 's'} added to ${collection?.name ?? 'collection'}.`,
      'success',
    );
  };

  const handleSelectApproved = () => {
    setSelectedForBatch(new Set(displayedImages.filter(img => img.approved).map(img => img.id)));
  };

  const handleSelectInCollection = () => {
    if (selectedCollectionId === 'all') return;
    setSelectedForBatch(
      new Set(displayedImages.filter(img => img.collectionId === selectedCollectionId).map(img => img.id)),
    );
  };

  const handleInvertSelection = () => {
    setSelectedForBatch(
      prev => new Set(displayedImages.filter(img => !prev.has(img.id)).map(img => img.id)),
    );
  };

  // V082-COLLECTION-FEATURES: open the collection modal in "batch" mode.
  // The existing onCreate wiring already forwards selectedForBatch ids
  // and pi.dev auto-naming, but it stopped short of assigning images.
  // See the CollectionModal block below for the assign step added in
  // the same commit.
  const handleBatchCreateCollection = () => {
    if (selectedForBatch.size === 0) return;
    setShowCollectionModal(true);
  };

  // V082-COLLECTION-FEATURES: scan saved images, bucket them by tag, and
  // for each bucket ≥ 3 images create a collection and assign every
  // matching image to it. Uses window.confirm for scope — a bespoke
  // preview modal would be nicer but pushes this past the designer
  // autonomy budget. Existing collection membership is respected:
  // images already in a collection are skipped.
  const handleAutoOrganizeByTag = async () => {
    if (savedImages.length === 0) return;
    const proposals = proposeTagGroups(savedImages, 3);
    if (proposals.length === 0) {
      window.alert('No tag groups found. Tag at least 3 images with the same tag first.');
      return;
    }
    const preview = proposals
      .slice(0, 8)
      .map((g) => `  • ${g.displayName} (${g.imageIds.length})`)
      .join('\n');
    const more = proposals.length > 8 ? `\n  … +${proposals.length - 8} more` : '';
    const ok = window.confirm(
      `Auto-organize will create ${proposals.length} collection${proposals.length === 1 ? '' : 's'}:\n\n${preview}${more}\n\nContinue?`,
    );
    if (!ok) return;
    for (const group of proposals) {
      const collection = await createCollection(group.displayName, undefined, undefined, undefined);
      for (const imageId of group.imageIds) {
        const img = savedImages.find((i) => i.id === imageId);
        if (img && !img.collectionId) addImageToCollection(imageId, collection.id);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative">
      {/* Header */}
      <header className="h-16 glass-panel header-line relative flex items-center justify-between px-4 md:px-6 shrink-0 z-10">
        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="md:hidden p-2 -ml-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-xl bg-[#00e6ff]/15 border border-[#00e6ff]/25 hidden sm:flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#00e6ff]" />
          </div>
          <h1 className="text-base md:text-lg font-semibold tracking-tight text-white truncate max-w-[120px] sm:max-w-none">Mashup Studio</h1>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
          <div className="relative hidden md:block">
            <div className="flex bg-zinc-900/60 rounded-xl p-1 border border-[#c5a062]/15 overflow-x-auto hide-scrollbar snap-x">
              {['ideas', 'compare', 'gallery', 'captioning', 'post-ready', 'pipeline'].map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v as ViewType)}
                  className={`relative px-3 py-1.5 text-sm font-medium rounded-xl transition-all duration-200 flex items-center gap-2 shrink-0 snap-start z-10 ${view === v ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {view === v && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-[#00e6ff]/10 border border-[#00e6ff]/20 rounded-xl"
                      transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {v === 'ideas' && <Lightbulb className="w-4 h-4 hidden sm:block" />}
                    {v === 'compare' && <Sparkles className="w-4 h-4 hidden sm:block" />}
                    {v === 'gallery' && <LayoutGrid className="w-4 h-4 hidden sm:block" />}
                    {v === 'captioning' && <Edit3 className="w-4 h-4 hidden sm:block" />}
                    {v === 'post-ready' && <Save className="w-4 h-4 hidden sm:block" />}
                    {v === 'pipeline' && <Zap className="w-4 h-4 hidden sm:block" />}
                    {v === 'compare'
                      ? 'Studio'
                      : v.charAt(0).toUpperCase() + v.slice(1).replace('-', ' ')}
                  </span>
                </button>
              ))}
            </div>
            {/* Scroll affordance — fades right edge when tabs overflow at tablet width */}
            <div className="pointer-events-none absolute right-0 inset-y-0 w-8 rounded-r-xl bg-gradient-to-l from-[#050505] to-transparent" />
          </div>

          <PipelineStatusStrip setView={setView} />

          <button
            onClick={logout}
            className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors shrink-0"
            title="Log Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
          
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors shrink-0"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          {!hasApiKey && (
            <button
              onClick={checkApiKey}
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 ${uiStatus.warn.subtleBg} ${uiStatus.warn.text} hover:bg-amber-500/20 rounded-lg font-medium text-xs border ${uiStatus.warn.border} transition-all animate-pulse shrink-0`}
            >
              <Tag className="w-3 h-3" />
              Select API Key
            </button>
          )}

        </div>
      </header>

      {/* Mobile bottom nav — replaces the header tab bar below md */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#050505]/95 backdrop-blur-xl border-t border-[#c5a062]/20 pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <div className="flex justify-around items-stretch px-1 py-1">
          {([
            { key: 'ideas', icon: Lightbulb, label: 'Ideas' },
            { key: 'compare', icon: Sparkles, label: 'Studio' },
            { key: 'gallery', icon: LayoutGrid, label: 'Gallery' },
            { key: 'captioning', icon: Edit3, label: 'Caption' },
            { key: 'post-ready', icon: Save, label: 'Post' },
            { key: 'pipeline', icon: Zap, label: 'Pipeline' },
          ] as const).map(({ key, icon: Icon, label }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                aria-current={active ? 'page' : undefined}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] min-w-[44px] rounded-xl transition-all duration-200 ${
                  active ? 'text-[#00e6ff] bg-[#00e6ff]/8' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {view === 'gallery' && (
                <GalleryFilterBar
                  galleryStats={galleryStats}
                  postReadyCount={postReadyImages.length}
                  displayedCount={displayedImages.length}
                  selectedForBatch={selectedForBatch}
                  searchQuery={searchQuery}
                  sortBy={sortBy}
                  filterModel={filterModel}
                  filterUniverse={filterUniverse}
                  selectedCollectionId={selectedCollectionId}
                  tagQuery={tagQuery}
                  collections={collections}
                  onSearchChange={setSearchQuery}
                  onSortChange={setSortBy}
                  onFilterModelChange={setFilterModel}
                  onFilterUniverseChange={setFilterUniverse}
                  onCollectionChange={setSelectedCollectionId}
                  onTagQueryChange={setTagQuery}
                  onBulkTag={() => setShowBulkTagModal(true)}
                  onBatchPostReady={handleBatchPostReady}
                  onBatchCaption={handleBatchCaption}
                  onBatchAnimate={handleBatchAnimate}
                  onBatchDelete={handleBatchDelete}
                  onBatchCreateCollection={handleBatchCreateCollection}
                  onBatchAddToCollection={handleBatchAddToCollection}
                  onAutoOrganizeByTag={handleAutoOrganizeByTag}
                  onSelectAll={handleSelectAllGallery}
                  onClearSelection={handleClearGallerySelection}
                  onSelectApproved={handleSelectApproved}
                  onSelectInCollection={handleSelectInCollection}
                  onInvertSelection={handleInvertSelection}
                />
              )}

              {view === 'ideas' && (
                <IdeasView
                  ideas={ideas}
                  isPushing={isPushing}
                  setView={setView}
                  clearIdeas={clearIdeas}
                  updateIdeaStatus={updateIdeaStatus}
                  deleteIdea={deleteIdea}
                  handlePushIdeaToCompare={handlePushIdeaToCompare}
                />
              )}

              {view === 'compare' && (
                <div className="space-y-8">
                  {/* Section header */}
                  <div className="flex items-center gap-3">
                    <div className="icon-box-blue">
                      <Sparkles className="w-5 h-5 text-[#00e6ff]" />
                    </div>
                    <div>
                      <h2 className="type-title">Mashup Studio</h2>
                      <p className="type-muted">Generate images with different AI models and artistic styles</p>
                    </div>
                  </div>

                  <div className="card p-6 space-y-6">
                    <div className="flex flex-wrap justify-end gap-2">
                        <select
                          className="text-xs bg-zinc-950 border border-zinc-800/60 rounded-xl px-2 py-1 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 max-w-[150px]"
                          onChange={(e) => {
                            if (e.target.value) {
                              setComparisonPrompt(e.target.value);
                              e.target.value = ''; // Reset selection
                            }
                          }}
                        >
                          <option value="">Suggestions...</option>
                          {PREDEFINED_PROMPTS.map((p) => (
                            <option key={p} value={p}>{p.substring(0, 30)}...</option>
                          ))}
                        </select>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-zinc-300">Select Models</label>
                          <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                            {comparisonModels.length} of {LEONARDO_MODELS.length} selected
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {LEONARDO_MODELS.map(model => {
                            const isSelected = comparisonModels.includes(model.id);
                            return (
                              <button
                                key={model.id}
                                onClick={() => {
                                  setComparisonModels(prev =>
                                    prev.includes(model.id)
                                      ? prev.filter(id => id !== model.id)
                                      : [...prev, model.id]
                                  );
                                }}
                                aria-pressed={isSelected}
                                className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all text-left flex items-center justify-between ${
                                  isSelected
                                    ? 'bg-[#c5a062]/15 border-[#c5a062] text-[#c5a062]'
                                    : 'bg-zinc-900 border-zinc-800/60 text-zinc-500 opacity-70 hover:opacity-100 hover:border-[#c5a062]/40'
                                }`}
                              >
                                <span className="truncate mr-2">{model.name}</span>
                                {isSelected
                                  ? <BookmarkCheck className="w-3 h-3 shrink-0" />
                                  : <Plus className="w-3 h-3 shrink-0 text-zinc-600" />
                                }
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-[#00e6ff] flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          Image Prompt
                        </label>
                        <textarea
                          value={comparisonPrompt}
                          onChange={(e) => setComparisonPrompt(e.target.value)}
                          placeholder="Enter a prompt to compare across models..."
                          rows={10}
                          className="w-full bg-zinc-900/60 border border-[#00e6ff]/20 rounded-xl p-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#00e6ff]/20 focus:border-[#00e6ff]/35 min-h-[240px] resize-y shadow-inner shadow-[rgba(0,230,255,0.04)] transition-all duration-200"
                        />
                        <div className="flex items-center justify-end">
                          <button
                            onClick={handleSuggestParameters}
                            disabled={!comparisonPrompt.trim() || isSuggesting}
                            className="text-xs text-[#00e6ff] hover:text-white flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#00e6ff]/25 hover:border-[#00e6ff]/50 bg-[#00e6ff]/5 hover:bg-[#00e6ff]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Ask pi.dev to reason about the best models/style/ratio/quality/negative prompt for this idea"
                          >
                            {isSuggesting ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                pi is thinking…
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3" />
                                Suggest Parameters
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {paramSuggestion && (
                        <ParamSuggestionCard
                          suggestion={paramSuggestion}
                          availableStyles={LEONARDO_SHARED_STYLES}
                          onApply={handleApplySuggestion}
                          onDismiss={() => setParamSuggestion(null)}
                        />
                      )}

                      {isSuggesting && !paramSuggestion && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="flex items-center gap-3 bg-zinc-900/50 border border-[#00e6ff]/20 rounded-xl p-4"
                        >
                          <Loader2 className="w-4 h-4 text-[#00e6ff] animate-spin shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[#00e6ff]">
                              pi is generating model recommendations…
                            </p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">
                              Auto-preview below stays in sync — this adds an applyable suggestion card here.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* AI-Optimized Parameters — read-only per-model indicators.
                          pi pre-computes optimal params per model via
                          lib/modelOptimizer whenever the prompt changes.
                          During generation the same optimizer runs again
                          so these pills accurately preview what will be sent. */}
                      <div className="bg-zinc-900/50 border border-[#c5a062]/15 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <Sparkles className="w-3 h-3" />
                          <span className="uppercase tracking-wider font-medium">AI-Optimized Parameters</span>
                          <span className="text-[10px] text-zinc-600">— pi auto-tunes per model</span>
                        </div>
                        {comparisonModels.length > 0 ? (
                          <div className="space-y-2">
                            {comparisonModels.map((modelId) => {
                              const model = LEONARDO_MODELS.find(
                                (m) => m.id === modelId || m.apiModelId === modelId
                              );
                              const preview = modelPreviews[modelId];
                              const fallbackRatio = model?.aspectRatios?.[0]?.label || '1:1';
                              // STYLE-AI-FIX (2026-05-20): only show the Style
                              // pill / row when this model's spec actually
                              // exposes a style parameter. Otherwise we're
                              // misleading the user — gpt-image-*, minimax,
                              // and every video model silently ignore style.
                              const supportsStyles = getModelSpec(modelId)?.capabilities.styles !== false;
                              return (
                                <div key={modelId} className="flex flex-col gap-1">
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    {model?.name || modelId}
                                  </span>
                                  {preview && (
                                    <details className="mt-2 text-xs border border-zinc-800/60 rounded-lg overflow-hidden">
                                      <summary className="px-3 py-2 cursor-pointer hover:bg-zinc-800/50 flex items-center gap-2 text-zinc-400">
                                        <span className="text-indigo-400">AI Optimized</span>
                                        {supportsStyles && (
                                          <>
                                            <span className="text-zinc-600">|</span>
                                            <span>{preview.style || 'Auto'}</span>
                                          </>
                                        )}
                                        <span className="text-zinc-600">|</span>
                                        <span>{preview.aspectRatio || fallbackRatio}</span>
                                        {preview.negativePrompt && (
                                          <>
                                            <span className="text-zinc-600">|</span>
                                            <span className="text-red-400/70">Negative: yes</span>
                                          </>
                                        )}
                                      </summary>
                                      <div className="px-3 py-2 space-y-2 border-t border-zinc-800 bg-zinc-900/30">
                                        {preview.prompt && (
                                          <div>
                                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Enhanced Prompt</span>
                                            <p className="text-zinc-300 mt-0.5 max-h-[200px] overflow-y-auto whitespace-pre-wrap leading-relaxed">{preview.prompt}</p>
                                          </div>
                                        )}
                                        {supportsStyles && preview.style && (
                                          <div>
                                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Style</span>
                                            <p className="text-zinc-300 mt-0.5">{preview.style}</p>
                                          </div>
                                        )}
                                        {preview.aspectRatio && (
                                          <div>
                                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Aspect Ratio</span>
                                            <p className="text-zinc-300 mt-0.5">{preview.aspectRatio}</p>
                                          </div>
                                        )}
                                        {preview.negativePrompt && (
                                          <div>
                                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Negative Prompt</span>
                                            <p className="text-zinc-300 mt-0.5">{preview.negativePrompt}</p>
                                          </div>
                                        )}
                                      </div>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-600">
                            Select at least 2 models above to see per-model parameters
                          </p>
                        )}
                      </div>

                      <button
                        onClick={handleCompare}
                        disabled={isComparing || comparisonModels.length < 2 || !comparisonPrompt.trim()}
                        className="btn-cta shadow-[0_0_28px_rgba(0,230,255,0.22)]"
                      >
                        {isComparing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            Generate {comparisonModels.length} Images
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {comparisonResults.length > 0 && view === 'compare' && (
                    <div className="space-y-12">
                      <div className="flex justify-end">
                        <button
                          onClick={clearComparison}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Clear Comparison History
                        </button>
                      </div>
                      {Object.entries(
                        comparisonResults.reduce((acc, img) => {
                          const id = img.comparisonId || 'default';
                          if (!acc[id]) acc[id] = [];
                          acc[id].push(img);
                          return acc;
                        }, {} as Record<string, GeneratedImage[]>)
                      ).map(([compId, group]) => (
                        <div key={compId} className="space-y-4">
                          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2 min-w-0">
                                <Columns className="w-4 h-4 shrink-0" />
                                <span className="truncate">Comparison: {group[0]?.prompt.slice(0, 50)}...</span>
                              </h3>
                              <button
                                onClick={() => {
                                  group.forEach(img => deleteComparisonResult(img.id));
                                }}
                                className="shrink-0 text-[10px] text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete Group
                              </button>
                            </div>
                            <span className="shrink-0 text-[10px] text-zinc-500 uppercase tracking-widest">
                              {new Date(parseInt(compId.split('-')[2]) || Date.now()).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                            {group.map((img) => (
                              <motion.div
                                key={img.id}
                                whileHover={{ scale: 1.02, y: -4, transition: { type: "spring", stiffness: 300, damping: 25 } }}
                                className={`group relative bg-zinc-900 rounded-2xl overflow-hidden border transition-all duration-300 ${img.winner ? 'border-green-500 ring-2 ring-green-500/20' : 'border-zinc-800 shadow-xl'}`}
                              >
                                <div className="absolute top-0 left-0 right-0 z-20 bg-black/60 backdrop-blur-md px-4 py-2 flex justify-between items-center border-b border-white/10">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                                      {img.modelInfo?.modelName || 'Model'}
                                    </span>
                                    {img.winner && (
                                      <span className="bg-green-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter">Winner</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[10px] text-zinc-400 uppercase tracking-widest">
                                      {getModelProviderLabel(img.modelInfo?.modelId)}
                                    </span>
                                    <button
                                      onClick={() => deleteComparisonResult(img.id)}
                                      className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                                      title="Delete Result"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                                <div
                                  className="aspect-square relative overflow-hidden bg-zinc-950 cursor-pointer"
                                  onClick={() => { if (img.status !== 'generating') setSelectedImage(img); }}
                                >
                                  {img.status === 'generating' ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/50 backdrop-blur-sm">
                                      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                      <span className="text-xs text-zinc-400 font-medium">Generating...</span>
                                    </div>
                                  ) : (
                                    <>
                                      <img
                                        src={img.url || `data:image/jpeg;base64,${img.base64}`}
                                        alt={img.prompt}
                                        loading="lazy"
                                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                        referrerPolicy="no-referrer"
                                      />
                                      <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />
                                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6 pointer-events-none">
                                        <div className="flex gap-3 pointer-events-auto">
                                          <motion.button
                                            whileTap={{ scale: 0.9 }}
                                            onClick={(e) => { e.stopPropagation(); pickComparisonWinner(img.id); }}
                                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${img.winner ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-[#00e6ff] hover:bg-[#33eaff] active:bg-[#00b8cc] text-[#050505]'}`}
                                          >
                                            {img.winner ? <CheckCircle2 className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                                            {img.winner ? 'Picked' : 'Keep this version'}
                                          </motion.button>
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {view === 'studio' && isGenerating && progress && (
                <div className="mb-8 flex items-center justify-center gap-3 text-indigo-400 bg-indigo-500/10 py-3 px-4 rounded-xl border border-indigo-500/20">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-medium text-sm">{progress}</span>
                </div>
              )}

              {view === 'captioning' && (() => {
                // Source of truth: savedImages (persisted). Captioning is a
                // curated workflow — ephemeral gallery images shouldn't
                // pollute this tab. Images promoted to Post Ready are
                // excluded so the two tabs form a clean pipeline.
                const all = savedImages.filter((i) => !i.isPostReady && i.approved);
                const captioned = all.filter((i) => !!i.postCaption);
                const uncaptioned = all.filter((i) => !i.postCaption);
                const visible =
                  captioningFilter === 'captioned'
                    ? captioned
                    : captioningFilter === 'uncaptioned'
                      ? uncaptioned
                      : all;

                return (
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="icon-box-blue">
                          <Edit3 className="w-5 h-5 text-[#00e6ff]" />
                        </div>
                        <div>
                        <h2 className="type-title">Captioning Studio</h2>
                        <p className="text-xs text-zinc-500 mt-1">
                          {captioned.length} / {all.length} captioned
                          {batchProgress && (
                            <span className="ml-3 text-[#00e6ff]">
                              Batch: {batchProgress.done}/{batchProgress.total}
                            </span>
                          )}
                        </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Filter tabs */}
                        <div className="flex bg-zinc-900 border border-zinc-800/60 rounded-full p-0.5">
                          {(['all', 'captioned', 'uncaptioned'] as const).map((f) => (
                            <button
                              key={f}
                              onClick={() => setCaptioningFilter(f)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                                captioningFilter === f
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                  : 'text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              {f === 'all' ? 'All' : f === 'captioned' ? 'Captioned' : 'Uncaptioned'}
                            </button>
                          ))}
                        </div>

                        {/* Group Similar toggle */}
                        <button
                          onClick={() => {
                            setCaptioningGrouped(!captioningGrouped);
                            // Leaving grouped mode clears any stale selection.
                            if (captioningGrouped) setCaptioningSelected(new Set());
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 border ${
                            captioningGrouped
                              ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-zinc-500'
                          }`}
                        >
                          <LayoutGrid className="w-3.5 h-3.5" />
                          {captioningGrouped ? 'Grouped' : 'Group Similar'}
                        </button>

                        {/* Create Carousel — always visible in grouped mode.
                            Opens the multi-source picker so the user can
                            pick any combination of images. */}
                        {captioningGrouped && (
                          <button
                            onClick={() => openCarouselPicker(null)}
                            className="btn-blue-sm rounded-full"
                          >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            Create Carousel
                          </button>
                        )}

                        {/* Manual "Group Selected" — only when grouping toggle is off
                            and the user has picked 2+ images with checkboxes. */}
                        {!captioningGrouped && captioningSelected.size >= 2 && (
                          <button
                            onClick={() => {
                              const ids = Array.from(captioningSelected);
                              persistCarouselGroup(`manual-${ids[0]}`, ids);
                              setCaptioningSelected(new Set());
                              setCaptioningGrouped(true);
                            }}
                            className="btn-blue-sm rounded-full"
                          >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            Group Selected ({captioningSelected.size})
                          </button>
                        )}

                        <button
                          onClick={() => batchCaptionImages(visible)}
                          disabled={batchCaptioning || uncaptioned.length === 0}
                          className="btn-blue-sm rounded-full"
                        >
                          {batchCaptioning ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Wand2 className="w-3.5 h-3.5" />
                          )}
                          Batch Caption
                        </button>
                      </div>
                    </div>

                    {/* Empty state */}
                    {all.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
                        <ImageIcon className="w-10 h-10 text-zinc-700" />
                        <p className="text-sm text-zinc-500">
                          No saved images yet. Save images from the gallery to start captioning.
                        </p>
                        <button
                          onClick={() => setView('gallery')}
                          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm"
                        >
                          Go to Gallery
                        </button>
                      </div>
                    ) : visible.length === 0 ? (
                      <div className="py-12 text-center text-sm text-zinc-500">
                        No {captioningFilter} images in this view.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {(captioningGrouped ? computeCarouselView(visible) : visible.map((img) => ({ kind: 'single' as const, img }))).map((entry) => {
                          // ── Carousel card (captioning) ────────────────
                          if (entry.kind === 'carousel') {
                            const anchor = entry.images[0];
                            const isWorking = preparingPostId === anchor.id;
                            const isExplicit = !!entry.group;
                            return (
                              <div
                                key={`c-${entry.id}`}
                                className="card overflow-hidden flex flex-col"
                              >
                                {/* Image strip */}
                                <div className="relative bg-zinc-950 overflow-x-auto">
                                  <div className="flex gap-1 p-2" style={{ minHeight: 140 }}>
                                    {entry.images.map((ci) => (
                                      <div key={ci.id} className="relative shrink-0 group/ci">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={ci.url}
                                          alt={ci.prompt}
                                          loading="lazy"
                                          onClick={() => setSelectedImage(ci)}
                                          className="h-32 w-32 object-cover rounded-xl cursor-zoom-in"
                                        />
                                        {isExplicit && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeFromCarousel(entry.id, ci.id);
                                            }}
                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600/90 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/ci:opacity-100 transition-opacity"
                                            title="Remove from carousel"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 bg-[#00e6ff]/15 border border-[#00e6ff]/30 text-[10px] font-medium text-[#00e6ff] rounded-full">
                                    <LayoutGrid className="w-3 h-3" /> Carousel · {entry.images.length} images
                                  </span>
                                  {isExplicit && (
                                    <button
                                      onClick={() => openCarouselPicker(entry.id)}
                                      className="absolute top-3 right-3 px-2 py-0.5 text-[10px] font-medium bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-full flex items-center gap-1 transition-colors"
                                      title="Add more images to this carousel"
                                    >
                                      <Plus className="w-3 h-3" /> Add
                                    </button>
                                  )}
                                  {isWorking && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2 text-xs text-white">
                                      <Loader2 className="w-4 h-4 animate-spin" /> Generating caption…
                                    </div>
                                  )}
                                </div>

                                {/* Shared caption body */}
                                <div className="flex-1 p-4 space-y-3">
                                  <p className="text-[11px] text-zinc-500 line-clamp-2" title={anchor.prompt}>
                                    {anchor.prompt}
                                  </p>
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                      Shared caption
                                    </label>
                                    <AutoTextarea
                                      value={anchor.postCaption || ''}
                                      onChange={(e) => {
                                        // Fan edits to every image so Post Now
                                        // and per-card Copy pick up the same text.
                                        propagateCaptionToGroup(entry.images, e.target.value, undefined);
                                      }}
                                      placeholder="No caption yet…"
                                      minRows={2}
                                      className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:border-[#c5a062]/50 focus:outline-none transition-colors"
                                    />
                                  </div>
                                  {(anchor.postHashtags || []).length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {(anchor.postHashtags ?? []).map((tag, i) => (
                                        <span
                                          key={`${tag}-${i}`}
                                          className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded-full text-[10px] text-zinc-300"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Footer actions */}
                                <div className="border-t border-[#c5a062]/15 p-3 flex items-center gap-2">
                                  <button
                                    disabled={isWorking || batchCaptioning}
                                    onClick={async () => {
                                      // Generate ONE caption using the anchor's
                                      // prompt, then fan it out. Explicit
                                      // user click → force overwrite siblings.
                                      setPreparingPostId(anchor.id);
                                      try {
                                        await fanCaptionToGroup(anchor, entry.images, { force: true });
                                      } finally {
                                        setPreparingPostId(null);
                                      }
                                    }}
                                    className="btn-blue-sm flex-1 justify-center"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    {anchor.postCaption ? 'Regenerate' : 'Generate'}
                                  </button>
                                  <button
                                    disabled={!anchor.postCaption}
                                    onClick={() => {
                                      // Mark every image in the group as ready.
                                      for (const ci of entry.images) {
                                        patchImage(ci, { isPostReady: true });
                                      }
                                    }}
                                    className="btn-blue-sm justify-center"
                                    title="Mark all as ready to post"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  {isExplicit ? (
                                    <button
                                      onClick={() => separateCarousel(entry.id)}
                                      className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                                      title="Ungroup"
                                    >
                                      <Columns className="w-3.5 h-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => persistCarouselGroup(`manual-${anchor.id}`, entry.images.map((i) => i.id))}
                                      className="btn-blue-sm justify-center"
                                      title="Lock this auto-detected grouping"
                                    >
                                      <LayoutGrid className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          // ── Single-image card (original) ─────────────
                          const img = entry.img;
                          const isWorking = preparingPostId === img.id;
                          const isSelected = captioningSelected.has(img.id);
                          return (
                            <div
                              key={img.id}
                              className={`bg-zinc-900/80 backdrop-blur-sm border rounded-2xl overflow-hidden flex flex-col transition-all duration-200 ${
                                isSelected ? 'border-[#00e6ff]/50 shadow-[0_0_16px_rgba(0,230,255,0.08)]' : 'border-[#c5a062]/20 hover:border-[#c5a062]/40'
                              }`}
                            >
                              {/* Thumbnail */}
                              <div className="relative aspect-square bg-zinc-950">
                                {img.url ? (
                                  <LazyImg
                                    src={img.url}
                                    alt={img.prompt}
                                    className="w-full h-full object-cover"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <ImageOff className="w-8 h-8 text-zinc-700" />
                                  </div>
                                )}
                                {isWorking && (
                                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2 text-xs text-white">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating caption…
                                  </div>
                                )}
                                {/* Selection checkbox (manual grouping) —
                                    only shown when grouping toggle is OFF. */}
                                {!captioningGrouped && (
                                  <div className="absolute top-3 left-3 z-20">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        const next = new Set(captioningSelected);
                                        if (e.target.checked) next.add(img.id);
                                        else next.delete(img.id);
                                        setCaptioningSelected(next);
                                      }}
                                      className="w-5 h-5 rounded border-zinc-600 bg-zinc-900/80 backdrop-blur-sm text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-[#c5a062]"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Body */}
                              <div className="flex-1 p-4 space-y-3">
                                <p className="text-[11px] text-zinc-500 line-clamp-2" title={img.prompt}>
                                  {img.prompt}
                                </p>

                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                    Caption
                                  </label>
                                  <AutoTextarea
                                    value={img.postCaption || ''}
                                    onChange={(e) => patchImage(img, { postCaption: e.target.value })}
                                    placeholder="No caption yet…"
                                    minRows={2}
                                    className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:border-[#c5a062]/50 focus:outline-none transition-colors"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                    Hashtags
                                  </label>
                                  {(img.postHashtags || []).length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {(img.postHashtags ?? []).map((tag, i) => (
                                        <span
                                          key={`${tag}-${i}`}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded-full text-[10px] text-zinc-300"
                                        >
                                          {tag}
                                          <button
                                            onClick={() => removeHashtag(img, i)}
                                            className="text-zinc-500 hover:text-red-400"
                                          >
                                            <X className="w-2.5 h-2.5" />
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-zinc-600 italic">No hashtags.</p>
                                  )}
                                </div>
                              </div>

                              {/* Footer actions */}
                              <div className="border-t border-zinc-800 p-3 flex items-center gap-2">
                                <button
                                  disabled={isWorking || batchCaptioning}
                                  onClick={async () => {
                                    setPreparingPostId(img.id);
                                    try {
                                      await generatePostContent(img);
                                    } finally {
                                      setPreparingPostId(null);
                                    }
                                  }}
                                  className="btn-blue-sm flex-1 justify-center"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                  {img.postCaption ? 'Regenerate' : 'Generate'}
                                </button>
                                <button
                                  disabled={!img.postCaption}
                                  onClick={() => patchImage(img, { isPostReady: true })}
                                  className="btn-blue-sm justify-center"
                                  title="Mark as ready to post"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                {pendingRemoveId === img.id ? (
                                  <div className="flex gap-1" title="Remove from Captioning? Image stays in Gallery.">
                                    <button
                                      onClick={() => {
                                        patchImage(img, { approved: false, postCaption: '', postHashtags: [], tags: [] });
                                        setPendingRemoveId(null);
                                      }}
                                      className="px-2 py-1.5 text-xs bg-red-600/90 hover:bg-red-500 text-white rounded-lg flex items-center gap-1 transition-colors"
                                      title="Confirm remove"
                                    >
                                      <Check className="w-3 h-3" /> Remove
                                    </button>
                                    <button
                                      onClick={() => setPendingRemoveId(null)}
                                      className="px-2 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                                      title="Cancel"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setPendingRemoveId(img.id)}
                                    className="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/80 text-red-400 hover:text-white rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                                    title="Remove from Captioning (image stays in Gallery)"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                  </div>
                );
              })()}
              {view === 'post-ready' && (() => {
                const ready = postReadyImages;
                // Carousel-aware view used by Smart Schedule so grouped
                // posts consume one slot each instead of N individual slots.
                const postItems = computeCarouselView(ready);
                // V082-POST-READY-SORT: applied after carousel grouping so
                // the user's toggle order wins over the default savedAt.
                const sortedPostItems = sortPostItems(
                  postItems,
                  postReadySort,
                  settings.scheduledPosts || [],
                );
                const available = availablePlatforms();

                // V091-POLISH / QUEUE-STATUS: roll up the scheduled-post
                // statuses into the Post Ready header so users see the
                // server-scheduler's pipeline at a glance instead of
                // having to flip to the calendar tab. Excludes "rejected"
                // — that's a terminal action the user already knows about.
                const allPosts = settings.scheduledPosts || [];
                const queueCounts = {
                  scheduled: allPosts.filter((p) => p.status === 'scheduled' || !p.status).length,
                  pending:   allPosts.filter((p) => p.status === 'pending_approval').length,
                  posted:    allPosts.filter((p) => p.status === 'posted').length,
                  failed:    allPosts.filter((p) => p.status === 'failed').length,
                };

                const postAllNow = async () => {
                  for (const img of ready) {
                    const sel = getSelectedPlatforms(img.id);
                    if (sel.length > 0) {
                      // Sequential — each platform call can be slow and we
                      // want per-card status badges to update in order.
                      await postImageNow(img, sel);
                    }
                  }
                };

                // CLEAR-ALL-SCHEDULED-FIX: nuke every scheduled post in
                // one shot. Cancels each entry in the server queue
                // best-effort, then drops the whole array from settings.
                const handleClearAllScheduled = () => {
                  if (allPosts.length === 0) return;
                  if (!window.confirm(`Clear all ${allPosts.length} scheduled posts? This cannot be undone.`)) return;
                  updateSettings({ scheduledPosts: [] });
                  showToast('All scheduled posts cleared', 'success');
                };

                const platformBadgeClass = (p: PostPlatform) => {
                  if (p === 'instagram') return 'bg-pink-600/90';
                  if (p === 'pinterest') return 'bg-red-600/90';
                  if (p === 'twitter') return 'bg-sky-600/90';
                  return 'bg-indigo-600/90';
                };

                return (
                  <div className="space-y-6">
                    {/* V091-POLISH / Header.
                        Three rows on narrow viewports, two on wide:
                          1. Title block (icon + name + "N ready / M saved")
                             paired with the queue status strip.
                          2. View-mode toggle + sort pill (display controls).
                          3. Action buttons (Create Carousel / Smart
                             Schedule / Post All Now) grouped on the right.
                        Each cluster sits in its own flex container so
                        wraps land between groups instead of mid-cluster
                        on 390px / 768px viewports. */}
                    <div className="space-y-3">
                      {/* Row 1 — title + queue status strip */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="icon-box-blue shrink-0">
                            <Save className="w-5 h-5 text-[#00e6ff]" />
                          </div>
                          <div className="min-w-0">
                            <h2 className="type-title truncate">Post Ready</h2>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {ready.length} ready · {savedImages.length} saved
                            </p>
                          </div>
                        </div>

                        {/* Queue status strip — server-scheduler pipeline
                            at a glance. Inline with the title row so it
                            reads as part of the tab, not an overlay. */}
                        <div
                          role="group"
                          aria-label="Scheduler queue status"
                          className="flex flex-wrap items-center gap-1.5 bg-[#080808] border border-[#c5a062]/20 rounded-xl px-2 py-1.5"
                        >
                          {[
                            { key: 'scheduled' as const, label: 'Scheduled', count: queueCounts.scheduled, dot: 'bg-[#00e6ff]', text: 'text-[#00e6ff]' },
                            { key: 'pending'   as const, label: 'Pending',   count: queueCounts.pending,   dot: 'bg-[#c5a062]', text: 'text-[#c5a062]' },
                            { key: 'posted'    as const, label: 'Posted',    count: queueCounts.posted,    dot: 'bg-emerald-500', text: 'text-emerald-300' },
                            { key: 'failed'    as const, label: 'Failed',    count: queueCounts.failed,    dot: 'bg-red-500',     text: 'text-red-300'    },
                          ].map((s, idx, arr) => (
                            <span key={s.key} className="inline-flex items-center">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${s.dot} ${s.count > 0 ? 'shadow-[0_0_6px_currentColor]' : 'opacity-40'}`}
                                  aria-hidden="true"
                                />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                  {s.label}
                                </span>
                                <span className={`text-xs font-mono tabular-nums ${s.count > 0 ? s.text : 'text-zinc-600'}`}>
                                  {s.count}
                                </span>
                              </span>
                              {idx < arr.length - 1 && (
                                <span className="h-3 w-px bg-[#c5a062]/15" aria-hidden="true" />
                              )}
                            </span>
                          ))}
                        </div>

                        {/* CLEAR-ALL-SCHEDULED-FIX: nuke every scheduled
                            post (server queue + local state). Only
                            shown when there's something to clear. */}
                        {allPosts.length > 0 && (
                          <button
                            onClick={handleClearAllScheduled}
                            className="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/60 text-red-400 hover:text-white rounded-xl border border-red-600/30 transition-colors"
                          >
                            Clear All ({allPosts.length})
                          </button>
                        )}
                      </div>

                      {/* Row 2 — display controls + actions. On wide
                          screens these wrap onto one line; on 390px the
                          view-mode pill, sort, and action buttons each
                          fall to their own line cleanly. */}
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                        {/* Display group — view mode + sort */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Grid / Calendar / History view toggle */}
                          <div className="flex bg-zinc-900 border border-zinc-800/60 rounded-full p-0.5">
                            <button
                              onClick={() => setPostReadyView('grid')}
                              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                                postReadyView === 'grid'
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                  : 'text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              Grid
                            </button>
                            <button
                              onClick={() => setPostReadyView('calendar')}
                              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                                postReadyView === 'calendar'
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                  : 'text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              Calendar
                            </button>
                            <button
                              onClick={() => setPostReadyView('history')}
                              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                                postReadyView === 'history'
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                  : 'text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              History {postedImages.length > 0 && `(${postedImages.length})`}
                            </button>
                          </div>
                          {/* V082-POST-READY-SORT: sort toggle — grid view only. */}
                          {postReadyView === 'grid' && ready.length > 0 && (
                            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800/60 rounded-full pl-3 pr-1 py-0.5">
                              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                Sort
                              </span>
                              <select
                                value={postReadySort}
                                onChange={(e) =>
                                  setPostReadySort(
                                    e.target.value as 'savedAt' | 'scheduled' | 'created',
                                  )
                                }
                                aria-label="Sort Post Ready cards"
                                className="bg-transparent text-xs text-zinc-300 px-2 py-1 rounded-full cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#c5a062]/40"
                              >
                                <option value="savedAt">Saved (newest)</option>
                                <option value="scheduled">Scheduled (soonest)</option>
                                <option value="created">Created (newest)</option>
                              </select>
                            </div>
                          )}
                        </div>

                        {/* Visual divider between display and action groups */}
                        <span className="hidden sm:block h-6 w-px bg-[#c5a062]/15" aria-hidden="true" />

                        {/* Action group — carousel + scheduling */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Create Carousel — opens the lifted multi-source
                              picker. Source pool is every approved saved
                              image so users can mix Post-Ready and
                              Captioning-stage images into one carousel. */}
                          <button
                            onClick={() => openCarouselPicker(null)}
                            className="btn-blue-sm"
                            title="Group images into a single multi-image carousel post"
                          >
                            <LayoutGrid className="w-3.5 h-3.5" /> Create Carousel
                          </button>
                          {/* Group Selected — quick-promote the checkboxed
                              single Post-Ready cards into a carousel group
                              without opening the picker. Mirrors the
                              captioning-tab manual flow. */}
                          {postReadySelected.size >= 2 && (
                            <button
                              onClick={() => {
                                const ids = Array.from(postReadySelected);
                                persistCarouselGroup(`manual-${ids[0]}`, ids);
                                setPostReadySelected(new Set());
                              }}
                              className="btn-blue-sm"
                            >
                              <LayoutGrid className="w-3.5 h-3.5" />
                              Group Selected ({postReadySelected.size})
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              await smartScheduler.trigger(postItems.length);
                              setShowScheduleAll(true);
                            }}
                            disabled={ready.length === 0 || available.length === 0 || smartScheduler.loading}
                            aria-busy={smartScheduler.loading}
                            aria-label={smartScheduler.loading ? 'Analysing best posting times…' : 'Schedule with optimal posting times'}
                            className="btn-gold-sm"
                            title={smartScheduler.loading ? 'Analysing best posting times…' : 'Schedule with optimal posting times'}
                          >
                            {smartScheduler.loading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <TrendingUp className="w-3.5 h-3.5" />
                            )}
                            {smartScheduler.loading ? 'Analysing…' : 'Smart Schedule'}
                          </button>
                          <button
                            onClick={postAllNow}
                            disabled={ready.length === 0 || available.length === 0}
                            className="btn-blue-sm"
                            title="Post every image to its selected platforms"
                          >
                            <Send className="w-3.5 h-3.5" /> Post All Now
                          </button>
                        </div>
                      </div>
                    </div>

                    {available.length === 0 && (
                      <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                        No social platform credentials configured. Add Instagram or Pinterest keys in Settings to enable posting.
                      </div>
                    )}

                    {/* Calendar view */}
                    {postReadyView === 'calendar' && (() => {
                      // Fix 2 (mmx brief): the calendar grid is for
                      // upcoming + actionable work only. 'posted' entries
                      // are done (history view owns those) and 'rejected'
                      // entries are user-cancelled and shouldn't ghost the
                      // grid. 'failed' stays visible so the user can spot
                      // retry-able slots without leaving the calendar.
                      const scheduled = (settings.scheduledPosts || []).filter(
                        (p) => p.status !== 'posted' && p.status !== 'rejected',
                      );
                      const imgById = new Map(savedImages.map((i) => [i.id, i]));
                      const today = startOfDay(new Date());

                      if (calendarMode === 'week') {
                        const weekStart = startOfWeek(calendarDate);
                        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
                        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                        const rangeLabel = `${toYMD(weekStart)} → ${toYMD(addDays(weekStart, 6))}`;

                        // V040-001: heatmap data — only computed when overlay
                        // is on. 7×24 map + a top-3 ranking constrained to the
                        // visible week (overflow into next week is dropped so
                        // the visible grid never shows a "rank 4" star).
                        const heatmapEngagement = heatmapEnabled ? loadEngagementData() : null;
                        const heatmapWeekScores: Map<string, SlotScoreBreakdown> =
                          heatmapEnabled && heatmapEngagement
                            ? computeWeekScores(days, heatmapEngagement)
                            : new Map();
                        const heatmapTopRanks = new Map<string, 1 | 2 | 3>();
                        if (heatmapEnabled && heatmapEngagement) {
                          const platforms = availablePlatforms();
                          const top = findBestSlots(
                            scheduled,
                            3,
                            heatmapEngagement,
                            { platforms, caps: settings.pipelineDailyCaps },
                          );
                          const weekKeys = new Set(days.map((d) => toYMD(d)));
                          let rank = 1;
                          for (const s of top) {
                            if (!weekKeys.has(s.date)) continue;
                            const hour = parseInt(s.time.split(':')[0], 10);
                            heatmapTopRanks.set(`${s.date}:${hour}`, rank as 1 | 2 | 3);
                            rank += 1;
                            if (rank > 3) break;
                          }
                        }

                        return (
                          <div className="card overflow-hidden relative">
                            {/* Calendar header */}
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 border-b border-[#c5a062]/15">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setCalendarDate(addDays(calendarDate, -7))}
                                  className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                                >
                                  ‹
                                </button>
                                <button
                                  onClick={() => setCalendarDate(new Date())}
                                  className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                                >
                                  Today
                                </button>
                                <button
                                  onClick={() => setCalendarDate(addDays(calendarDate, 7))}
                                  className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                                >
                                  ›
                                </button>
                                <span className="ml-3 text-sm text-zinc-300">{rangeLabel}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <HeatmapToggleButton
                                  heatmapEnabled={heatmapEnabled}
                                  onToggle={toggleHeatmap}
                                />
                                <div className="flex bg-zinc-900 border border-zinc-800/60 rounded-full p-0.5">
                                  {(['week', 'month'] as const).map((m) => (
                                    <button
                                      key={m}
                                      onClick={() => setCalendarMode(m)}
                                      className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                                        calendarMode === m
                                          ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                          : 'text-zinc-500 hover:text-zinc-300'
                                      }`}
                                    >
                                      {m === 'week' ? 'Week' : 'Month'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Inline edit popover — rendered above the grid
                                whenever a post is selected. Click outside
                                (or the Close button) to dismiss. */}
                            {editingPostId && (() => {
                              const editing = scheduled.find((p) => p.id === editingPostId);
                              if (!editing) return null;
                              const editingImg = imgById.get(editing.imageId);
                              const togglePlatformInPost = (plat: string) => {
                                const next = editing.platforms.includes(plat)
                                  ? editing.platforms.filter((x) => x !== plat)
                                  : [...editing.platforms, plat];
                                updateSettings((prev) => ({
                                  scheduledPosts: (prev.scheduledPosts || []).map((sp) =>
                                    sp.id === editing.id ? { ...sp, platforms: next } : sp
                                  ),
                                }));
                              };
                              const patchField = (patch: Partial<ScheduledPost>) => {
                                updateSettings((prev) => ({
                                  scheduledPosts: (prev.scheduledPosts || []).map((sp) =>
                                    sp.id === editing.id ? { ...sp, ...patch } : sp
                                  ),
                                }));
                              };
                              return (
                                <div
                                  ref={editPopoverRef}
                                  className="m-4 bg-zinc-950/90 backdrop-blur border border-emerald-500/30 rounded-2xl p-4 space-y-3"
                                >
                                  {/* Fix 4 (mmx brief): show the post's image
                                      directly in the popover header so the
                                      "View Image" round-trip isn't required
                                      to know what's being scheduled. */}
                                  <div className="flex items-start gap-3">
                                    {editingImg?.url ? (
                                      <button
                                        type="button"
                                        onClick={() => setSelectedImage(editingImg)}
                                        title="Open full image"
                                        className="shrink-0 group relative w-16 h-16 rounded-xl overflow-hidden border border-[#c5a062]/30 hover:border-[#c5a062]/70 transition-colors"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={editingImg.url}
                                          alt=""
                                          className="w-full h-full object-cover"
                                        />
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <Maximize2 className="w-4 h-4 text-white" />
                                        </span>
                                      </button>
                                    ) : (
                                      <div className="shrink-0 w-16 h-16 rounded-xl bg-zinc-900 border border-zinc-800/60 flex items-center justify-center">
                                        <ImageOff className="w-5 h-5 text-zinc-600" />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-emerald-400" />
                                        Edit scheduled post
                                      </h4>
                                      <p className="text-[11px] text-zinc-500 line-clamp-2">
                                        {editing.caption || '(no caption)'}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => setEditingPostId(null)}
                                      className="shrink-0 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Date</label>
                                      <input
                                        type="date"
                                        value={editing.date}
                                        onChange={(e) => patchField({ date: e.target.value })}
                                        className="w-full bg-zinc-900 border border-zinc-800/60 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Time</label>
                                      <TimePicker24
                                        value={editing.time}
                                        onChange={(v) => patchField({ time: v })}
                                        className="w-full bg-zinc-900 border border-zinc-800/60 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                                      />
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Platforms</label>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(['instagram', 'pinterest', 'twitter', 'discord'] as PostPlatform[]).map((p) => {
                                        const checked = editing.platforms.includes(p);
                                        return (
                                          <button
                                            key={p}
                                            type="button"
                                            onClick={() => togglePlatformInPost(p)}
                                            className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
                                              checked
                                                ? `${platformBadgeClass(p)} text-white border-transparent`
                                                : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-zinc-500'
                                            }`}
                                          >
                                            {checked && <Check className="w-3 h-3 inline mr-1" />}
                                            {p}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Caption</label>
                                    <p className="text-xs text-zinc-300 bg-zinc-900/50 border border-zinc-800/60 rounded-lg px-3 py-2 line-clamp-3">
                                      {editing.caption || '(no caption)'}
                                    </p>
                                  </div>

                                  <div className="flex justify-end">
                                    <button
                                      onClick={() => setEditingPostId(null)}
                                      className="btn-blue-sm"
                                    >
                                      <Check className="w-3.5 h-3.5" /> Done
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Week grid: 1 hour label column + 7 day columns */}
                            <div className="overflow-x-auto">
                              <div className="grid grid-cols-[60px_repeat(7,minmax(120px,1fr))] border-b border-zinc-800/60 sticky top-0 bg-zinc-900/95 backdrop-blur">
                                <div />
                                {days.map((d, i) => {
                                  const isToday = toYMD(d) === toYMD(today);
                                  return (
                                    <div
                                      key={toYMD(d)}
                                      className={`px-3 py-2 text-center border-l border-zinc-800/60 ${
                                        isToday ? 'text-emerald-400' : 'text-zinc-400'
                                      }`}
                                    >
                                      <div className="text-[10px] font-bold uppercase tracking-wider">{dayNames[i]}</div>
                                      <div className="text-sm font-semibold">{d.getDate()}</div>
                                    </div>
                                  );
                                })}
                              </div>

                              {HOUR_LABELS.map((label, hour) => (
                                <div
                                  key={label}
                                  className="grid grid-cols-[60px_repeat(7,minmax(120px,1fr))] border-b border-zinc-800/40"
                                >
                                  <div className="px-2 py-2 text-[10px] text-zinc-600 text-right font-mono">{label}</div>
                                  {days.map((d) => {
                                    const dateStr = toYMD(d);
                                    const postsAtSlot = scheduled.filter((p) => {
                                      if (p.date !== dateStr) return false;
                                      const [hh] = p.time.split(':').map(Number);
                                      return hh === hour;
                                    });
                                    const cellKey = `${dateStr}:${hour}`;
                                    const isDragOver = dragOverCell === cellKey;
                                    const isEmpty = postsAtSlot.length === 0;
                                    const breakdown = heatmapWeekScores.get(cellKey);
                                    const heatmapRank = heatmapTopRanks.get(cellKey);
                                    return (
                                      <div
                                        key={cellKey}
                                        onClick={() => {
                                          if (isEmpty) {
                                            setCalendarSlotClick({
                                              date: dateStr,
                                              time: `${String(hour).padStart(2, '0')}:00`,
                                            });
                                          }
                                        }}
                                        onMouseEnter={(e) => {
                                          if (!heatmapEnabled) return;
                                          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                          const cellDate = new Date(d);
                                          if (heatmapHoverTimer.current) {
                                            clearTimeout(heatmapHoverTimer.current);
                                          }
                                          heatmapHoverTimer.current = setTimeout(() => {
                                            setHeatmapHover({
                                              cellKey,
                                              rect,
                                              date: cellDate,
                                              hour,
                                              isAvailable: isEmpty,
                                            });
                                          }, 120);
                                        }}
                                        onMouseLeave={() => {
                                          if (heatmapHoverTimer.current) {
                                            clearTimeout(heatmapHoverTimer.current);
                                            heatmapHoverTimer.current = null;
                                          }
                                          setHeatmapHover((curr) => (curr?.cellKey === cellKey ? null : curr));
                                        }}
                                        onDragOver={(e) => {
                                          e.preventDefault();
                                          if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                                        }}
                                        onDragLeave={() => {
                                          if (dragOverCell === cellKey) setDragOverCell(null);
                                        }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const postId = e.dataTransfer.getData('postId');
                                          setDragOverCell(null);
                                          setDragPostId(null);
                                          if (!postId) return;
                                          // Rewrite the post's date/time in
                                          // settings.scheduledPosts. Time is
                                          // pinned to HH:00 — finer resolution
                                          // needs the edit popover.
                                          const newTime = `${String(hour).padStart(2, '0')}:00`;
                                          // RESCHED-DROP-FIX: mirror the move
                                          // to the server queue. Without this
                                          // the GitHub Actions cron kept
                                          // firing the post at the original
                                          // time even though the calendar UI
                                          // had updated locally. Fire-and-
                                          // forget on both calls — local
                                          updateSettings((prev) => ({
                                            scheduledPosts: (prev.scheduledPosts || []).map((sp) =>
                                              sp.id === postId ? { ...sp, date: dateStr, time: newTime } : sp
                                            ),
                                          }));
                                        }}
                                        className={`relative border-l border-zinc-800/60 min-h-[40px] p-1 space-y-1 transition-colors ${
                                          isDragOver
                                            ? 'ring-2 ring-emerald-500/50 bg-emerald-500/5'
                                            : isEmpty
                                              ? heatmapEnabled
                                                ? 'cursor-pointer hover:ring-1 hover:ring-[#00e6ff]/40'
                                                : 'cursor-pointer hover:bg-emerald-500/5'
                                              : ''
                                        }`}
                                      >
                                        <HeatmapTint
                                          score={breakdown?.score ?? 0}
                                          enabled={heatmapEnabled}
                                        />
                                        {heatmapEnabled && heatmapRank && (
                                          <TopSlotStar rank={heatmapRank} />
                                        )}
                                        {postsAtSlot.map((p) => {
                                          // Fix 4 (mmx brief): chip-level
                                          // thumbnail so users can see what's
                                          // scheduled without opening the
                                          // edit popover. Falls back to a
                                          // muted square when the source
                                          // image has been pruned/expired.
                                          const chipImg = imgById.get(p.imageId);
                                          return (
                                            <button
                                              key={p.id}
                                              draggable
                                              onDragStart={(e) => {
                                                e.dataTransfer.setData('postId', p.id);
                                                e.dataTransfer.effectAllowed = 'move';
                                                setDragPostId(p.id);
                                              }}
                                              onDragEnd={() => setDragPostId(null)}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingPostId((current) => (current === p.id ? null : p.id));
                                              }}
                                              className={`relative z-20 w-full text-left px-1.5 py-1 rounded-xl border text-[10px] cursor-grab active:cursor-grabbing flex items-center gap-1.5 ${calendarColorFor(p.status)} ${
                                                dragPostId === p.id ? 'opacity-50' : ''
                                              }`}
                                              title={`${p.time} · ${p.platforms.join(', ')}\n${p.caption}`}
                                            >
                                              {chipImg?.url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                  src={chipImg.url}
                                                  alt=""
                                                  className="w-4 h-4 rounded object-cover shrink-0 border border-black/40"
                                                  loading="lazy"
                                                />
                                              ) : (
                                                <span className="w-4 h-4 rounded bg-zinc-800/80 border border-black/40 shrink-0" />
                                              )}
                                              <span className="truncate tabular-nums">
                                                {p.time} · {p.platforms.map((pl) => pl[0].toUpperCase()).join('')}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                            <HeatmapLegend heatmapEnabled={heatmapEnabled} />

                            {/* Fix 3 (mmx brief) — drop-to-delete trash zone.
                                Always visible at the foot of the calendar so
                                users can find it; understated when no drag is
                                in progress, lights red on dragover. */}
                            <div
                              data-testid="calendar-trash-zone"
                              role="button"
                              aria-label="Drop a scheduled post here to delete it"
                              onDragOver={(e) => {
                                if (!dragPostId) return;
                                e.preventDefault();
                                if (!dragOverTrash) setDragOverTrash(true);
                              }}
                              onDragLeave={() => {
                                if (dragOverTrash) setDragOverTrash(false);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOverTrash(false);
                                const postId = e.dataTransfer.getData('postId');
                                setDragPostId(null);
                                if (!postId) return;
                                setPendingTrashId(postId);
                              }}
                              className={`mx-3 my-3 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed py-2.5 text-xs select-none transition-all duration-200 ${
                                dragPostId
                                  ? dragOverTrash
                                    ? 'border-red-500 bg-red-500/15 text-red-200 shadow-[0_0_16px_rgba(239,68,68,0.25)] scale-[1.01]'
                                    : 'border-red-500/40 bg-red-500/5 text-red-300/80'
                                  : 'border-zinc-800/60 bg-zinc-950/40 text-zinc-600'
                              }`}
                            >
                              <Trash2 className={`w-3.5 h-3.5 ${dragPostId ? '' : 'opacity-60'}`} />
                              <span className="font-medium tracking-wide">
                                {dragPostId
                                  ? dragOverTrash
                                    ? 'Release to delete'
                                    : 'Drop here to delete'
                                  : 'Drag a scheduled post here to delete'}
                              </span>
                            </div>

                            {heatmapEnabled && heatmapHover && (() => {
                              const bd = heatmapWeekScores.get(heatmapHover.cellKey);
                              const eng = heatmapEngagement;
                              if (!bd || !eng) return null;
                              return (
                                <HeatmapTooltip
                                  anchor={{
                                    rect: heatmapHover.rect,
                                    date: heatmapHover.date,
                                    hour: heatmapHover.hour,
                                  }}
                                  score={bd.score}
                                  dayMult={bd.dayMult}
                                  hourWeight={bd.hourWeight}
                                  weekendBonus={bd.weekendBonus}
                                  engagement={eng}
                                  isAvailable={heatmapHover.isAvailable}
                                  onScheduleClick={() => {
                                    const dateStr = toYMD(heatmapHover.date);
                                    setCalendarSlotClick({
                                      date: dateStr,
                                      time: `${String(heatmapHover.hour).padStart(2, '0')}:00`,
                                    });
                                    setHeatmapHover(null);
                                  }}
                                />
                              );
                            })()}
                          </div>
                        );
                      }

                      // ── Month view ────────────────────────────────────
                      const firstOfMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
                      const firstOfNext = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
                      const gridStart = startOfWeek(firstOfMonth);
                      const totalCells = Math.ceil((firstOfNext.getTime() - gridStart.getTime()) / (24 * 3600 * 1000));
                      const weeks = Math.ceil(totalCells / 7);
                      const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
                      const monthLabel = calendarDate.toLocaleDateString(undefined, {
                        month: 'long',
                        year: 'numeric',
                      });
                      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

                      return (
                        <div className="card overflow-hidden">
                          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 border-b border-[#c5a062]/15">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  setCalendarDate(
                                    new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1)
                                  )
                                }
                                className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                              >
                                ‹
                              </button>
                              <button
                                onClick={() => setCalendarDate(new Date())}
                                className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                              >
                                Today
                              </button>
                              <button
                                onClick={() =>
                                  setCalendarDate(
                                    new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1)
                                  )
                                }
                                className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                              >
                                ›
                              </button>
                              <span className="ml-3 text-sm text-zinc-300">{monthLabel}</span>
                            </div>
                            <div className="flex bg-zinc-900 border border-zinc-800/60 rounded-full p-0.5">
                              {(['week', 'month'] as const).map((m) => (
                                <button
                                  key={m}
                                  onClick={() => setCalendarMode(m)}
                                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                                    calendarMode === m
                                      ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                      : 'text-zinc-500 hover:text-zinc-300'
                                  }`}
                                >
                                  {m === 'week' ? 'Week' : 'Month'}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-7 border-b border-zinc-800/60">
                            {dayNames.map((d) => (
                              <div key={d} className="px-2 py-2 text-center text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                {d}
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-7">
                            {cells.map((d, i) => {
                              const dateStr = toYMD(d);
                              const inMonth = d.getMonth() === calendarDate.getMonth();
                              const postsForDay = scheduled.filter((p) => p.date === dateStr);
                              const isToday = dateStr === toYMD(today);
                              // Group by status to colour the dots.
                              const hasPosted = postsForDay.some((p) => p.status === 'posted');
                              const hasScheduled = postsForDay.some((p) => p.status === 'scheduled' || !p.status);
                              const hasFailed = postsForDay.some((p) => p.status === 'failed');
                              return (
                                <div
                                  key={dateStr}
                                  onClick={() => {
                                    setCalendarMode('week');
                                    setCalendarDate(d);
                                  }}
                                  className={`group/mc relative h-24 border-t border-l border-zinc-800/40 p-1.5 text-left cursor-pointer transition-colors ${
                                    inMonth ? 'bg-zinc-900/40 hover:bg-zinc-900' : 'bg-zinc-950 text-zinc-700'
                                  } ${(i + 1) % 7 === 0 ? 'border-r' : ''}`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div
                                      className={`text-xs font-medium ${
                                        isToday ? 'text-emerald-400' : inMonth ? 'text-zinc-300' : 'text-zinc-700'
                                      }`}
                                    >
                                      {d.getDate()}
                                    </div>
                                    {inMonth && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCalendarSlotClick({ date: dateStr, time: '12:00' });
                                        }}
                                        className="opacity-0 group-hover/mc:opacity-100 w-5 h-5 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center transition-opacity"
                                        title="Schedule a post for this day"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  {postsForDay.length > 0 && (
                                    <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between">
                                      <div className="flex gap-0.5">
                                        {hasPosted && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                                        {hasScheduled && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                                        {hasFailed && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                                      </div>
                                      <span className="text-[10px] text-zinc-400">{postsForDay.length}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Click-to-schedule modal */}
                    {calendarSlotClick && (() => {
                      const slot = calendarSlotClick;
                      const selectedImageId =
                        slot.imageId || (postReadyImages.length === 1 ? postReadyImages[0].id : undefined);
                      const selectedImage = selectedImageId
                        ? savedImages.find((i) => i.id === selectedImageId)
                        : undefined;
                      const selectedPlatforms = slot.platforms || available;
                      const day = new Date(`${slot.date}T00:00:00`);
                      const dayLabel = day.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      });

                      const createScheduledPost = () => {
                        if (!selectedImage || selectedPlatforms.length === 0) return;
                        const newPost: ScheduledPost = {
                          id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                          imageId: selectedImage.id,
                          date: slot.date,
                          time: slot.time,
                          platforms: selectedPlatforms,
                          caption: formatPost(selectedImage),
                          status: 'scheduled',
                        };
                        updateSettings((prev) => ({
                          scheduledPosts: [...(prev.scheduledPosts || []), newPost],
                        }));
                        setCalendarSlotClick(null);
                      };

                      const postImmediately = async () => {
                        if (!selectedImage || selectedPlatforms.length === 0) return;
                        await postImageNow(selectedImage, selectedPlatforms);
                        setCalendarSlotClick(null);
                      };

                      return (
                        <div
                          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
                          onClick={() => setCalendarSlotClick(null)}
                        >
                          <div
                            className="bg-zinc-900/90 backdrop-blur-xl border-0 sm:border border-zinc-800/60 rounded-none sm:rounded-2xl w-full sm:max-w-xl h-full sm:h-auto max-h-[100dvh] sm:max-h-[85vh] flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
                              <div className="flex items-center gap-3">
                                <div className="icon-box-blue">
                                  <Clock className="w-5 h-5 text-[#00e6ff]" />
                                </div>
                                <div>
                                  <h3 className="type-title">Schedule Post</h3>
                                  <p className="text-xs text-zinc-500">{dayLabel}</p>
                                </div>
                              </div>
                              <button
                                onClick={() => setCalendarSlotClick(null)}
                                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                              {/* Image picker */}
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                  Image
                                </label>
                                {postReadyImages.length === 0 ? (
                                  <p className="text-xs text-amber-400">
                                    No post-ready images yet. Go to the Gallery and click
                                    &quot;Prepare for Post&quot; on an image first.
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                                    {postReadyImages.map((img) => {
                                      const isSel = img.id === selectedImageId;
                                      return (
                                        <motion.button
                                          key={img.id}
                                          whileHover={{ scale: 1.03, transition: { type: "spring", stiffness: 300, damping: 25 } }}
                                          whileTap={{ scale: 0.9 }}
                                          onClick={() =>
                                            setCalendarSlotClick({ ...slot, imageId: img.id })
                                          }
                                          className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                                            isSel
                                              ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                                              : 'border-zinc-800/60 hover:border-zinc-600'
                                          }`}
                                        >
                                          {img.url ? (
                                            <LazyImg
                                              src={img.url}
                                              alt={img.prompt}
                                              className="w-full h-full object-cover"
                                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                          ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-zinc-950">
                                              <ImageOff className="w-5 h-5 text-zinc-700" />
                                            </div>
                                          )}
                                          {isSel && (
                                            <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                                              <Check className="w-2.5 h-2.5 text-white" />
                                            </div>
                                          )}
                                        </motion.button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Platforms */}
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                  Platforms
                                </label>
                                {available.length === 0 ? (
                                  <p className="text-[11px] text-amber-400">
                                    Configure a platform in Settings first.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {available.map((p) => {
                                      const checked = selectedPlatforms.includes(p);
                                      return (
                                        <button
                                          key={p}
                                          type="button"
                                          onClick={() => {
                                            const next = checked
                                              ? selectedPlatforms.filter((x) => x !== p)
                                              : [...selectedPlatforms, p];
                                            setCalendarSlotClick({ ...slot, platforms: next });
                                          }}
                                          className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
                                            checked
                                              ? `${platformBadgeClass(p)} text-white border-transparent`
                                              : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-zinc-500'
                                          }`}
                                        >
                                          {checked && <Check className="w-3 h-3 inline mr-1" />}
                                          {p}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Time (editable) */}
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Date</label>
                                  <input
                                    type="date"
                                    value={slot.date}
                                    onChange={(e) => setCalendarSlotClick({ ...slot, date: e.target.value })}
                                    className={`w-full ${uiSurface.canvas} border ${uiSurface.hairline} rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 ${uiGold.ring}`}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Time</label>
                                  <TimePicker24
                                    value={slot.time}
                                    onChange={(v) => setCalendarSlotClick({ ...slot, time: v })}
                                    className={`w-full ${uiSurface.canvas} border ${uiSurface.hairline} rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 ${uiGold.ring}`}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-800/60">
                              <button
                                onClick={() => setCalendarSlotClick(null)}
                                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={postImmediately}
                                disabled={!selectedImage || selectedPlatforms.length === 0}
                                className="btn-blue-sm"
                              >
                                <Send className="w-3.5 h-3.5" /> Post Now
                              </button>
                              <button
                                onClick={createScheduledPost}
                                disabled={!selectedImage || selectedPlatforms.length === 0}
                                className="btn-gold-sm"
                              >
                                <Clock className="w-3.5 h-3.5" /> Schedule
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Fix 3 (mmx brief) — delete-confirmation dialog after a
                        post is dropped onto the calendar trash zone. Cancel
                        is the safer default; Delete is destructive red. */}
                    {pendingTrashId && (() => {
                      const target = (settings.scheduledPosts || []).find(
                        (sp) => sp.id === pendingTrashId,
                      );
                      if (!target) {
                        // Post vanished out from under us (rescheduled away,
                        // posted, etc.) — silently dismiss.
                        setPendingTrashId(null);
                        return null;
                      }
                      const targetImg = savedImages.find((i) => i.id === target.imageId);
                      const close = () => setPendingTrashId(null);
                      const confirmDelete = () => {
                        updateSettings((prev) => ({
                          scheduledPosts: (prev.scheduledPosts || []).filter(
                            (sp) => sp.id !== pendingTrashId,
                          ),
                        }));
                        setPendingTrashId(null);
                      };
                      return (
                        <div
                          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 outline-none"
                          onClick={close}
                          onKeyDown={(e) => {
                            // QA-W4: Escape was the only common modal-dismiss
                            // gesture left unhandled (backdrop + Cancel were
                            // already wired). Listen on the dialog root so
                            // bubbling from the autofocused Cancel button
                            // (or anywhere inside) reaches us.
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              close();
                            }
                          }}
                          tabIndex={-1}
                          role="dialog"
                          aria-modal="true"
                          aria-label="Confirm delete scheduled post"
                        >
                          <div
                            className="bg-[#050505]/95 backdrop-blur-xl border border-red-500/40 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-[0_0_36px_rgba(239,68,68,0.15)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center justify-center shrink-0">
                                <Trash2 className="w-5 h-5 text-red-400" />
                              </div>
                              <div className="min-w-0">
                                <h3 className="type-title">Delete scheduled post?</h3>
                                <p className="text-xs text-zinc-500">
                                  This removes the schedule. The image stays in your gallery.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/60 border border-[#c5a062]/15">
                              {targetImg?.url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={targetImg.url}
                                  alt=""
                                  className="w-14 h-14 rounded-lg object-cover shrink-0 border border-[#c5a062]/15"
                                />
                              )}
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-mono tabular-nums text-zinc-200">
                                    {target.date} · {target.time}
                                  </span>
                                  <span className="text-zinc-600">·</span>
                                  <span className="text-zinc-400">
                                    {target.platforms.join(', ') || 'no platform'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-zinc-500 line-clamp-2">
                                  {target.caption || '(no caption)'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={close}
                                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-colors"
                                autoFocus
                              >
                                Cancel
                              </button>
                              <button
                                onClick={confirmDelete}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Grid view — empty state or card grid */}
                    {postReadyView === 'grid' && (
                    ready.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
                        <Save className="w-10 h-10 text-zinc-700" />
                        <p className="text-sm text-zinc-500">
                          No posts ready yet. Go to the Gallery and click{' '}
                          <span className="text-emerald-400">&quot;Prepare for Post&quot;</span> on
                          an image, or caption it in the Captioning Studio and mark it ready.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setView('gallery')}
                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm"
                          >
                            Open Gallery
                          </button>
                          <button
                            onClick={() => setView('captioning')}
                            className="btn-blue-sm px-4 py-2 text-sm"
                          >
                            Captioning Studio
                          </button>
                        </div>
                      </div>
                    ) : (
                      <PostReadyDndGrid postItems={sortedPostItems} onMove={dndMoveHandler}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {sortedPostItems.map((item, i) => {
                          // ── Carousel card branch — V060-001 ─────────────
                          if (item.kind === 'carousel') {
                            const key = `carousel-${item.id}`;
                            const busy = postBusy[key];
                            const status = postStatus[key];
                            const anchor = item.images[0];
                            const isExplicit = !!item.group;
                            const selPlatforms = getSelectedPlatforms(key);
                            const isCarouselRegen = preparingPostId === anchor.id;
                            const carouselScheduled = latestScheduleFor(anchor.id);
                            return (
                              // GRID-COLUMN-FIX: wrap slot+card so each iteration is one grid cell.
                              <div key={item.id} className={i % 2 === 1 ? 'lg:col-start-2' : ''}>
                                <CarouselReorderSlot beforeGroupId={item.id} />
                                <PostReadyCarouselCard
                                  images={item.images}
                                  carouselId={item.id}
                                  isExplicit={isExplicit}
                                  scheduledPost={carouselScheduled}
                                  allScheduledPosts={settings.scheduledPosts || []}
                                  selectedPlatforms={selPlatforms}
                                  available={available}
                                  busy={busy}
                                  status={status}
                                  isRegen={isCarouselRegen}
                                  copyHighlighted={copiedId === `all-${key}`}
                                  onPreviewClick={(ci) => setSelectedImage(ci)}
                                  onCaptionChange={(next) =>
                                    propagateCaptionToGroup(item.images, next, undefined)
                                  }
                                  onTogglePlatform={(p) => togglePlatformFor(key, p)}
                                  onPostNow={() => postCarouselNow(item, selPlatforms)}
                                  onSchedule={(date, time) =>
                                    scheduleCarousel(item, selPlatforms, date, time)
                                  }
                                  onCopy={() =>
                                    copyWithFeedback(formatPost(anchor), `all-${key}`)
                                  }
                                  onRegen={async () => {
                                    setPreparingPostId(anchor.id);
                                    try {
                                      await fanCaptionToGroup(anchor, item.images, { force: true });
                                    } finally {
                                      setPreparingPostId(null);
                                    }
                                  }}
                                  onUnreadyAll={() => {
                                    for (const ci of item.images) {
                                      patchImage(ci, { isPostReady: false });
                                    }
                                  }}
                                  onSeparate={() => separateCarousel(item.id)}
                                  onLockGroup={() =>
                                    persistCarouselGroup(`manual-${anchor.id}`, item.images.map((i) => i.id))
                                  }
                                  onCancelSchedule={() => unscheduleCarousel(item.images, key)}
                                />
                              </div>
                            );
                          }

                          // ── Single-image card branch — V060-001 ─────────
                          const img = item.img;
                          const isRegen = preparingPostId === img.id;
                          const selPlatforms = getSelectedPlatforms(img.id);
                          const busy = postBusy[img.id];
                          const status = postStatus[img.id];
                          const scheduled = latestScheduleFor(img.id);
                          return (
                            // GRID-COLUMN-FIX: wrap slot+card so each iteration is one grid cell.
                            <div key={img.id} className={i % 2 === 1 ? 'lg:col-start-2' : ''}>
                              <CarouselReorderSlot beforeGroupId={img.id} />
                              <DraggableSingleWrapper imageId={img.id} imageUrl={img.url}>
                                <PostReadyCard
                                  img={img}
                                  scheduledPost={scheduled}
                                  allScheduledPosts={settings.scheduledPosts || []}
                                  selectedPlatforms={selPlatforms}
                                  available={available}
                                  busy={busy}
                                  status={status}
                                  isRegen={isRegen}
                                  groupingChecked={postReadySelected.has(img.id)}
                                  onGroupingToggle={(checked) => {
                                    const next = new Set(postReadySelected);
                                    if (checked) next.add(img.id);
                                    else next.delete(img.id);
                                    setPostReadySelected(next);
                                  }}
                                  copyHighlighted={copiedId === `all-${img.id}`}
                                  onPreviewClick={() => setSelectedImage(img)}
                                  onCaptionChange={(next) => patchImage(img, { postCaption: next })}
                                  onRemoveHashtag={(i) => removeHashtag(img, i)}
                                  onTogglePlatform={(p) => togglePlatformFor(img.id, p)}
                                  onPostNow={() => postImageNow(img, selPlatforms)}
                                  onSchedule={(date, time) =>
                                    scheduleImage(img, selPlatforms, date, time)
                                  }
                                  onCopy={() =>
                                    copyWithFeedback(formatPost(img), `all-${img.id}`)
                                  }
                                  onRegen={async () => {
                                    setPreparingPostId(img.id);
                                    try {
                                      await generatePostContent(img);
                                    } finally {
                                      setPreparingPostId(null);
                                    }
                                  }}
                                  onUnready={() => patchImage(img, { isPostReady: false })}
                                  onCancelSchedule={() => unschedulePost(img)}
                                />
                              </DraggableSingleWrapper>
                            </div>
                          );
                        })}
                        {/* Trailing reorder slot — drop here = insert at end. */}
                        <CarouselReorderSlot beforeGroupId={null} />
                      </div>
                      </PostReadyDndGrid>
                    )
                    )}

                    {/* FEAT-2 §7: undo affordance for DnD moves. Lives at
                        viewport bottom-right; mounted whenever Post Ready
                        is visible so it can react to the latest move. */}
                    <DndUndoToast
                      message={dndUndoToast}
                      onUndo={undoLastDndMove}
                      onDismiss={() => setDndUndoToast(null)}
                    />

                    {/* History view — posts where every ScheduledPost is
                        'posted'. Read-only thumbnail grid so users can
                        still audit what went out without the active
                        Post-Ready grid being cluttered by them. */}
                    {postReadyView === 'history' && (
                      postedImages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
                          <Check className="w-10 h-10 text-zinc-700" />
                          <p className="text-sm text-zinc-500">
                            Nothing posted yet. Successfully posted content will appear here.
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {postedImages.map((img) => {
                            const posts = (settings.scheduledPosts || []).filter((p) => p.imageId === img.id);
                            const last = posts[posts.length - 1];
                            return (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => setSelectedImage(img)}
                                className="group relative bg-zinc-900/80 border-2 border-emerald-500/40 rounded-xl overflow-hidden hover:border-emerald-400/70 transition-colors text-left"
                                title={img.postCaption || img.prompt}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.url}
                                  alt={img.prompt}
                                  loading="lazy"
                                  className="w-full aspect-square object-cover"
                                />
                                <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/90 text-[10px] font-semibold text-white">
                                  <Check className="w-3 h-3" /> Posted
                                </div>
                                {last && (
                                  <div className="px-2 py-1.5 text-[10px] text-zinc-400 truncate">
                                    {last.date} · {last.platforms.join(', ')}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )
                    )}

                    {/* Schedule-All modal — extracted to SmartScheduleModal (PROP-016) */}
                    {showScheduleAll && (
                      <SmartScheduleModal
                        slots={smartScheduler.slots}
                        source={smartScheduler.source}
                        form={smartScheduler.form}
                        available={available}
                        postCount={postItems.length}
                        onFormChange={(patch) => smartScheduler.setForm((prev) => ({ ...prev, ...patch }))}
                        onClose={() => { setShowScheduleAll(false); smartScheduler.clear(); }}
                        onConfirm={() => {
                          // Dispatch per PostItem (carousel-aware) so grouped carousels
                          // consume one slot and route to scheduleCarousel.
                          const form = smartScheduler.form;
                          const slots = smartScheduler.slots;
                          const dispatch = (item: PostItem, date: string, time: string) => {
                            if (item.kind === 'carousel') {
                              scheduleCarousel(item, form.platforms, date, time);
                            } else {
                              scheduleImage(item.img, form.platforms, date, time);
                            }
                          };

                          // Slots to consume: use all computed slots, then find
                          // additional unconsumed slots for any overflow posts.
                          // Previously the fallback scheduled ALL remaining posts
                          // at the same form.{date,time}, causing bunching.
                          // The primary slots seed `consumedKeys` so the overflow
                          // call to findBestSlots treats them as taken — without
                          // this, the second findBestSlots call returns the same
                          // top-N picks and two posts collide on identical slots.
                          const consumedKeys = new Set<string>(
                            slots.map((s) => `${s.date}T${s.time}`),
                          );
                          const extraSlots = smartScheduler.slots.length < postItems.length
                            ? findExtraSlots(postItems.length - smartScheduler.slots.length, settings.scheduledPosts || [], consumedKeys)
                            : [];

                          let slotIdx = 0;
                          for (let i = 0; i < postItems.length; i++) {
                            const item = postItems[i];
                            if (slotIdx < slots.length) {
                              consumedKeys.add(`${slots[slotIdx].date}T${slots[slotIdx].time}`);
                              dispatch(item, slots[slotIdx].date, slots[slotIdx].time);
                              slotIdx++;
                            } else {
                              const extra = extraSlots[slotIdx - slots.length];
                              const date = extra ? extra.date : form.date;
                              const time = extra ? extra.time : form.time;
                              if (extra) consumedKeys.add(`${extra.date}T${extra.time}`);
                              dispatch(item, date, time);
                              slotIdx++;
                            }
                          }
                          setShowScheduleAll(false);
                          smartScheduler.clear();
                        }}
                      />
                    )}
                  </div>
                );
              })()}
              {view === 'pipeline' && <PipelineView panel={<PipelinePanel />} />}

              {/* Carousel multi-source picker modal — lifted out of the
                  Captioning view so Post-Ready (and any other tab) can
                  trigger it. Source pool is every approved OR post-ready
                  saved image so users can mix both stages into one carousel. */}
              {showCarouselPicker && (() => {
                const pickerSource = savedImages.filter((i) => i.approved || i.isPostReady);
                return (
                  <div
                    className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4"
                    onClick={() => setShowCarouselPicker(false)}
                  >
                    <div
                      className="bg-zinc-900/95 backdrop-blur-xl border-0 sm:border border-[#c5a062]/25 rounded-none sm:rounded-2xl w-full sm:max-w-4xl h-full sm:h-auto max-h-[100dvh] sm:max-h-[85vh] flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
                        <div className="flex items-center gap-3">
                          <div className="icon-box-blue">
                            <LayoutGrid className="w-5 h-5 text-[#00e6ff]" />
                          </div>
                          <div>
                            <h3 className="type-title">
                              {pickerTargetGroupId ? 'Edit Carousel' : 'Create Carousel'}
                            </h3>
                            <p className="text-xs text-zinc-500">
                              Pick 2 or more images to group them into a single multi-image post.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowCarouselPicker(false)}
                          className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto p-5">
                        {pickerSource.length === 0 ? (
                          <p className="text-sm text-zinc-500 text-center py-8">
                            No approved saved images yet.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {pickerSource.map((img) => {
                              const inAnotherGroup = (settings.carouselGroups || []).some(
                                (g) => g.id !== pickerTargetGroupId && g.imageIds.includes(img.id)
                              );
                              const selected = pickerSelected.has(img.id);
                              return (
                                <motion.button
                                  key={img.id}
                                  whileHover={inAnotherGroup ? undefined : { scale: 1.03, transition: { type: "spring", stiffness: 300, damping: 25 } }}
                                  whileTap={inAnotherGroup ? undefined : { scale: 0.9 }}
                                  onClick={() => {
                                    if (inAnotherGroup) return;
                                    const next = new Set(pickerSelected);
                                    if (next.has(img.id)) next.delete(img.id);
                                    else next.add(img.id);
                                    setPickerSelected(next);
                                  }}
                                  disabled={inAnotherGroup}
                                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                                    inAnotherGroup
                                      ? 'border-zinc-800/40 opacity-30 cursor-not-allowed'
                                      : selected
                                        ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                                        : 'border-zinc-800/60 hover:border-zinc-600'
                                  }`}
                                  title={inAnotherGroup ? 'Already in another carousel' : img.prompt}
                                >
                                  {img.url ? (
                                    <LazyImg
                                      src={img.url}
                                      alt={img.prompt}
                                      className="w-full h-full object-cover"
                                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-zinc-950">
                                      <ImageOff className="w-6 h-6 text-zinc-700" />
                                    </div>
                                  )}
                                  {img.isPostReady && (
                                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-emerald-600/90 text-[8px] font-medium text-white rounded">
                                      Post Ready
                                    </span>
                                  )}
                                  {selected && (
                                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                                      <Check className="w-3 h-3" />
                                    </div>
                                  )}
                                </motion.button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between p-4 border-t border-zinc-800/60">
                        <span className="text-xs text-zinc-500">
                          {pickerSelected.size} selected
                          {pickerSelected.size < 2 && (
                            <span className="text-amber-400 ml-2">
                              Pick at least 2 images to form a carousel.
                            </span>
                          )}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowCarouselPicker(false)}
                            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={confirmCarouselPicker}
                            disabled={pickerSelected.size < 2}
                            className="btn-blue-sm"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {pickerTargetGroupId ? 'Update Carousel' : 'Create Carousel'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {(view === 'studio' || view === 'gallery') && (
                displayedImages.length === 0 && !isGenerating ? (
            view === 'gallery' ? (
              <EmptyGalleryState
                firstRun={
                  savedImages.length === 0 &&
                  images.length === 0 &&
                  ideas.length === 0 &&
                  (settings.scheduledPosts ?? []).length === 0
                }
                ideaCount={ideas.filter((i) => i.status === 'idea').length}
                setView={setView}
              />
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="h-full flex flex-col items-center justify-center text-zinc-500 py-20"
              >
                <div className="w-24 h-24 mb-6 rounded-full bg-zinc-900/50 border border-zinc-800/60 flex items-center justify-center">
                  <ImageIcon className="w-10 h-10 text-zinc-700" />
                </div>
                <h2 className="text-xl font-medium text-zinc-300 mb-2">No Images Generated Yet</h2>
                <p className="text-sm max-w-md text-center text-zinc-500">
                  Click &quot;Generate Mashup&quot; to create 4 unique crossover images from famous fantasy universes using Leonardo.AI.
                </p>
              </motion.div>
            )
          ) : (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 pb-12`}>
              {displayedImages.map((img, idx) => {
                const isSaved = savedImages.some(s => s.id === img.id);
                return (
                  <GalleryCard
                    key={img.id}
                    image={img}
                    index={idx}
                    view={view}
                    isSaved={isSaved}
                    settings={settings}
                    collections={collections}
                    selectedForBatch={selectedForBatch}
                    taggingId={taggingId}
                    preparingPostId={preparingPostId}
                    isGenerating={isGenerating}
                    dragOverCollection={dragOverCollection}
                    onOpen={setSelectedImage}
                    onToggleBatch={setSelectedForBatch}
                    setDragOverCollection={setDragOverCollection}
                    setTaggingId={setTaggingId}
                    setPreparingPostId={setPreparingPostId}
                    setShowCollectionModal={setShowCollectionModal}
                    setView={setView}
                    handleAnimate={handleAnimate}
                    rerollImage={rerollImage}
                    toggleApproveImage={toggleApproveImage}
                    addImageToCollection={addImageToCollection}
                    removeImageFromCollection={removeImageFromCollection}
                    saveImage={saveImage}
                    deleteImage={deleteImage}
                    generatePostContent={generatePostContent}
                    autoTagImage={autoTagImage}
                  />
                );
              })}
              {/* Skeleton placeholders if generating */}
              {isGenerating && Array.from({ length: 4 }).map((_, idx) => (
                <motion.div 
                  key={`skeleton-${idx}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="aspect-square bg-zinc-900/50 rounded-2xl border border-zinc-800/50 flex flex-col items-center justify-center animate-pulse"
                >
                  <ImageIcon className="w-12 h-12 text-zinc-800 mb-4" />
                  <div className="h-4 bg-zinc-800 rounded w-1/2 mb-2"></div>
                  <div className="h-4 bg-zinc-800 rounded w-3/4"></div>
                </motion.div>
              ))}
            </div>
          )
        )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {selectedImage && (
        <ImageDetailModal
          image={selectedImage}
          onImageChange={setSelectedImage}
          settings={settings}
          updateSettings={updateSettings}
          collections={collections}
          selectedForBatch={selectedForBatch}
          updateImageTags={updateImageTags}
          addImageToCollection={addImageToCollection}
          removeImageFromCollection={removeImageFromCollection}
          createCollection={createCollection}
          handleAnimate={handleAnimate}
          toggleApproveImage={toggleApproveImage}
          deleteImage={(id, fromSaved) => {
            if (view === 'post-ready') {
              const img = savedImages.find((i) => i.id === id);
              if (img) { patchImage(img, { isPostReady: false }); return; }
            }
            deleteImage(id, fromSaved);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          settings={settings}
          updateSettings={updateSettings}
          saveState={settingsSaveState}
          isDesktop={isDesktop}
          piStatus={piStatus}
          piBusy={piBusy}
          piError={piError}
          piSetupMsg={piSetupMsg}
          handlePiSetup={handlePiSetup}
          ncaSetupMsg={ncaSetupMsg}
          onNcaSetupComplete={setNcaSetupMsg}
          refreshPiStatus={refreshPiStatus}
          collections={collections}
          savedImages={savedImages}
          deleteCollection={deleteCollection}
          openCollectionModal={() => setShowCollectionModal(true)}
        />
      )}

      {showCollectionModal && (
        <CollectionModal
          onClose={() => setShowCollectionModal(false)}
          selectionCount={selectedForBatch.size}
          onSuggest={
            selectedForBatch.size > 0
              ? async () => {
                  const sample = savedImages
                    .filter((img) => selectedForBatch.has(img.id))
                    .slice(0, 5);
                  if (sample.length === 0) return null;
                  return (await autoGenerateCollectionInfo(sample)) ?? null;
                }
              : undefined
          }
          onCreate={async ({ name, description }) => {
            const imageIds = selectedForBatch.size > 0 ? Array.from(selectedForBatch) : undefined;
            // Pass savedImages so createCollection's pi.dev auto-name
            // fallback can fire when the user submits with a blank name.
            const created = await createCollection(name, description, imageIds, savedImages);
            // V082-COLLECTION-FEATURES: actually assign the selected
            // images to the new collection. Previously imageIds only
            // seeded the AI auto-name; membership was left to the user.
            if (imageIds && created) {
              for (const id of imageIds) addImageToCollection(id, created.id);
            }
            setShowCollectionModal(false);
            if (imageIds) setSelectedForBatch(new Set());
          }}
        />
      )}

      {/* Bulk Tag Modal */}
      <AnimatePresence>
        {showBulkTagModal && (
          <BulkTagModal
            onClose={() => setShowBulkTagModal(false)}
            selectedForBatch={selectedForBatch}
            clearBatch={() => setSelectedForBatch(new Set())}
            bulkUpdateImageTags={bulkUpdateImageTags}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

