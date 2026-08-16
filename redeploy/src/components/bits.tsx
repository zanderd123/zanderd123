import type { RiskLevel } from "@/lib/risk";
import { RISK_LABEL } from "@/lib/risk";

const CLASS: Record<RiskLevel, string> = {
  SECURED: "p-n",
  STABLE: "p-lo",
  WATCH: "p-md",
  AT_RISK: "p-hi",
};

export function RiskPill({ level }: { level: RiskLevel }) {
  return <span className={`pill ${CLASS[level]}`}>{RISK_LABEL[level]}</span>;
}

export function Kpi({
  k,
  v,
  d,
  alert,
}: {
  k: string;
  v: string | number;
  d?: string;
  alert?: boolean;
}) {
  return (
    <div className="kpi">
      <p className="k">{k}</p>
      <p className={`v num${alert ? " hi" : ""}`}>{v}</p>
      {d && <p className="d">{d}</p>}
    </div>
  );
}

export function Panel({
  title,
  note,
  children,
  action,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {note && <span className="note">{note}</span>}
        {action && <div className="spacer" />}
        {action}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export const EXT_LABEL: Record<string, string> = {
  NOT_ASKED: "Not asked",
  INTERESTED: "Interested",
  SIGNED: "Signed",
  DECLINED: "Declined",
  NO_RESPONSE: "No response",
};
