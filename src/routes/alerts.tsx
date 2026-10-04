import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NotificationList, type Notification } from "@/components/notifications";
import { Guard, Shell, useSessionUser } from "@/components/shell";
import { EmptyState, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/arena3/client";
import { t, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/alerts")({
  component: () => (
    <Guard roles={["manager", "coach", "receptionist"]}>
      <Page />
    </Guard>
  ),
});

/** Staff alerts — a student on a run of absences, for one. Members have their own inbox. */
function Page() {
  const user = useSessionUser();
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    void apiGet<{ items: Notification[] }>("/me/notifications")
      .then((r) => setItems(r.items))
      .catch((e) => {
        setItems([]);
        toast.error(e instanceof Error ? tServer(e.message) : t("Could not load your alerts"));
      });
  }, []);

  return (
    <Shell role={user?.role ?? "coach"} title={t("Alerts")} subtitle={t("Things that need a look. Open one to read it.")}>
      {!items ? (
        <Skeleton className="h-32" />
      ) : !items.length ? (
        <EmptyState title={t("Nothing here yet")} hint={t("You'll be told when a student misses three sessions in a row.")} />
      ) : (
        <NotificationList
          items={items}
          limit={15}
          onRead={(ids) =>
            setItems((cur) =>
              (cur ?? []).map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)),
            )
          }
        />
      )}
    </Shell>
  );
}
