import "server-only";

import { mkdir, appendFile } from "fs/promises";
import path from "path";

/**
 * Outbound email, behind one interface so the provider is a config choice,
 * not a code change.
 *
 * In development, and in any environment without RESEND_API_KEY set, mail is
 * written to a local file instead of sent — nothing here can accidentally
 * email a real address before a provider is deliberately configured.
 */

export type Email = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailSender {
  send(email: Email): Promise<void>;
}

const OUTBOX_PATH =
  process.env.EMAIL_OUTBOX_PATH ?? path.join(process.cwd(), ".dev-outbox", "emails.jsonl");

/** Writes each send as one JSON line, so a caller (or a test) can tail it. */
class FileOutboxSender implements EmailSender {
  async send(email: Email) {
    await mkdir(path.dirname(OUTBOX_PATH), { recursive: true });
    const line = JSON.stringify({ ...email, sentAt: new Date().toISOString() });
    await appendFile(OUTBOX_PATH, line + "\n", "utf8");
    console.log(`[email:dev] ${email.subject} -> ${email.to} (written to ${OUTBOX_PATH})`);
  }
}

class ResendSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(email: Email) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
  }
}

let sender: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (sender) return sender;

  const apiKey = process.env.RESEND_API_KEY;
  sender = apiKey
    ? new ResendSender(apiKey, process.env.EMAIL_FROM ?? "Redeploy <noreply@redeploy.app>")
    : new FileOutboxSender();
  return sender;
}

export function passwordResetEmail(resetUrl: string): Pick<Email, "subject" | "text" | "html"> {
  return {
    subject: "Reset your Redeploy password",
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email and tell your agency's Redeploy owner.`,
    html: `
      <p>Someone requested a password reset for your Redeploy account.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can ignore this
      email — and it is worth telling your agency's Redeploy owner that it happened.</p>
    `.trim(),
  };
}
