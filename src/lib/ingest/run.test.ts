import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `run.ts` is pure orchestration, so every stage it drives is mocked: these
 * tests assert wiring, throttling, failure isolation and logging rather than
 * re-testing the stages (each has its own DB-backed suite).
 *
 * run.ts captures its tuning constants at module load, so changing env means
 * re-importing it under `vi.resetModules()`. That also hands run.ts *fresh*
 * mock instances, so `loadRun` returns the freshly-imported mocks — configuring
 * a statically-imported one would silently target a stale copy.
 */

const feedStateRows: { lastPolledAt: string | null }[] = [];
const deletedRows: unknown[] = [];
const vacuumed: string[] = [];
/** Flip to make the VACUUM in runCleanup reject, exercising its catch. */
let failVacuum = false;

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => feedStateRows.slice() }) }),
    }),
    delete: () => ({ where: () => ({ returning: async () => deletedRows.slice() }) }),
    execute: async () => {
      if (failVacuum) throw new Error("VACUUM denied");
      vacuumed.push("VACUUM");
      return undefined;
    },
  },
}));

vi.mock("../differ", () => ({ ensureVenuesExist: vi.fn() }));
vi.mock("../notifiers", () => ({ notifyUsers: vi.fn() }));
vi.mock("./openactive/ingest", () => ({ ingestFacilities: vi.fn(), pollSlots: vi.fn() }));
vi.mock("./reconcile", () => ({ fullSweep: vi.fn(), confirmFeedChanges: vi.fn() }));
vi.mock("./clubspark/ingest", () => ({ pollClubSpark: vi.fn() }));
vi.mock("./feed-state", () => ({ upsertFeedState: vi.fn() }));

// --- fixtures ---------------------------------------------------------------

type Change = {
  venue: string;
  date: string;
  time: string;
  court: string;
  oldStatus: string | null;
  newStatus: string;
  price?: string;
};

function change(over: Partial<Change> = {}): Change {
  return {
    venue: "victoria-park",
    date: "2026-08-12",
    time: "18:00",
    court: "Court 1",
    oldStatus: "booked",
    newStatus: "available",
    ...over,
  };
}

function slotsSummary(over: Record<string, unknown> = {}) {
  return {
    pages: 3,
    updated: 10,
    deleted: 1,
    resolved: 9,
    unresolved: 0,
    slotsUpserted: 9,
    transitions: 0,
    startedFromHead: true,
    byVenue: {} as Record<string, number>,
    cursor: "https://feed/next",
    changes: [] as Change[],
    healed: false,
    healedResolved: 0,
    unresolvedBy: { foreign: 0, unmappedCourt: 0, excludedNonTennis: 0, noTime: 0, badData: 0 },
    ...over,
  };
}

function clubsparkSummary(over: Record<string, unknown> = {}) {
  return {
    venues: 2,
    slotsScraped: 100,
    courtsUpserted: 4,
    slotsUpserted: 100,
    transitions: 0,
    errors: [] as { venueSlug: string; error: string }[],
    changes: [] as Change[],
    ...over,
  };
}

function sweepSummary(over: Record<string, unknown> = {}) {
  return {
    venueDays: 56,
    slotsScraped: 0,
    upserted: 0,
    transitions: 0,
    errors: [] as { venueSlug: string; date: string; error: string }[],
    changes: [] as Change[],
    ...over,
  };
}

function confirmSummary(over: Record<string, unknown> = {}) {
  return {
    input: 0,
    toConfirm: 0,
    scrapedVenueDays: 0,
    suppressed: 0,
    discovered: 0,
    changes: [] as Change[],
    errors: [] as { venueSlug: string; date: string; error: string }[],
    persist: true,
    ...over,
  };
}

const FACILITY_SUMMARY = {
  pages: 2,
  itemsSeen: 59,
  londonVenues: 7,
  venuesInserted: 0,
  venuesUpdated: 7,
  courtsUpserted: 18,
};

