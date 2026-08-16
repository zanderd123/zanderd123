/**
 * Redeployment risk. Pure functions — given an assignment's shape, how likely
 * is this traveler to finish the contract and leave?
 *
 * The signals are the ones a good recruiter already watches: how long is left,
 * how long since anyone spoke to them, what they said about extending, and
 * whether a credential is about to lapse and block the next start.
 */

export type RiskInput = {
  endsAt: Date | string;
  lastContactAt: Date | string | null;
  extensionStatus: "NOT_ASKED" | "INTERESTED" | "SIGNED" | "DECLINED" | "NO_RESPONSE";
  hasNextStep: boolean;
  /** Days until the soonest credential expiry; null when nothing is close. */
  soonestCredentialDays: number | null;
};

export type RiskLevel = "SECURED" | "STABLE" | "WATCH" | "AT_RISK";

export type RiskResult = {
  level: RiskLevel;
  score: number;
  reasons: string[];
  daysRemaining: number;
  daysSinceContact: number | null;
};

const DAY = 86_400_000;

const toTime = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).getTime();

export function daysUntil(d: Date | string, now = Date.now()) {
  return Math.round((toTime(d) - now) / DAY);
}

export function daysSince(d: Date | string | null, now = Date.now()) {
  if (!d) return null;
  return Math.round((now - toTime(d)) / DAY);
}

export function assessRisk(input: RiskInput, now = Date.now()): RiskResult {
  const daysRemaining = daysUntil(input.endsAt, now);
  const daysSinceContact = daysSince(input.lastContactAt, now);
  const reasons: string[] = [];

  // Something confirmed for after this contract removes the risk entirely.
  if (input.hasNextStep || input.extensionStatus === "SIGNED") {
    return {
      level: "SECURED",
      score: 0,
      reasons: ["Next assignment or extension confirmed"],
      daysRemaining,
      daysSinceContact,
    };
  }

  let score = 0;

  if (daysRemaining <= 14) {
    score += 3;
    reasons.push(`Ends in ${Math.max(0, daysRemaining)} days`);
  } else if (daysRemaining <= 28) {
    score += 2;
    reasons.push(`Ends in ${daysRemaining} days`);
  } else if (daysRemaining <= 45) {
    score += 1;
    reasons.push(`Ends in ${daysRemaining} days`);
  }

  if (daysSinceContact === null) {
    score += 2;
    reasons.push("No contact ever logged");
  } else if (daysSinceContact >= 21) {
    score += 2;
    reasons.push(`No contact in ${daysSinceContact} days`);
  } else if (daysSinceContact >= 10) {
    score += 1;
    reasons.push(`No contact in ${daysSinceContact} days`);
  }

  if (input.extensionStatus === "DECLINED" || input.extensionStatus === "NO_RESPONSE") {
    score += 2;
    reasons.push(
      input.extensionStatus === "DECLINED"
        ? "Extension declined — pitch a new assignment"
        : "No answer on the extension",
    );
  } else if (input.extensionStatus === "NOT_ASKED" && daysRemaining <= 42) {
    score += 1;
    reasons.push("Extension never asked");
  }

  if (input.soonestCredentialDays !== null && input.soonestCredentialDays <= 30) {
    score += 1;
    reasons.push(
      input.soonestCredentialDays < 0
        ? "A credential has already expired"
        : `A credential expires in ${input.soonestCredentialDays} days`,
    );
  }

  const level: RiskLevel = score >= 5 ? "AT_RISK" : score >= 3 ? "WATCH" : "STABLE";
  return { level, score, reasons, daysRemaining, daysSinceContact };
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  SECURED: "Secured",
  STABLE: "Stable",
  WATCH: "Watch",
  AT_RISK: "At risk",
};

/** The single most useful next action, given why the traveler is at risk. */
export function nextAction(r: RiskResult, extensionStatus: RiskInput["extensionStatus"]) {
  if (r.level === "SECURED") {
    return "Confirm the start date and check credentials clear before day one.";
  }
  if (r.daysSinceContact !== null && r.daysSinceContact >= 21) {
    return "Call today — three weeks of silence is how travelers end up signing elsewhere.";
  }
  if (extensionStatus === "DECLINED") {
    return "Extension is a dead end. Pitch two concrete next assignments rather than re-asking.";
  }
  if (r.daysRemaining <= 21) {
    return "Inside the window where travelers commit elsewhere. Get a decision this week.";
  }
  if (extensionStatus === "NOT_ASKED") {
    return "Ask about extending now, while there is still time to source an alternative.";
  }
  return "On track. Check in again before the six-week mark.";
}
