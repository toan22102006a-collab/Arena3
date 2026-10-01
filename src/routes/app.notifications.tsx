import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NotificationList, type Notification } from "@/components/notifications";
import { Shell } from "@/components/shell";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/arena3/client";

export const Route = createFileRoute("/app/notifications")({
  component: Page,
});

/** The member's inbox, apart from the account menu (G-08). */
function Page() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);

  useEffect(() => {
    void apiGet<{ items: Notification[] }>("/me/notifications")
      .then((r) => setItems(r.items))
      .catch((e) => {
        setItems([]);
        toast.error(e instanceof Error ? e.message : "Could not load your notifications");
      });
  }, []);

  const hasRead = (items ?? []).some((n) => n.read_at);

  return (
    <Shell
      role="member"
      title="Notifications"
      subtitle="Receipts, booking changes and replies from reception. Open one to read it."
    >
      {!items ? (
        <Skeleton className="h-32" />
      ) : !items.length ? (
        <EmptyState title="Nothing here yet" hint="Receipts and booking updates will show up here as they happen." />
      ) : (
        <>
          {hasRead ? (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setOnlyNew((v) => !v)}>
                {onlyNew ? "Show read ones too" : "Hide read ones"}
              </Button>
            </div>
          ) : null}
          <NotificationList
            items={items}
            limit={15}
            hideRead={onlyNew}
            onRead={(ids) =>
              setItems((cur) =>
                (cur ?? []).map((n) =>
                  ids.includes(n.id) && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
                ),
              )
            }
          />
        </>
      )}
    </Shell>
  );
}
