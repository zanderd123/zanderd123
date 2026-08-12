"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import type { Status } from "@prisma/client";

import { moveApplication } from "@/app/actions/applications";
import { BOARD_COLUMNS, STATUS_LABEL, STATUS_DOT } from "@/lib/statuses";
import { relativeDays, formatSalary } from "@/lib/format";

export type BoardCard = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  status: Status;
  priority: "LOW" | "MEDIUM" | "HIGH";
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  updatedAt: string;
  interviewCount: number;
};

export function Board({ cards }: { cards: BoardCard[] }) {
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<Status | null>(null);

  // Move the card immediately, then let the server confirm.
  const [optimisticCards, applyMove] = useOptimistic(
    cards,
    (state: BoardCard[], move: { id: string; status: Status }) =>
      state.map((c) => (c.id === move.id ? { ...c, status: move.status } : c)),
  );

  const handleDrop = (status: Status) => {
    setOverColumn(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;

    const card = optimisticCards.find((c) => c.id === id);
    if (!card || card.status === status) return;

    startTransition(async () => {
      applyMove({ id, status });
      await moveApplication(id, status);
    });
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {BOARD_COLUMNS.map((status) => {
        const columnCards = optimisticCards.filter((c) => c.status === status);

        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
            onDrop={() => handleDrop(status)}
            className={`card flex w-72 shrink-0 flex-col p-3 transition ${
              overColumn === status ? "drop-active" : ""
            }`}
          >
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
              <h2 className="text-sm font-semibold">{STATUS_LABEL[status]}</h2>
              <span className="muted ml-auto text-xs tabular-nums">
                {columnCards.length}
              </span>
            </div>

            <div className="flex-1 space-y-2">
              {columnCards.length === 0 && (
                <p className="muted rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs">
                  Drop here
                </p>
              )}

              {columnCards.map((card) => {
                const salary = formatSalary(
                  card.salaryMin,
                  card.salaryMax,
                  card.currency,
                );

                return (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverColumn(null);
                    }}
                    className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 transition hover:border-indigo-400 ${
                      dragId === card.id ? "dragging" : ""
                    }`}
                  >
                    <Link href={`/applications/${card.id}`} className="block cursor-grab">
                      <p className="truncate text-sm font-medium">
                        {card.company}
                        {card.priority === "HIGH" && (
                          <span className="ml-1.5 text-xs text-rose-600 dark:text-rose-400">
                            ★
                          </span>
                        )}
                      </p>
                      <p className="muted mt-0.5 truncate text-xs">{card.title}</p>

                      {(card.location || salary) && (
                        <p className="muted mt-1.5 truncate text-xs">
                          {[card.location, salary].filter(Boolean).join(" · ")}
                        </p>
                      )}

                      <div className="muted mt-2 flex items-center justify-between text-xs">
                        <span>{relativeDays(card.updatedAt)}</span>
                        {card.interviewCount > 0 && (
                          <span>
                            {card.interviewCount}{" "}
                            {card.interviewCount === 1 ? "interview" : "interviews"}
                          </span>
                        )}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