/** Load run.ts with fresh env + fresh mocks, pre-seeded with happy-path returns. */
async function loadRun(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);

  // Import and configure the dependencies BEFORE run.ts, so its module-level
  // bindings resolve to mocks that already behave.
  const differ = await import("../differ");
  const notifiers = await import("../notifiers");
  const openactive = await import("./openactive/ingest");
  const reconcile = await import("./reconcile");
  const clubspark = await import("./clubspark/ingest");
  const feedState = await import("./feed-state");

  const m = {
    ensureVenuesExist: vi.mocked(differ.ensureVenuesExist),
    notifyUsers: vi.mocked(notifiers.notifyUsers),
    ingestFacilities: vi.mocked(openactive.ingestFacilities),
    pollSlots: vi.mocked(openactive.pollSlots),
    fullSweep: vi.mocked(reconcile.fullSweep),
    confirmFeedChanges: vi.mocked(reconcile.confirmFeedChanges),
    pollClubSpark: vi.mocked(clubspark.pollClubSpark),
    upsertFeedState: vi.mocked(feedState.upsertFeedState),
  };

  m.ensureVenuesExist.mockReset().mockResolvedValue(undefined as never);
  m.notifyUsers.mockReset().mockResolvedValue(undefined as never);
  m.upsertFeedState.mockReset().mockResolvedValue(undefined as never);
  m.ingestFacilities.mockReset().mockResolvedValue(FACILITY_SUMMARY as never);
  m.pollSlots.mockReset().mockResolvedValue(slotsSummary() as never);
  m.pollClubSpark.mockReset().mockResolvedValue(clubsparkSummary() as never);
  m.fullSweep.mockReset().mockResolvedValue(sweepSummary() as never);
  m.confirmFeedChanges.mockReset().mockResolvedValue(confirmSummary() as never);

  const run = await import("./run");

  return { runFeedIngest: run.runFeedIngest, m };
}

/** feed_state empty ⇒ every clock has never run ⇒ all due. */
function allClocksDue() {
  feedStateRows.length = 0;
}

/** A fresh timestamp makes every throttled clock skip. */
function allClocksThrottled() {
  feedStateRows.length = 0;
  feedStateRows.push({ lastPolledAt: new Date().toISOString() });
}

const loggedText = () => vi.mocked(console.log).mock.calls.flat().join("\n");
const warnedText = () => vi.mocked(console.warn).mock.calls.flat().join("\n");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deletedRows.length = 0;
  vacuumed.length = 0;
  failVacuum = false;
  allClocksDue();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// --- tests ------------------------------------------------------------------

describe("runFeedIngest – stage wiring", () => {
  it("runs every stage when all clocks are due", async () => {
    const { runFeedIngest, m } = await loadRun();

    await runFeedIngest();

    expect(m.ensureVenuesExist).toHaveBeenCalledOnce();
    expect(m.ingestFacilities).toHaveBeenCalledOnce();
    expect(m.pollSlots).toHaveBeenCalledOnce();
    expect(m.pollClubSpark).toHaveBeenCalledOnce();
    expect(m.fullSweep).toHaveBeenCalledOnce();
    expect(loggedText()).toContain("Feed ingest completed successfully");
  });

  it("persists on every availability stage", async () => {
    const { runFeedIngest, m } = await loadRun();

    await runFeedIngest();

    expect(m.pollSlots.mock.calls[0][0]).toMatchObject({ persist: true });
    expect(m.pollClubSpark).toHaveBeenCalledWith({ persist: true });
    expect(m.fullSweep).toHaveBeenCalledWith({ persist: true });
  });

  it("stamps each throttled clock after it succeeds", async () => {
    const { runFeedIngest, m } = await loadRun();

    await runFeedIngest();

    const stamped = m.upsertFeedState.mock.calls.map(([, feed]) => feed);
    expect(stamped).toContain("clubspark");
    expect(stamped).toContain("sweep");
    expect(stamped).toContain("cleanup");
  });
});

