import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button, Modal } from "./ui";
import { money } from "./shell";
import { apiPost } from "@/lib/arena3/client";
import { t, tServer } from "@/lib/i18n";

type TransferQrModalProps = {
  open: boolean;
  onClose: () => void;
  amountVnd: number;
  code: string;
  title?: string;
  buyerName?: string;
  refType?: "booking" | "subscription";
  refId?: string;
  onConfirmManual: () => Promise<void>;
  onPaid?: () => void;
};

export function TransferQrModal({
  open,
  onClose,
  amountVnd,
  code,
  title,
  buyerName,
  refType,
  refId,
  onConfirmManual,
  onPaid,
}: TransferQrModalProps) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!open) {
      setQrSrc(null);
      setPaid(false);
      return;
    }

    let active = true;

    async function loadQr() {
      // 1. If refType and refId provided, try payOS online create first
      if (refType && refId) {
        try {
          const res = await apiPost<{ qr_code: string; payment_id: string }>(
            "/payments/online",
            { ref_type: refType, ref_id: refId },
            true,
          );
          if (active && res.qr_code) {
            const drawn = await QRCode.toDataURL(res.qr_code, {
              width: 512,
              margin: 1,
              errorCorrectionLevel: "M",
              color: { dark: "#141c12", light: "#ffffff" },
            });
            if (active) {
              setQrSrc(drawn);
              return;
            }
          }
        } catch {
          // Fall back to standard VietQR if payOS is unconfigured or unavailable
        }
      }

      // 2. Generate standard VietQR quick transfer payload
      const transferContent = `ARENA3 ${code}`;
      const fallbackPayload = `00020101021238540010A00000072701240006970422011003888899990208QRIBFTTA5303704540${amountVnd.toString().length < 10 ? "0" + amountVnd.toString().length : amountVnd.toString().length}${amountVnd}5802VN62${(transferContent.length + 4).toString().padStart(2, "0")}08${transferContent.length.toString().padStart(2, "0")}${transferContent}6304`;

      try {
        const drawn = await QRCode.toDataURL(fallbackPayload, {
          width: 512,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#141c12", light: "#ffffff" },
        });
        if (active) setQrSrc(drawn);
      } catch {
        // Direct VietQR image URL fallback
        if (active) {
          setQrSrc(`https://img.vietqr.io/image/970422-0388889999-compact2.png?amount=${amountVnd}&addInfo=${encodeURIComponent(transferContent)}&accountName=ARENA%203%20SPORTS`);
        }
      }
    }

    void loadQr();

    return () => {
      active = false;
    };
  }, [open, refType, refId, amountVnd, code]);

  async function handleConfirmManual() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirmManual();
      setPaid(true);
      toast.success(t("Payment confirmed and receipt generated"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Could not confirm payment"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t("Scan QR to pay · Bank transfer")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("Close")}
          </Button>
          <Button variant="primary" onClick={handleConfirmManual} disabled={busy}>
            {busy ? t("Recording…") : t("Money received — confirm & print")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 text-center">
        <p className="text-sm text-muted">
          {t("Ask the customer to scan this QR code with their banking app.")}
        </p>

        {qrSrc ? (
          <div className="relative mx-auto size-64 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white p-2 shadow-sm">
            <img src={qrSrc} alt={t("VietQR payment code")} className="size-full object-contain" />
          </div>
        ) : (
          <div className="mx-auto grid size-64 place-items-center rounded-[var(--radius-lg)] border border-line bg-surface text-sm text-muted">
            {t("Generating QR…")}
          </div>
        )}

        <div className="rounded-[var(--radius-md)] bg-wood/50 p-3 text-left text-sm">
          <div className="flex justify-between border-b border-line pb-1.5 font-medium">
            <span className="text-muted">{t("Amount due")}</span>
            <span className="figure text-lg font-bold text-accent tabular-nums">{money(amountVnd)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
            <span className="text-muted">{t("Bank")}:</span>
            <span className="font-semibold text-fg">MB Bank (Quân Đội)</span>
            <span className="text-muted">{t("Account number")}:</span>
            <span className="font-mono font-semibold text-fg">0388889999</span>
            <span className="text-muted">{t("Account name")}:</span>
            <span className="font-semibold text-fg">ARENA 3 SPORTS COMPLEX</span>
            <span className="text-muted">{t("Transfer reference")}:</span>
            <span className="font-mono font-bold text-accent-2">ARENA3 {code}</span>
            {buyerName ? (
              <>
                <span className="text-muted">{t("Customer")}:</span>
                <span className="text-fg">{buyerName}</span>
              </>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-muted">
          {t("Once the customer completes the transfer, click 'Money received — confirm & print' below to post the payment and print their receipt.")}
        </p>
      </div>
    </Modal>
  );
}
