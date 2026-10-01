import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, Modal } from "@/components/ui";
import { money, when } from "@/components/shell";
import { apiPost, openInvoice } from "@/lib/arena3/client";

export type Notification = {
  id: string;
  template: string;
  payload: unknown;
  sent_at: string;
  read_at: string | null;
};

type Content = {
  title: string;
  body: string;
  /** Somewhere to go from here, when there is somewhere. */
  link?: { to: string; label: string };
  receipt?: { invoice_id: string };
};

function asObj(p: unknown): Record<string, unknown> {
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

function methodLabel(m: unknown) {
  return (
    { cash: "cash", card: "card", transfer: "bank transfer", quota: "plan hours" } as Record<string, string>
  )[String(m)] ?? "payment";
}

/**
 * What a notification says once it is opened. The row in the list only has room
 * for a headline; this is the sentence behind it, built from what was stored.
 */
export function notificationContent(n: Pick<Notification, "template" | "payload">): Content {
  const p = asObj(n.payload);
  const code = typeof p.code === "string" ? p.code : null;
  switch (n.template) {
    case "payment_receipt": {
      const amount = typeof p.amount_vnd === "number" ? money(p.amount_vnd) : null;
      return {
        title: amount ? `Receipt · ${amount}` : "Payment receipt",
        body: `${amount ? `We took ${amount}` : "A payment was recorded"} by ${methodLabel(p.method)}. The receipt is saved to your account.`,
        receipt: typeof p.invoice_id === "string" ? { invoice_id: p.invoice_id } : undefined,
      };
    }
    case "booking_confirmed":
      return {
        title: "Booking confirmed",
        body: `${code ? `Booking ${code} is` : "Your booking is"} confirmed. Show your member code at the desk when you arrive.`,
        link: { to: "/app/book", label: "See my bookings" },
      };
    case "booking_cancelled":
      return {
        title: "Booking cancelled",
        body: "That booking was cancelled and the court is free again. Any refund follows the cancellation rules.",
        link: { to: "/app/book", label: "Book another court" },
      };
    case "booking_rescheduled":
      return {
        title: "Booking moved",
        body: `${code ? `Booking ${code} now` : "Your booking now"} has the new court time you picked. The old slot is free again.`,
        link: { to: "/app/book", label: "See my bookings" },
      };
    case "transfer_requested":
      return {
        title: "Transfer noted",
        body: "Reception has been told you sent the bank transfer. They will confirm it when it reaches the account, and your booking is held until then.",
        link: { to: "/app/book", label: "See my bookings" },
      };
    case "transfer_rejected":
      return {
        title: "We could not find your transfer",
        body: "The transfer did not reach the account. Check the amount and the reference, or pay at the desk — your hold keeps running until it ends.",
        link: { to: "/app/book", label: "See my bookings" },
      };
    case "hold_expiring":
    case "hold_expired":
      return {
        title: n.template === "hold_expired" ? "Your hold ended" : "Your hold is about to expire",
        body:
          n.template === "hold_expired"
            ? "The hold ran out before payment, so the court was released."
            : "Pay before the hold ends or the court goes back on sale.",
        link: { to: "/app/book", label: "Open bookings" },
      };
    case "class_changed": {
      const reason = typeof p.reason === "string" && p.reason !== "conflict" ? ` Reason: ${p.reason}.` : "";
      const link = { to: "/app/classes", label: "Open my classes" };
      switch (p.kind) {
        case "session_cancelled":
          return {
            title: "A class session was cancelled",
            body: `${typeof p.start === "string" ? `The session on ${new Date(p.start).toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} will not run.` : "A session will not run."}${reason}`,
            link,
          };
        case "session_moved":
          return {
            title: "A class session moved",
            body: `${typeof p.start === "string" ? `It now starts ${new Date(p.start).toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "It has a new time."}${reason}`,
            link,
          };
        case "coach_changed":
          return {
            title: "Your class has a new coach",
            body: `${typeof p.coach_name === "string" ? `${p.coach_name} takes the sessions still to come.` : "A new coach takes the sessions still to come."}${reason}`,
            link,
          };
        case "class_cancelled":
          return {
            title: "A class was cancelled",
            body: `The class has been cancelled and any session you had in it is given back.${reason}`,
            link,
          };
        default:
          return {
            title: "Class schedule changed",
            body:
              p.reason === "conflict"
                ? "A class could not be scheduled for one date because the court or coach was busy."
                : "A class you are in has changed. Open your classes to see the new time and court.",
            link,
          };
      }
    }
    case "sub_expiring":
      return {
        title: "Plan expiring soon",
        body: "Your plan ends within a week. Renew to keep your court hours and discount.",
        link: { to: "/app/plans", label: "See plans" },
      };
    case "waitlist_offer":
      return {
        title: "A class seat opened",
        body: "A seat is yours if you claim it before the offer runs out.",
        link: { to: "/app/classes", label: "Claim the seat" },
      };
    case "refund_approved":
      return {
        title: "Refund approved",
        body: `${typeof p.amount_vnd === "number" ? money(p.amount_vnd) : "Your refund"}${code ? ` (${code})` : ""} was approved and paid back.${typeof p.note === "string" ? ` Note: ${p.note}` : ""}`,
      };
    case "refund_rejected":
      return {
        title: "Refund declined",
        body: `Your refund request${code ? ` ${code}` : ""} was declined.${typeof p.note === "string" ? ` Reason: ${p.note}` : " Ask reception if you want to know why."}`,
      };
    case "homework_assigned":
      return {
        title: "New homework",
        body: `${typeof p.coach_name === "string" ? p.coach_name : "Your coach"} set “${typeof p.title === "string" ? p.title : "homework"}”${typeof p.due_on === "string" ? `, due ${p.due_on}` : ""}.`,
        link: { to: "/app/train", label: "Open my progress" },
      };
    case "review_added":
      return {
        title: "Your coach wrote a review",
        body: `${typeof p.coach_name === "string" ? p.coach_name : "Your coach"} reviewed your last ${typeof p.period_weeks === "number" ? p.period_weeks : ""} weeks${typeof p.sport === "string" ? ` of ${p.sport}` : ""}.`,
        link: { to: "/app/train", label: "Read it" },
      };
    case "absent_streak":
      return {
        title: "Three absences in a row",
        body: `${typeof p.member_name === "string" ? p.member_name : "A student"} has missed ${typeof p.streak === "number" ? p.streak : "several"} sessions in a row${typeof p.sport === "string" ? ` of ${p.sport}` : ""}. Worth a check-in.`,
        link: typeof p.user_id === "string" ? { to: `/coach/student/${p.user_id}`, label: "Open their profile" } : undefined,
      };
    case "ticket_replied":
      return {
        title: "Reception replied",
        body: typeof p.reply === "string" && p.reply ? p.reply : "Reception answered your message.",
        link: { to: "/account", label: "Open Support" },
      };
    default:
      return { title: n.template.replace(/_/g, " "), body: "Open your account for the details." };
  }
}

/**
 * The member's notifications. A row opens its content and marks itself read;
 * unread ones carry a dot, so a glance at the list says what is new.
 */
export function NotificationList({
  items,
  onRead,
  limit = 8,
  hideRead = false,
}: {
  items: Notification[];
  /** Called with the ids just marked read, so the owner can update its copy. */
  onRead: (ids: string[]) => void;
  limit?: number;
  /** Tuck read notifications out of the list. Nothing is deleted. */
  hideRead?: boolean;
}) {
  const [open, setOpen] = useState<Notification | null>(null);
  const [all, setAll] = useState(false);
  const unread = items.filter((n) => !n.read_at);
  const visible = hideRead ? unread : items;
  const shown = all ? visible : visible.slice(0, limit);

  async function openOne(n: Notification) {
    setOpen(n);
    if (n.read_at) return;
    onRead([n.id]);
    try {
      await apiPost("/me/notifications/read", { id: n.id });
    } catch {
      // The flag is a convenience; failing to save it must not block reading.
    }
  }

  const c = open ? notificationContent(open) : null;

  return (
    <>
      {unread.length ? (
        <div className="mt-2 flex items-center justify-between text-sm text-muted">
          <span>{unread.length} unread</span>
          <button
            type="button"
            className="underline"
            onClick={async () => {
              const ids = unread.map((n) => n.id);
              onRead(ids);
              try {
                await apiPost("/me/notifications/read", {});
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not mark them read");
              }
            }}
          >
            Mark all read
          </button>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        {shown.map((n) => {
          const row = notificationContent(n);
          return (
            <button key={n.id} type="button" className="block w-full text-left" onClick={() => void openOne(n)}>
              <Card className="flex items-start gap-3 p-4 transition-colors duration-200 hover:bg-wood/40">
                <span
                  aria-label={n.read_at ? "Read" : "Unread"}
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-accent"}`}
                />
                <span>
                  <span className={`block text-sm text-fg ${n.read_at ? "" : "font-medium"}`}>{row.title}</span>
                  <span className="block text-xs text-muted">{when(n.sent_at)}</span>
                </span>
              </Card>
            </button>
          );
        })}
      </div>
      {visible.length > limit ? (
        <div className="mt-2 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${visible.length}`}
          </Button>
        </div>
      ) : null}
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={c?.title ?? "Notification"}
        footer={
          <div className="flex justify-end gap-2">
            {c?.receipt ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await openInvoice(c.receipt!.invoice_id);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "The receipt would not open");
                  }
                }}
              >
                Open receipt
              </Button>
            ) : null}
            {c?.link ? (
              <Link
                to={c.link.to}
                className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-line px-4 text-sm hover:bg-wood"
                onClick={() => setOpen(null)}
              >
                {c.link.label}
              </Link>
            ) : null}
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
        }
      >
        {open && c ? (
          <div className="grid gap-2 text-sm">
            <p>{c.body}</p>
            <p className="text-xs text-muted">{when(open.sent_at)}</p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