describe("runFeedIngest – throttling", () => {
  it("skips the throttled clocks when they ran recently", async () => {
    const { runFeedIngest, m } = await loadRun();
    allClocksThrottled();

    await runFeedIngest();

    expect(m.ingestFacilities).not.toHaveBeenCalled();
    expect(m.pollClubSpark).not.toHaveBeenCalled();
    expect(m.fullSweep).not.toHaveBeenCalled();
  });

  it("still head-polls the feed on a throttled tick", async () => {
    const { runFeedIngest, m } = await loadRun();
    allClocksThrottled();

    await runFeedIngest();

    // Clock 1 is the point of a fast tick — it must never be throttled.
    expect(m.pollSlots).toHaveBeenCalledOnce();
  });

  it("logs how stale the facility data was when skipping", async () => {
    const { runFeedIngest } = await loadRun();
    allClocksThrottled();

    await runFeedIngest();

    expect(loggedText()).toContain("Facility refresh skipped");
  });

  it("force bypasses the availability throttles", async () => {
    const { runFeedIngest, m } = await loadRun();
    allClocksThrottled();

    await runFeedIngest({ force: true });

    expect(m.ingestFacilities).toHaveBeenCalledOnce();
    expect(m.pollClubSpark).toHaveBeenCalledOnce();
    expect(m.fullSweep).toHaveBeenCalledOnce();
    expect(loggedText()).toContain("manual refresh — unthrottled");
  });

  it("keeps cleanup throttled even under force, so a manual refresh never VACUUMs", async () => {
    const { runFeedIngest, m } = await loadRun();
    allClocksThrottled();

    await runFeedIngest({ force: true });

    expect(m.upsertFeedState.mock.calls.map(([, f]) => f)).not.toContain("cleanup");
    expect(vacuumed).toHaveLength(0);
  });
});

describe("runFeedIngest – failure isolation", () => {
  it("continues to the later clocks when Clock 1 throws", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockRejectedValue(new Error("feed 503"));

    await runFeedIngest();

    expect(m.pollClubSpark).toHaveBeenCalledOnce();
    expect(m.fullSweep).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Clock 1"),
      expect.any(Error)
    );
  });

  it("does not stamp a clock that failed, so it retries next tick", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollClubSpark.mockRejectedValue(new Error("clubspark down"));

    await runFeedIngest();

    expect(m.fullSweep).toHaveBeenCalledOnce();
    expect(m.upsertFeedState.mock.calls.map(([, f]) => f)).not.toContain("clubspark");
  });

  it("survives a sweep failure and still notifies on earlier changes", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "off" });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change()] }) as never);
    m.fullSweep.mockRejectedValue(new Error("sweep exploded"));

    await runFeedIngest();

    expect(m.notifyUsers).toHaveBeenCalledWith([
      expect.objectContaining({ venue: "victoria-park" }),
    ]);
  });

  it("treats a facility ingest failure as non-fatal", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.ingestFacilities.mockRejectedValue(new Error("facility feed 500"));

    await runFeedIngest();

    expect(m.pollSlots).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Facility ingest failed"),
      expect.any(Error)
    );
  });

  it("catches a failure in the outer pipeline", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.ensureVenuesExist.mockRejectedValue(new Error("db gone"));

    await expect(runFeedIngest()).resolves.toBeUndefined();

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Feed ingest failed"),
      expect.any(Error)
    );
  });

  it("keeps the tick alive when cleanup throws", async () => {
    const { runFeedIngest } = await loadRun();
    failVacuum = true;

    await expect(runFeedIngest()).resolves.toBeUndefined();

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("Cleanup failed"),
      expect.any(Error)
    );
    expect(loggedText()).toContain("Feed ingest completed successfully");
  });
});

