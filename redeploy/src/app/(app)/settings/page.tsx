import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const user = await requireUser();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 17, fontWeight: 650 }}>Settings</h1>
        <p className="sub2">
          These three numbers drive every margin and risk figure in the app. Changing them
          changes how existing assignments read — nothing about the assignments themselves.
        </p>
      </div>

      <SettingsForm
        marginFloorPct={Math.round(agency.marginFloor * 1000) / 10}
        burdenRatePct={Math.round(agency.burdenRate * 1000) / 10}
        quietDays={agency.quietDays}
        canEdit={user.role === "OWNER"}
      />
    </div>
  );
}
