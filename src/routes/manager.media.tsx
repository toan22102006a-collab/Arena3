import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Edit3,
  FolderOpen,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { PageHero } from "@/components/page-hero";
import { StatStrip } from "@/components/stat-strip";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadError,
  Modal,
  Seg,
  Skeleton,
} from "@/components/ui";
import { apiPatch, apiPost } from "@/lib/arena3/client";
import { type MediaAspectRatio, type MediaSlotGroup } from "@/lib/arena3/media";
import { locale, t, tk } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

export const Route = createFileRoute("/manager/media")({
  component: Page,
});

export type ManagerAsset = {
  slot: string;
  kind: "image" | "video";
  url: string;
  default_path: string;
  alt_en: string;
  alt_vi: string;
  enabled: boolean;
  width: number | null;
  height: number | null;
  version: number;
  updated_at: string;
  updated_by: string | null;
  history_count: number;
  label_en: string;
  label_vi: string;
  location_en: string;
  location_vi: string;
  group: MediaSlotGroup;
  aspect: MediaAspectRatio;
};

type LibraryItem = {
  path: string;
  name: string;
  kind: string;
  width?: number;
  height?: number;
};

function recDim(aspect: MediaAspectRatio): string {
  switch (aspect) {
    case "16:9":
      return "1920 × 1080";
    case "4:5":
      return "1200 × 1500";
    case "3:4":
      return "1200 × 1600";
    case "1:1":
      return "800 × 800";
    default:
      return "1920 × 1080";
  }
}

function aspectClass(aspect: MediaAspectRatio): string {
  switch (aspect) {
    case "16:9":
      return "aspect-video";
    case "4:5":
      return "aspect-[4/5]";
    case "3:4":
      return "aspect-[3/4]";
    case "1:1":
      return "aspect-square";
    default:
      return "aspect-video";
  }
}