describe("runFeedIngest – confirm-on-notify", () => {
  it("confirms watched feed flips before notifying", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "on" });
    const raw = [change()];
    const kept = [change({ court: "Court 2" })];
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: raw }) as never);
    m.confirmFeedChanges.mockResolvedValue(
      confirmSummary({ input: 1, toConfirm: 1, scrapedVenueDays: 1, changes: kept }) as never
    );

    await runFeedIngest();

    expect(m.confirmFeedChanges).toHaveBeenCalledWith(raw, { persist: true });
    expect(m.notifyUsers).toHaveBeenCalledWith([expect.objectContaining({ court: "Court 2" })]);
  });

  it("defaults to enabled when the flag is unset", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: undefined });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change()] }) as never);

    await runFeedIngest();

    expect(m.confirmFeedChanges).toHaveBeenCalledOnce();
  });

  it.each(["off", "false", "0", "OFF"])("treats CONFIRM_ON_NOTIFY=%s as disabled", async (v) => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: v });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change()] }) as never);

    await runFeedIngest();

    expect(m.confirmFeedChanges).not.toHaveBeenCalled();
    expect(m.notifyUsers).toHaveBeenCalledOnce();
  });

  it("is not called when the feed produced no flips", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "on" });

    await runFeedIngest();

    expect(m.confirmFeedChanges).not.toHaveBeenCalled();
  });

  it("falls back to the unconfirmed changes when confirmation throws", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "on" });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change()] }) as never);
    m.confirmFeedChanges.mockRejectedValue(new Error("scrape blew up"));

    await runFeedIngest();

    // Dropping the tick's transitions here would silently lose notifications.
    expect(m.notifyUsers).toHaveBeenCalledWith([
      expect.objectContaining({ venue: "victoria-park" }),
    ]);
  });

  it("logs the confirm outcome only when something was checked", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "on" });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change()] }) as never);
    m.confirmFeedChanges.mockResolvedValue(
      confirmSummary({
        toConfirm: 2,
        scrapedVenueDays: 1,
        suppressed: 1,
        discovered: 1,
        changes: [change()],
        errors: [{ venueSlug: "victoria-park", date: "2026-08-12", error: "Bot challenge" }],
      }) as never
    );

    await runFeedIngest();

    expect(loggedText()).toContain("confirm-on-notify");
    expect(loggedText()).toContain("1 suppressed");
    expect(warnedText()).toContain("1× Bot challenge");
  });

  it("stays quiet when there was nothing to confirm", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "on" });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change()] }) as never);
    m.confirmFeedChanges.mockResolvedValue(
      confirmSummary({ toConfirm: 0, changes: [change()] }) as never
    );

    await runFeedIngest();

    expect(loggedText()).not.toContain("confirm-on-notify");
  });
});

describe("runFeedIngest – notification union", () => {
  it("unions transitions from every clock into a single notify call", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "off" });
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: [change({ court: "feed" })] }) as never);
    m.pollClubSpark.mockResolvedValue(
      clubsparkSummary({ changes: [change({ court: "clubspark" })] }) as never
    );
    m.fullSweep.mockResolvedValue(sweepSummary({ changes: [change({ court: "sweep" })] }) as never);

    await runFeedIngest();

    expect(m.notifyUsers).toHaveBeenCalledOnce();
    const courts = (m.notifyUsers.mock.calls[0][0] as Change[]).map((c) => c.court);
    expect(courts).toEqual(["feed", "clubspark", "sweep"]);
  });

  it("does not notify when nothing changed", async () => {
    const { runFeedIngest, m } = await loadRun();

    await runFeedIngest();

    expect(m.notifyUsers).not.toHaveBeenCalled();
  });
});

