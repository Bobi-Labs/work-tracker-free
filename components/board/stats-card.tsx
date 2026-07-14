"use client";

import { useMemo } from "react";
import {
  Circle,
  Clock,
  Ban,
  CheckCircle2,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { statusLabels, statusOrder, type Item, type ItemStatus } from "@/lib/types";

interface Props {
  items: Item[];
}

/**
 * Icon + colour per status.
 *
 * Typed as a total `Record<ItemStatus, …>` and rendered by mapping `statusOrder`
 * — NOT from a hand-written tile list. The private app hand-wrote its list, left
 * `future_phase` out of it while still counting it, and shipped a stats strip
 * whose tiles quietly did not sum to `items.length`. With this shape, adding a
 * status breaks the build instead.
 *
 * Colours are semantic (blue = in progress, red = blocked, green = done) and
 * mirror `statusColors` in lib/types. They are deliberately NOT the app accent
 * and must not be re-keyed with the theme.
 */
const STATUS_META: Record<ItemStatus, { Icon: LucideIcon; color: string }> = {
  pending: { Icon: Circle, color: "text-muted-foreground" },
  in_progress: { Icon: Clock, color: "text-blue-400" },
  blocked: { Icon: Ban, color: "text-red-400" },
  done: { Icon: CheckCircle2, color: "text-emerald-400" },
  future_phase: { Icon: CalendarClock, color: "text-indigo-400" },
};

export function StatsCard({ items }: Props) {
  const counts = useMemo(() => {
    const byStatus: Record<ItemStatus, number> = {
      pending: 0,
      in_progress: 0,
      done: 0,
      blocked: 0,
      future_phase: 0,
    };
    for (const item of items) byStatus[item.status]++;
    return byStatus;
  }, [items]);

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
      {statusOrder.map((status) => {
        const { Icon, color } = STATUS_META[status];
        return (
          <div
            key={status}
            className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-3"
          >
            <div className="flex w-full items-center gap-2">
              <div className="h-px flex-1 bg-primary/30" />
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-primary whitespace-nowrap">
                  {statusLabels[status]}
                </span>
              </div>
              <div className="h-px flex-1 bg-primary/30" />
            </div>
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {counts[status]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
