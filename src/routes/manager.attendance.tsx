import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AtRiskPanel, AttendancePanel } from "@/components/attendance-panels";
import { Shell } from "@/components/shell";
import { Seg } from "@/components/ui";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/manager/attendance")({ component: Page });

function Page() {
  const [tab, setTab] = useState("rate");
  return (
    <Shell
      role="manager"
      title={t("Attendance")}
      subtitle={t("How often people actually turn up, and who needs a call before they drift away.")}
    >
      <div className="mb-4">
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { value: "rate", label: t("Attendance rate") },
            { value: "risk", label: t("At risk") },
          ]}
        />
      </div>
      {tab === "rate" ? <AttendancePanel canExport /> : <AtRiskPanel />}
    </Shell>
  );
}