describe("runFeedIngest – self-heal hook", () => {
  it("declines to re-ingest when facilities were already refreshed this tick", async () => {
    const { runFeedIngest, m } = await loadRun();
    let healed: boolean | undefined;
    m.pollSlots.mockImplementation((async (o: { healUnmapped: () => Promise<boolean> }) => {
      healed = await o.healUnmapped();
      return slotsSummary();
    }) as never);

    await runFeedIngest(); // all clocks due → facility ingest already ran

    expect(healed).toBe(false);
    expect(m.ingestFacilities).toHaveBeenCalledOnce(); // not a second walk
    expect(loggedText()).toContain("already re-ingested this tick");
  });

  it("declines when the heal clock is throttled", async () => {
    const { runFeedIngest, m } = await loadRun();
    allClocksThrottled(); // facility refresh skipped AND heal clock recently run
    let healed: boolean | undefined;
    m.pollSlots.mockImplementation((async (o: { healUnmapped: () => Promise<boolean> }) => {
      healed = await o.healUnmapped();
      return slotsSummary();
    }) as never);

    await runFeedIngest();

    expect(healed).toBe(false);
    expect(m.ingestFacilities).not.toHaveBeenCalled();
    expect(loggedText()).toContain("self-heal throttled");
  });

  it("re-ingests and stamps the heal clock when stale and not throttled", async () => {
    // Facility feed stale (so the refresh is skipped) but the heal clock has
    // never run: FACILITY_REFRESH_HOURS=0 makes the refresh due, so instead we
    // drive the other side — refresh throttled, heal due.
    const { runFeedIngest, m } = await loadRun({ FACILITY_HEAL_MIN_MINUTES: "0" });
    allClocksThrottled();
    let healed: boolean | undefined;
    m.pollSlots.mockImplementation((async (o: { healUnmapped: () => Promise<boolean> }) => {
      healed = await o.healUnmapped();
      return slotsSummary();
    }) as never);

    await runFeedIngest();

    expect(healed).toBe(true);
    expect(m.ingestFacilities).toHaveBeenCalledOnce();
    expect(m.upsertFeedState.mock.calls.map(([, f]) => f)).toContain("facility-heal");
  });

  it("reports a failed heal as unhealed", async () => {
    const { runFeedIngest, m } = await loadRun({ FACILITY_HEAL_MIN_MINUTES: "0" });
    allClocksThrottled();
    m.ingestFacilities.mockRejectedValue(new Error("feed down"));
    let healed: boolean | undefined;
    m.pollSlots.mockImplementation((async (o: { healUnmapped: () => Promise<boolean> }) => {
      healed = await o.healUnmapped();
      return slotsSummary();
    }) as never);

    await runFeedIngest();

    expect(healed).toBe(false);
    expect(m.upsertFeedState.mock.calls.map(([, f]) => f)).not.toContain("facility-heal");
  });
});

