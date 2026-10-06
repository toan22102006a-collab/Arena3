import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NotificationList, type Notification } from "@/components/notifications";
import { Guard, Shell, useSessionUser } from "@/components/shell";
import { EmptyState, LoadError, Skeleton } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

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
  const { data, error, reload } = useRead<{ items: Notification[] }>("/me/notifications");
  // The list is the server's copy, marked read here as the person opens things.
  const [items, setItems] = useState<Notification[] | null>(null);
  useEffect(() => {
    setItems(data?.items ?? null);
  }, [data]);

  return (
    <Shell role={user?.role ?? "coach"} title={t("Alerts")} subtitle={t("Things that need a look. Open one to read it.")}>
      {error ? (
        <LoadError message={error.message} onRetry={error.refused ? undefined : reload} />
      ) : !items ? (
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