async function compressImageToWebp(file: File): Promise<{ blob: Blob; width: number; height: number; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const maxDim = 2400;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context failed"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Canvas compression failed"));
              return;
            }
            const previewUrl = URL.createObjectURL(blob);
            resolve({ blob, width, height, previewUrl });
          },
          "image/webp",
          0.85,
        );
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function Page() {
  const { data, error, reload } = useRead<{ items: ManagerAsset[] }>("/manager/site-assets");
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [uploadSlot, setUploadSlot] = useState<ManagerAsset | null>(null);
  const [librarySlot, setLibrarySlot] = useState<ManagerAsset | null>(null);
  const [altSlot, setAltSlot] = useState<ManagerAsset | null>(null);
  const [confirmRevertSlot, setConfirmRevertSlot] = useState<ManagerAsset | null>(null);
  const [confirmResetSlot, setConfirmResetSlot] = useState<ManagerAsset | null>(null);

  const isVi = locale() === "vi";
  const items = data?.items ?? [];

  const groups: Array<{ value: string; label: string }> = [
    { value: "all", label: t("All groups") },
    { value: "landing", label: t("Homepage") },
    { value: "auth", label: t("Auth & onboarding") },
    { value: "banner", label: t("Inner banners") },
    { value: "sport", label: t("Sport covers") },
    { value: "coach", label: t("Coaches") },
  ];

  const filteredItems = items.filter((it) => {
    if (selectedGroup === "all") return true;
    return it.group === selectedGroup;
  });

  async function toggleEnabled(item: ManagerAsset) {
    try {
      await apiPatch(`/manager/site-assets/${encodeURIComponent(item.slot)}`, {
        enabled: !item.enabled,
      });
      toast.success(t("Status updated"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    }
  }

  const totalSlots = items.length;
  const enabledSlots = items.filter((i) => i.enabled).length;
  const customSlots = items.filter((i) => i.history_count > 0 || i.version > 1).length;
  const disabledSlots = totalSlots - enabledSlots;

  return (
    <Shell role="manager">
      <PageHero
        slot="banner.manager"
        title={t("Site media")}
        subtitle={t("Hero, banners, sport covers and brand imagery across the app.")}
        className="mb-6"
      />

      <StatStrip
        stats={[
          { label: tk("Total slots"), value: totalSlots },
          { label: tk("Active slots"), value: enabledSlots },
          { label: tk("Custom uploads"), value: customSlots },
          { label: tk("Disabled slots"), value: disabledSlots },
        ]}
        className="mb-6"
      />

      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Seg value={selectedGroup} onChange={setSelectedGroup} options={groups} />
        </div>

        {error ? (
          <LoadError message={error.message} onRetry={reload} />
        ) : !data ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-72 rounded-[var(--radius-xl)]" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title={t("No assets found")}
            hint={t("No slots match the selected group filter.")}
            action={
              selectedGroup !== "all" ? (
                <Button variant="outline" onClick={() => setSelectedGroup("all")}>
                  {t("Show all")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((asset) => {
              const label = isVi ? asset.label_vi : asset.label_en;
              const location = isVi ? asset.location_vi : asset.location_en;
              const curDim = asset.width && asset.height ? `${asset.width} × ${asset.height}` : "–";
              const canRevert = asset.history_count > 0;
              const isDefault = !asset.history_count && asset.version === 1;

              return (
                <Card key={asset.slot} className="flex flex-col overflow-hidden p-0">
                  {/* Media Visual Area */}
                  <div
                    className={`relative overflow-hidden bg-wood/50 ${aspectClass(
                      asset.aspect,
                    )}`}
                  >
                    {asset.kind === "video" ? (
                      <video
                        src={asset.url}
                        className={`h-full w-full object-cover transition-opacity ${
                          asset.enabled ? "opacity-100" : "opacity-30"
                        }`}
                        muted
                        loop
                        playsInline
                        autoPlay
                      />
                    ) : (
                      <img
                        src={asset.url}
                        alt={isVi ? asset.alt_vi || label : asset.alt_en || label}
                        className={`h-full w-full object-cover transition-opacity ${
                          asset.enabled ? "opacity-100" : "opacity-30"
                        }`}
                        loading="lazy"
                      />
                    )}

                    {!asset.enabled ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Badge tone="hold">{t("Slot is currently disabled")}</Badge>
                      </div>
                    ) : null}

                    {/* Safe Area Guide indicator overlay */}
                    {asset.aspect === "16:9" && (
                      <div
                        className="pointer-events-none absolute inset-x-4 inset-y-6 rounded border border-dashed border-white/40"
                        title={t("Safe text area")}
                      />
                    )}

                    <div className="absolute left-3 top-3 flex items-center gap-1.5">
                      <Badge tone={asset.enabled ? "accent" : "muted"}>
                        {asset.enabled ? t("Enabled") : t("Disabled")}
                      </Badge>
                      <Badge tone="muted" className="font-mono text-2xs uppercase">
                        {asset.aspect}
                      </Badge>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="flex flex-1 flex-col p-4 sm:p-5">
                    <div className="mb-2">
                      <p className="font-mono text-2xs text-muted">{asset.slot}</p>
                      <h2 className="text-base font-semibold leading-tight">{label}</h2>
                      <p className="mt-1 text-xs text-muted">
                        {t("Used in: {components}", { components: location })}
                      </p>
                    </div>

                    <div className="my-2 grid grid-cols-2 gap-2 rounded-[var(--radius-sm)] bg-wood/60 p-2.5 text-2xs">
                      <div>
                        <span className="text-muted">{t("Recommended: {dim}", { dim: "" })}</span>
                        <p className="font-medium text-fg">{recDim(asset.aspect)}</p>
                      </div>
                      <div>
                        <span className="text-muted">{t("Current: {dim}", { dim: "" })}</span>
                        <p className="font-medium text-fg">{curDim}</p>
                      </div>
                    </div>

                    <div className="mb-4 mt-auto pt-2 text-2xs text-muted">
                      {asset.updated_at && asset.updated_by
                        ? t("Updated by {name} · {when}", {
                            name: asset.updated_by,
                            when: new Date(asset.updated_at).toLocaleDateString(
                              isVi ? "vi-VN" : "en-US",
                              { month: "short", day: "numeric" },
                            ),
                          })
                        : t("System default")}
                    </div>

                    {/* Actions */}
                    <div className="grid gap-2 border-t border-line pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setUploadSlot(asset)}
                          className="w-full text-xs"
                        >
                          <Upload className="mr-1.5 size-3.5" />
                          {t("Change image")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLibrarySlot(asset)}
                          className="w-full text-xs"
                        >
                          <FolderOpen className="mr-1.5 size-3.5" />
                          {t("From library")}
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAltSlot(asset)}
                            className="inline-flex items-center rounded px-2 py-1 text-2xs font-medium text-muted hover:bg-wood hover:text-fg"
                          >
                            <Edit3 className="mr-1 size-3" />
                            {t("Edit alt text")}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleEnabled(asset)}
                            className="inline-flex items-center rounded px-2 py-1 text-2xs font-medium text-muted hover:bg-wood hover:text-fg"
                          >
                            {asset.enabled ? t("Disabled") : t("Enabled")}
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          {canRevert && (
                            <button
                              type="button"
                              onClick={() => setConfirmRevertSlot(asset)}
                              className="inline-flex items-center rounded px-2 py-1 text-2xs font-medium text-accent hover:bg-accent/10"
                            >
                              <RotateCcw className="mr-1 size-3" />
                              {t("Revert")}
                            </button>
                          )}
                          {!isDefault && (
                            <button
                              type="button"
                              onClick={() => setConfirmResetSlot(asset)}
                              className="inline-flex items-center rounded px-2 py-1 text-2xs font-medium text-muted hover:bg-wood hover:text-fg"
                            >
                              {t("Reset to default")}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      {uploadSlot && (
        <UploadDialog
          asset={uploadSlot}
          onClose={() => setUploadSlot(null)}
          onSuccess={() => {
            setUploadSlot(null);
            reload();
          }}
        />
      )}

      {/* Library Dialog */}
      {librarySlot && (
        <LibraryDialog
          asset={librarySlot}
          onClose={() => setLibrarySlot(null)}
          onSuccess={() => {
            setLibrarySlot(null);
            reload();
          }}
        />
      )}

      {/* Alt Text Dialog */}
      {altSlot && (
        <AltDialog
          asset={altSlot}
          onClose={() => setAltSlot(null)}
          onSuccess={() => {
            setAltSlot(null);
            reload();
          }}
        />
      )}

      {/* Revert Confirm */}
      {confirmRevertSlot && (
        <ConfirmDialog
          title={t("Revert to previous version")}
          message={t("Are you sure you want to revert this image to its previous version?")}
          onConfirm={async () => {
            try {
              await apiPost(`/manager/site-assets/${encodeURIComponent(confirmRevertSlot.slot)}/revert`);
              toast.success(t("Asset reverted"));
              setConfirmRevertSlot(null);
              reload();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("Something went wrong"));
            }
          }}
          onClose={() => setConfirmRevertSlot(null)}
        />
      )}

      {/* Reset Confirm */}
      {confirmResetSlot && (
        <ConfirmDialog
          title={t("Reset to system default")}
          message={t("Are you sure you want to reset this slot to the system default asset?")}
          onConfirm={async () => {
            try {
              await apiPost(`/manager/site-assets/${encodeURIComponent(confirmResetSlot.slot)}/reset`);
              toast.success(t("Asset reset to default"));
              setConfirmResetSlot(null);
              reload();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("Something went wrong"));
            }
          }}
          onClose={() => setConfirmResetSlot(null)}
        />
      )}
    </Shell>
  );
}

function UploadDialog({
  asset,
  onClose,
  onSuccess,
}: {
  asset: ManagerAsset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(f: File) {
    if (!f.type.startsWith("image/")) {
      toast.error(t("Please select an image file"));
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast.error(t("Image file must be under 2MB"));
      return;
    }
    try {
      setFile(f);
      const res = await compressImageToWebp(f);
      setPreview({
        url: res.previewUrl,
        width: res.width,
        height: res.height,
        blob: res.blob,
      });
    } catch {
      toast.error(t("Something went wrong"));
    }
  }

  async function handleSave() {
    if (!preview || !file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("slot", asset.slot);
      formData.append("file", preview.blob, "asset.webp");
      await apiPost("/manager/site-assets/upload", formData);
      toast.success(t("Asset updated"));
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("Upload new image")}>
      <div className="grid gap-4">
        {!preview ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver
                ? "border-accent bg-accent/5"
                : "border-line-strong/60 hover:border-accent hover:bg-wood/40"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            <Upload className="mb-2 size-8 text-muted" />
            <p className="text-sm font-medium">{t("Drop an image here or click to browse")}</p>
            <p className="mt-1 text-2xs text-muted">WebP, PNG, JPEG &lt; 2MB</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="relative overflow-hidden rounded-[var(--radius-md)] bg-black/10">
              <img
                src={preview.url}
                alt={t("Preview")}
                className="max-h-72 w-full object-contain"
              />
              <div
                className="pointer-events-none absolute inset-x-4 inset-y-6 rounded border border-dashed border-white/50"
                title={t("Text overlay safe area")}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{t("Compressed WebP")}</span>
              <span className="font-mono">
                {preview.width} × {preview.height} px · {Math.round(preview.blob.size / 1024)} KB
              </span>
            </div>

            <p className="text-2xs text-muted">
              {t("The highlighted zone indicates where text overlays will appear.")}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          {preview && (
            <Button size="sm" onClick={handleSave} disabled={busy}>
              {busy ? t("Uploading…") : t("Save")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function LibraryDialog({
  asset,
  onClose,
  onSuccess,
}: {
  asset: ManagerAsset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data, error, reload } = useRead<{ items: LibraryItem[] }>("/manager/site-assets/library");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function handleSelect() {
    if (!selectedPath) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("slot", asset.slot);
      formData.append("media_path", selectedPath);
      await apiPost("/manager/site-assets/upload", formData);
      toast.success(t("Asset updated"));
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <Modal open onClose={onClose} title={t("Select image from library")}>
      <div className="grid gap-4">
        {error ? (
          <LoadError message={error.message} onRetry={reload} />
        ) : !data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-28 rounded-[var(--radius-md)]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={t("No assets found")} hint="" />
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => {
                const isSelected = selectedPath === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => setSelectedPath(item.path)}
                    className={`relative flex flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-all ${
                      isSelected
                        ? "border-accent ring-2 ring-accent"
                        : "border-line hover:border-line-strong"
                    }`}
                  >
                    <div className="aspect-video w-full bg-wood">
                      <img
                        src={item.path}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-2 text-2xs">
                      <p className="truncate font-medium">{item.name}</p>
                    </div>
                    {isSelected && (
                      <div className="absolute right-1.5 top-1.5 rounded-full bg-accent p-1 text-accent-fg">
                        <Check className="size-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={handleSelect} disabled={!selectedPath || busy}>
            {busy ? t("Uploading…") : t("Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AltDialog({
  asset,
  onClose,
  onSuccess,
}: {
  asset: ManagerAsset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [altEn, setAltEn] = useState(asset.alt_en || "");
  const [altVi, setAltVi] = useState(asset.alt_vi || "");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await apiPatch(`/manager/site-assets/${encodeURIComponent(asset.slot)}`, {
        alt_en: altEn,
        alt_vi: altVi,
      });
      toast.success(t("Alt text updated"));
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("Edit alt text")}>
      <div className="grid gap-4">
        <Field label={t("Alt text (English)")}>
          <Input
            value={altEn}
            onChange={(e) => setAltEn(e.target.value)}
            placeholder="Descriptive English text..."
          />
        </Field>
        <Field label={t("Alt text (Vietnamese)")}>
          <Input
            value={altVi}
            onChange={(e) => setAltVi(e.target.value)}
            placeholder="Mô tả hình ảnh bằng tiếng Việt..."
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            {t("Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="grid gap-4">
        <p className="text-sm text-muted">{message}</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={busy}>
            {busy ? t("Uploading…") : t("Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
