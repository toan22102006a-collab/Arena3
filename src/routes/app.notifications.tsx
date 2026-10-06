import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NotificationList, type Notification } from "@/components/notifications";
import { Shell } from "@/components/shell";
import { Button, EmptyState, LoadError, Skeleton } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

export const Route = createFileRoute("/app/notifications")({
  component: Page,
});

/** The member's inbox, apart from the account menu (G-08). */
function Page() {
  const { data, error, reload } = useRead<{ items: Notification[] }>("/me/notifications");
  // The list is the server's copy, marked read here as the person opens things.
  const [items, setItems] = useState<Notification[] | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  useEffect(() => {
    setItems(data?.items ?? null);
  }, [data]);

  const hasRead = (items ?? []).some((n) => n.read_at);

  return (
    <Shell
      role="member"
      title={t("Notifications")}
      subtitle={t("Receipts, booking changes and replies from reception. Open one to read it.")}
    >
      {error ? (
        <LoadError message={error.message} onRetry={error.refused ? undefined : reload} />
      ) : !items ? (
        <Skeleton className="h-32" />
      ) : !items.length ? (
        <EmptyState
          title={t("Nothing here yet")}
          hint={t("Receipts and booking updates will show up here as they happen.")}
        />
      ) : (
        <>
          {hasRead ? (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setOnlyNew((v) => !v)}>
                {onlyNew ? t("Show read ones too") : t("Hide read ones")}
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