describe("runFeedIngest – logging", () => {
  it("labels an initial backfill so a zero-transition tick is not mistaken for a bug", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockResolvedValue(slotsSummary({ startedFromHead: false }) as never);

    await runFeedIngest();

    expect(loggedText()).toContain("INITIAL BACKFILL");
  });

  it("labels a head poll as a delta", async () => {
    const { runFeedIngest } = await loadRun();

    await runFeedIngest();

    expect(loggedText()).toContain("delta from head");
  });

  it("breaks down unresolved slots and warns on a genuine seeding gap", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockResolvedValue(
      slotsSummary({
        unresolved: 5,
        healed: true,
        unresolvedBy: { foreign: 3, unmappedCourt: 2, excludedNonTennis: 0, noTime: 0, badData: 0 },
      }) as never
    );

    await runFeedIngest();

    expect(loggedText()).toContain("3 foreign");
    expect(warnedText()).toContain("belonged to a venue we track");
    expect(warnedText()).toContain("facility feed likely never lists");
  });

  it("distinguishes an un-healed gap from a healed one", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockResolvedValue(
      slotsSummary({
        unresolved: 1,
        healed: false,
        unresolvedBy: { foreign: 0, unmappedCourt: 1, excludedNonTennis: 0, noTime: 0, badData: 0 },
      }) as never
    );

    await runFeedIngest();

    expect(warnedText()).toContain("no re-ingest ran this tick");
  });

  it("does not warn when every unresolved slot is foreign", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockResolvedValue(
      slotsSummary({
        unresolved: 4,
        unresolvedBy: { foreign: 4, unmappedCourt: 0, excludedNonTennis: 0, noTime: 0, badData: 0 },
      }) as never
    );

    await runFeedIngest();

    expect(warnedText()).not.toContain("belonged to a venue we track");
  });

  it("reports self-healed slots", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockResolvedValue(slotsSummary({ healedResolved: 4 }) as never);

    await runFeedIngest();

    expect(loggedText()).toContain("mapped 4 previously-unmapped slot(s)");
  });

  it("lists per-venue counts sorted by volume", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.pollSlots.mockResolvedValue(
      slotsSummary({ byVenue: { "victoria-park": 5, "ropemakers-field": 9 } }) as never
    );

    await runFeedIngest();

    expect(loggedText()).toContain("ropemakers-field=9, victoria-park=5");
  });

  it("caps per-transition logging and summarises the remainder", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "off" });
    const many = Array.from({ length: 30 }, (_, i) => change({ court: `Court ${i}` }));
    m.pollSlots.mockResolvedValue(slotsSummary({ changes: many }) as never);

    await runFeedIngest();

    expect(loggedText()).toContain("and 5 more Clock 1 transition(s)");
  });

  it("prints a price on a transition that carries one", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "off" });
    m.pollSlots.mockResolvedValue(
      slotsSummary({ changes: [change({ price: "£6.00" })] }) as never
    );

    await runFeedIngest();

    expect(loggedText()).toContain("£6.00");
  });

  it("renders a null prior status as ∅", async () => {
    const { runFeedIngest, m } = await loadRun({ CONFIRM_ON_NOTIFY: "off" });
    m.pollSlots.mockResolvedValue(
      slotsSummary({ changes: [change({ oldStatus: null })] }) as never
    );

    await runFeedIngest();

    expect(loggedText()).toContain("∅ → available");
  });

  it("rolls repeated clock errors up into one line", async () => {
    const { runFeedIngest, m } = await loadRun();
    m.fullSweep.mockResolvedValue(
      sweepSummary({
        errors: [
          { venueSlug: "a", date: "2026-08-12", error: "Bot challenge" },
          { venueSlug: "b", date: "2026-08-12", error: "Bot challenge" },
          { venueSlug: "c", date: "2026-08-12", error: "HTTP 502" },
        ],
      }) as never
    );

    await runFeedIngest();

    expect(warnedText()).toContain("2× Bot challenge");
    expect(warnedText()).toContain("1× HTTP 502");
  });

  it("stays silent about errors when a clock had none", async () => {
    const { runFeedIngest } = await loadRun();

    await runFeedIngest();

    expect(warnedText()).not.toContain("errors (");
  });
});

describe("runFeedIngest – cleanup", () => {
  it("runs retention and VACUUM when the cleanup clock is due", async () => {
    const { runFeedIngest } = await loadRun();

    await runFeedIngest();

    expect(loggedText()).toContain("Running cleanup...");
    expect(loggedText()).toContain("Database vacuumed");
    expect(vacuumed).toEqual(["VACUUM"]);
  });

  it("honours CLEANUP_DAYS when computing the cutoff", async () => {
    const { runFeedIngest } = await loadRun({ CLEANUP_DAYS: "3" });

    await runFeedIngest();

    const expected = new Date();
    expected.setDate(expected.getDate() - 3);
    expect(loggedText()).toContain(expected.toISOString().split("T")[0]);
  });

  it("is skipped when the cleanup clock is not due", async () => {
    const { runFeedIngest } = await loadRun();
    allClocksThrottled();

    await runFeedIngest();

    expect(loggedText()).not.toContain("Running cleanup...");
    expect(vacuumed).toHaveLength(0);
  });
});
