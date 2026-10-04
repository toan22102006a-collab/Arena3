import { createFileRoute } from "@tanstack/react-router";
import { AtRiskPanel } from "@/components/attendance-panels";
import { Shell, useSessionUser } from "@/components/shell";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/desk/at-risk")({ component: Page });

function Page() {
  const user = useSessionUser();
  return (
    <Shell
      role={user?.role === "manager" ? "manager" : "receptionist"}
      title={t("At risk")}
      subtitle={t("Members who may be drifting away. A friendly call now is cheaper than a lapsed plan.")}
    >
      <AtRiskPanel />
    </Shell>
  );
}
