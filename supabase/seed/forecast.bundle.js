// src/lib/dates/index.ts
const IST_OFFSET_MS = 198e5;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var DateError = class extends Error {
	code = "INVALID_DATE";
	constructor(message) {
		super(message);
		this.name = "DateError";
	}
};
function toUtcMs(date) {
	const m = DATE_RE.exec(date);
	if (!m) throw new DateError(`Not a YYYY-MM-DD date: "${date}"`);
	const [y, mo, d] = [
		Number(m[1]),
		Number(m[2]),
		Number(m[3])
	];
	const ms = Date.UTC(y, mo - 1, d);
	const check = new Date(ms);
	if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new DateError(`Not a real calendar date: "${date}"`);
	return ms;
}
/** The IST calendar date of an instant. */
function istDateOf(instant) {
	return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
/** Whole IST days from `from` to `to` (negative when `to` is earlier). */
function daysBetween(from, to) {
	const a = typeof from === "string" ? from : istDateOf(from);
	const b = typeof to === "string" ? to : istDateOf(to);
	return Math.round((toUtcMs(b) - toUtcMs(a)) / 864e5);
}
function addDays(date, days) {
	return new Date(toUtcMs(date) + days * 864e5).toISOString().slice(0, 10);
}

// src/lib/forecast/config.ts
/**
* Forecast and solver settings. All tunable numbers live here, not in code.
* Rates are assumptions to check with your bank / TReDS platform before acting on them.
*/
const FORECAST_CONFIG = {
	runs: 2e3,
	weeks: 13,
	/** Fixed seed: the same inputs always give the same forecast. */
	seed: 20261024,
	/** Shrinkage: weight on a customer's own history is n / (n + k). */
	shrinkK: 5,
	/** Fewer paid invoices than this and the customer is flagged low confidence. */
	lowConfidenceBelow: 4,
	/** Grade by the shrunk P80 days late: A up to this many, B up to the next, otherwise C. */
	gradeA_p80: 14,
	gradeB_p80: 30,
	/** Used when there is no payment history at all (days late). */
	priorDelays: [
		0,
		5,
		10,
		15,
		25
	],
	/** Chance a promise to pay is kept (arrives on the promised date, within 2 days). */
	promiseKeptProb: .65,
	/** Remaining wait is multiplied by this once a reminder stage has been sent. */
	stageFactor: {
		pre_due: 1,
		due_today: 1,
		overdue_firm: .9,
		final: .8,
		demand_letter: .65,
		next_steps: .6
	},
	/** If we chase now, the remaining wait is multiplied by this. */
	chaseFactor: .5,
	/** Extra days when a disputed invoice is included in the forecast. */
	disputeExtraDays: 30,
	/** Probability an invoice is never collected, by days overdue (first row whose max is >= days). */
	badDebt: [
		{
			maxDays: 60,
			prob: 0
		},
		{
			maxDays: 90,
			prob: .05
		},
		{
			maxDays: 180,
			prob: .15
		},
		{
			maxDays: 1e5,
			prob: .3
		}
	],
	/** Early-payment discount offered to speed up payment. */
	earlyDiscountPct: 2,
	/** Chance a customer takes the early-payment offer and pays within the week. */
	earlyDiscountTakeUp: .6,
	/** TReDS: annual discount rate. Only company and government buyers. */
	tredsAnnualRatePct: 12,
	tredsBuyers: ["company", "government"],
	/** Deferring a supplier bill costs this much per month of delay (late fee or interest). */
	deferFeePctPerMonth: 1.5,
	/** Backtest. */
	backtestWeeks: 8,
	/** Chase score weights by reliability grade (reliable payers respond to a nudge). */
	gradeWeight: {
		A: 1,
		B: .85,
		C: .65
	},
	/** Week used as the target for chase scores when no shortfall is forecast. */
	noShortfallTargetWeek: 4
};

// src/lib/forecast/stats.ts
/** Seeded RNG (mulberry32): same seed, same sequence, on every machine. */
function makeRng(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function mean(xs) {
	return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
/** Linear-interpolated quantile of an unsorted list, p in [0, 1]. */
function quantile(xs, p) {
	if (!xs.length) return 0;
	return quantileSorted([...xs].sort((a, b) => a - b), p);
}
function quantileSorted(s, p) {
	if (!s.length) return 0;
	const pos = Math.min(1, Math.max(0, p)) * (s.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const median = (xs) => quantile(xs, .5);

// src/lib/forecast/delay.ts
/** The date an invoice was fully paid as of `asOf`, or null if it was still open then. */
function settledOn(inv, asOf) {
	const events = [...inv.events].filter((e) => !asOf || e.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
	let paid = 0;
	for (const e of events) {
		paid += e.amountPaise;
		if (paid >= inv.totalPaise) return e.date;
	}
	if (inv.closedOn && (!asOf || inv.closedOn <= asOf)) return inv.closedOn;
	return null;
}
/** Balance left on an invoice as of a date (payments only). */
function balanceAsOf(inv, asOf) {
	if (inv.closedOn && inv.closedOn <= asOf) return 0;
	const paid = inv.events.filter((e) => e.date <= asOf).reduce((s, e) => s + e.amountPaise, 0);
	return Math.max(inv.totalPaise - paid, 0);
}
/** Days late for each paid invoice, per customer, using only what was known at `asOf`. */
function delaySamples(history, asOf) {
	const out = /* @__PURE__ */ new Map();
	for (const inv of history) {
		const s = settledOn(inv, asOf);
		if (!s) continue;
		const list = out.get(inv.customerId) ?? [];
		list.push(daysBetween(inv.dueDate, s));
		out.set(inv.customerId, list);
	}
	return out;
}
function statsOf(samples) {
	return {
		n: samples.length,
		mean: mean(samples),
		median: median(samples),
		p80: quantile(samples, .8)
	};
}
const round1 = (x) => Math.round(x * 10) / 10;
function gradeOf(p80) {
	if (p80 <= FORECAST_CONFIG.gradeA_p80) return "A";
	if (p80 <= FORECAST_CONFIG.gradeB_p80) return "B";
	return "C";
}
function days(n) {
	const r = Math.round(n);
	if (r === 0) return "on the due date";
	if (r < 0) return `${-r} day${-r === 1 ? "" : "s"} early`;
	return `${r} day${r === 1 ? "" : "s"} late`;
}
function describeDelay(c) {
	if (c.n === 0) return "No payment history yet, so this uses your overall average. Treated as low confidence.";
	const base = `Usually pays ${days(c.median)}; 8 in 10 invoices are paid within ${Math.round(c.p80)} days of the due date. Based on ${c.n} paid invoice${c.n === 1 ? "" : "s"}.`;
	const g = c.grade === "A" ? " Grade A: reliable." : c.grade === "B" ? " Grade B: often a little slow." : " Grade C: pays late, plan for it.";
	const low = c.lowConfidence ? ` Only ${c.n} invoice${c.n === 1 ? "" : "s"} so far, so the estimate leans on your overall average.` : "";
	return base + g + low;
}
/**
* Per-customer delay statistics, shrunk toward the overall distribution:
* stat = w * own + (1 - w) * overall, with w = n / (n + k). A customer with no history gets the
* overall numbers. The same weight is used when sampling (see arrival atoms in simulate.ts).
*/
function buildDelayModels(samplesByCustomer, k = FORECAST_CONFIG.shrinkK) {
	const pooled = [...samplesByCustomer.values()].flat();
	const fromPrior = pooled.length === 0;
	const overallSamples = fromPrior ? [...FORECAST_CONFIG.priorDelays] : pooled;
	const overall = {
		...statsOf(overallSamples),
		samples: overallSamples,
		fromPrior
	};
	const byCustomer = /* @__PURE__ */ new Map();
	for (const [customerId, samples] of samplesByCustomer) byCustomer.set(customerId, customerDelay(customerId, samples, overall, k));
	return {
		overall,
		byCustomer,
		k
	};
}
function customerDelay(customerId, samples, overall, k = FORECAST_CONFIG.shrinkK) {
	const own = statsOf(samples);
	const n = samples.length;
	const weight = n / (n + k);
	const shrunk = {
		mean: weight * own.mean + (1 - weight) * overall.mean,
		median: weight * own.median + (1 - weight) * overall.median,
		p80: weight * own.p80 + (1 - weight) * overall.p80
	};
	const partial = {
		customerId,
		samples,
		n,
		own,
		weight,
		mean: round1(shrunk.mean),
		median: round1(shrunk.median),
		p80: round1(shrunk.p80),
		lowConfidence: n < FORECAST_CONFIG.lowConfidenceBelow,
		grade: gradeOf(shrunk.p80)
	};
	return {
		...partial,
		reason: describeDelay(partial)
	};
}
/** Model for a customer; a customer with no history gets the overall numbers, low confidence. */
function modelFor(models, customerId) {
	return models.byCustomer.get(customerId) ?? customerDelay(customerId, [], models.overall, models.k);
}

// src/lib/forecast/arrival.ts
function badDebtProb(daysOverdue) {
	for (const row of FORECAST_CONFIG.badDebt) if (daysOverdue <= row.maxDays) return row.prob;
	return 0;
}
/**
* The distribution of when an open invoice will be paid, as weighted atoms. Weights sum to at most 1;
* the rest is the chance it is never collected (or excluded, for disputed invoices).
*
* - Delay samples: the customer's own with weight w = n / (n + k), the overall pool with 1 - w.
* - The invoice is still unpaid, so arrival cannot be before today: samples that would put it earlier are dropped
*   and the rest renormalised.
* - An active promise: with probability promiseKeptProb it arrives on the promised date (+0..2 days).
* - Reminder stage sent: the remaining wait is scaled by the stage factor; chasing scales it again.
* - Overdue invoices carry a bad-debt chance. Disputed invoices are excluded unless asked for.
*/
function arrivalAtoms(inv, today, models, opts = {}) {
	if (inv.disputed && !opts.includeDisputed) return [];
	if (inv.balancePaise <= 0) return [];
	const cfg = FORECAST_CONFIG;
	const toDue = daysBetween(today, inv.dueDate);
	const alive = 1 - badDebtProb(Math.max(0, -toDue));
	const extra = (inv.disputed ? cfg.disputeExtraDays : 0) + (inv.extraDelayDays ?? 0);
	const factor = (cfg.stageFactor[inv.stage ?? ""] ?? 1) * (opts.chase ?? 1);
	const atoms = [];
	let rest = 1;
	if (inv.promisedFor) {
		const p = Math.max(0, daysBetween(today, inv.promisedFor)) + (inv.extraDelayDays ?? 0);
		const kept = cfg.promiseKeptProb;
		for (const add of [
			0,
			1,
			2
		]) atoms.push({
			offset: p + add,
			weight: kept / 3 * alive
		});
		rest = 1 - kept;
	}
	const model = modelFor(models, inv.customerId);
	const w = model.n / (model.n + models.k);
	const pool = [];
	for (const d of model.samples) pool.push({
		delay: d,
		weight: w / Math.max(model.n, 1)
	});
	for (const d of models.overall.samples) pool.push({
		delay: d,
		weight: (1 - w) / models.overall.samples.length
	});
	const minOffset = inv.promisedFor ? Math.max(0, daysBetween(today, inv.promisedFor)) : 0;
	const feasible = pool.filter((s) => toDue + s.delay >= minOffset);
	const total = feasible.reduce((s, x) => s + x.weight, 0);
	if (total > 0) for (const s of feasible) {
		const wait = toDue + s.delay;
		atoms.push({
			offset: Math.max(0, Math.round(wait * factor)) + extra,
			weight: s.weight / total * rest * alive
		});
	}
	else for (let d = 3; d <= 30; d++) atoms.push({
		offset: Math.round(d * factor) + extra,
		weight: rest / 28 * alive
	});
	return atoms;
}
/** Probability the invoice has been paid by `offset` days from today (inclusive). */
function probPaidBy(atoms, offset) {
	let p = 0;
	for (const a of atoms) if (a.offset <= offset) p += a.weight;
	return Math.min(1, p);
}
/** Expected rupees (paise) the invoice brings in by `offset` days from today. */
function expectedBy(inv, atoms, offset) {
	return Math.round(inv.balancePaise * probPaidBy(atoms, offset));
}
function sampler(atoms) {
	const sorted = [...atoms].sort((a, b) => a.offset - b.offset);
	const offsets = [];
	const cumulative = [];
	let c = 0;
	for (const a of sorted) {
		c += a.weight;
		offsets.push(a.offset);
		cumulative.push(c);
	}
	return {
		offsets,
		cumulative
	};
}
/** Draws an arrival offset, or null when the draw falls in the "never collected" mass. */
function draw(s, u) {
	const n = s.cumulative.length;
	if (!n || u >= s.cumulative[n - 1]) return null;
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = lo + hi >> 1;
		if (s.cumulative[mid] > u) hi = mid;
		else lo = mid + 1;
	}
	return s.offsets[lo];
}

// src/lib/money/errors.ts
var MoneyError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "MoneyError";
		this.code = code;
	}
};

// src/lib/money/paise.ts
function paise(n) {
	if (!Number.isSafeInteger(n)) throw new MoneyError("NOT_SAFE_INTEGER", `Paise must be a safe integer, got ${n}`);
	return n;
}
/** Indian digit grouping (1,18,000) without Intl: some runtimes (edge functions) ship without en-IN data. */
function groupIndian(n) {
	const s = String(Math.trunc(n));
	if (s.length <= 3) return s;
	return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}`;
}
const inr = { format: groupIndian };
function split(p) {
	const abs = Math.abs(p);
	return {
		sign: p < 0 ? "-" : "",
		rupees: Math.floor(abs / 100),
		rem: abs % 100
	};
}
/** Documents: always 2 decimals, e.g. ₹1,18,000.00 */
function formatINR(p) {
	const { sign, rupees, rem } = split(p);
	return `${sign}₹${inr.format(rupees)}.${String(rem).padStart(2, "0")}`;
}

// src/lib/forecast/simulate.ts
function q(values) {
	const s = [...values].sort((a, b) => a - b);
	return {
		p10: Math.round(quantileSorted(s, .1)),
		p50: Math.round(quantileSorted(s, .5)),
		p90: Math.round(quantileSorted(s, .9))
	};
}
/**
* 13-week Monte Carlo cash forecast. Each run draws an arrival day for every open invoice (due date +
* sampled delay, see arrivalAtoms) and applies the known outflows. Per run and week:
* closing = opening + inflow - outflow, and next week's opening is this week's closing.
* Deterministic for a given input and seed.
*/
function simulate(input) {
	const runs = input.runs ?? FORECAST_CONFIG.runs;
	const weeks = input.weeks ?? FORECAST_CONFIG.weeks;
	const rng = makeRng(input.seed ?? FORECAST_CONFIG.seed);
	const { today } = input;
	const horizon = weeks * 7;
	const outByWeek = new Array(weeks).fill(0);
	let outflowTotal = 0;
	for (const o of input.occurrences) {
		const off = daysBetween(today, o.date);
		if (off < 0 || off >= horizon) continue;
		outByWeek[Math.floor(off / 7)] += o.amountPaise;
		outflowTotal += o.amountPaise;
	}
	const samplers = input.invoices.map((inv) => ({
		inv,
		s: sampler(arrivalAtoms(inv, today, input.models, { includeDisputed: input.includeDisputed }))
	}));
	const simulatedBalance = samplers.reduce((s, x) => s + x.inv.balancePaise, 0);
	const paths = {
		opening: [],
		inflow: [],
		outflow: [],
		closing: []
	};
	for (let r = 0; r < runs; r++) {
		const inflow = new Array(weeks).fill(0);
		for (const { inv, s } of samplers) {
			const off = draw(s, rng());
			if (off === null || off >= horizon) continue;
			inflow[Math.floor(off / 7)] += inv.balancePaise;
		}
		const opening = [];
		const closing = [];
		let bal = input.openingBalancePaise;
		for (let w = 0; w < weeks; w++) {
			opening.push(bal);
			bal = bal + inflow[w] - outByWeek[w];
			closing.push(bal);
		}
		paths.opening.push(opening);
		paths.inflow.push(inflow);
		paths.outflow.push([...outByWeek]);
		paths.closing.push(closing);
	}
	const bands = [];
	for (let w = 0; w < weeks; w++) {
		const col = (a) => a.map((row) => row[w]);
		const closing = col(paths.closing);
		const inflow = col(paths.inflow);
		bands.push({
			week: w + 1,
			start: addDays(today, w * 7),
			end: addDays(today, w * 7 + 6),
			opening: q(col(paths.opening)),
			inflow: q(inflow),
			outflow: q(col(paths.outflow)),
			closing: q(closing),
			probBelowBuffer: closing.filter((c) => c < input.bufferPaise).length / runs,
			expectedInflow: Math.round(inflow.reduce((s, x) => s + x, 0) / runs)
		});
	}
	return {
		today,
		runs,
		bufferPaise: input.bufferPaise,
		weeks: bands,
		paths,
		outflowTotalPaise: outflowTotal,
		simulatedBalancePaise: simulatedBalance
	};
}
/** First week whose median closing balance is below the buffer, or null when cash stays safe. */
function firstShortfall(f) {
	return f.weeks.find((w) => w.closing.p50 < f.bufferPaise) ?? null;
}
/** Number of weeks from the start until the first shortfall (all weeks if none). */
function safeWeeks(f) {
	const s = firstShortfall(f);
	return s ? s.week - 1 : f.weeks.length;
}
/** The lowest median closing balance and the week it happens in. */
function lowestPoint(f) {
	let best = {
		week: 1,
		paise: Number.POSITIVE_INFINITY
	};
	for (const w of f.weeks) if (w.closing.p50 < best.paise) best = {
		week: w.week,
		paise: w.closing.p50
	};
	return best;
}

// src/lib/forecast/backtest.ts
/**
* Hide the last `weeksHidden` weeks of history, forecast weekly collections from what was known
* then (invoices open on that date, delay history up to that date), and compare with what really
* came in on those same invoices.
*/
function backtest(args) {
	const weeks = args.weeksHidden ?? FORECAST_CONFIG.backtestWeeks;
	const asOf = addDays(args.today, -7 * weeks);
	const start = addDays(asOf, 1);
	const open = [];
	const openIds = /* @__PURE__ */ new Set();
	for (const h of args.history) {
		if (h.issueDate > asOf) continue;
		const balance = balanceAsOf(h, asOf);
		if (balance <= 0) continue;
		open.push({
			id: h.id,
			customerId: h.customerId,
			dueDate: h.dueDate,
			balancePaise: balance
		});
		openIds.add(h.id);
	}
	const models = buildDelayModels(delaySamples(args.history, asOf));
	const rows = simulate({
		today: start,
		openingBalancePaise: 0,
		bufferPaise: 0,
		invoices: open,
		customers: args.customers,
		models,
		occurrences: [],
		weeks,
		runs: args.runs ?? 500,
		seed: args.seed
	}).weeks.map((w) => {
		let actual = 0;
		for (const h of args.history) {
			if (!openIds.has(h.id)) continue;
			for (const e of h.events) if (e.date >= w.start && e.date <= w.end) actual += e.amountPaise;
		}
		return {
			week: w.week,
			start: w.start,
			end: w.end,
			forecast: w.expectedInflow,
			p10: w.inflow.p10,
			p90: w.inflow.p90,
			actual
		};
	});
	const forecastTotal = rows.reduce((s, r) => s + r.forecast, 0);
	const actualTotal = rows.reduce((s, r) => s + r.actual, 0);
	const err = rows.reduce((s, r) => s + Math.abs(r.actual - r.forecast), 0);
	const wape = actualTotal > 0 ? err / actualTotal : null;
	let errM = 0;
	for (let i = 0; i < rows.length; i += 4) {
		const blk = rows.slice(i, i + 4);
		errM += Math.abs(blk.reduce((s, r) => s + r.actual - r.forecast, 0));
	}
	return {
		asOf,
		weeks: rows,
		forecastTotal,
		actualTotal,
		wape,
		wapeMonthly: actualTotal > 0 ? errM / actualTotal : null,
		sentence: sentence(weeks, wape, forecastTotal, actualTotal)
	};
}
function sentence(weeks, wape, forecast, actual) {
	if (wape === null) return `In the last ${weeks} weeks nothing came in on the invoices that were open then, so there is nothing to compare yet.`;
	const pct = Math.round(wape * 100);
	const bias = forecast > actual * 1.1 ? "a bit too optimistic" : forecast < actual * .9 ? "a bit too cautious" : "about right overall";
	return `Looking back ${weeks} weeks, the forecast was off by ${pct}% week by week (WAPE); it expected ${formatINR(paise(forecast))} and ${formatINR(paise(actual))} actually came in, so it was ${bias}.`;
}

// src/lib/forecast/expenses.ts
function daysInMonth(y, m) {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Adds whole months, keeping the anchor's day (clamped to month end, so the 31st becomes the 30th). */
function addMonthsKeepDay(anchor, months) {
	const y = Number(anchor.slice(0, 4));
	const m = Number(anchor.slice(5, 7));
	const d = Number(anchor.slice(8, 10));
	const total = y * 12 + (m - 1) + months;
	const ny = Math.floor(total / 12);
	const nm = total % 12 + 1;
	const nd = Math.min(d, daysInMonth(ny, nm));
	return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
/** Every date this expense falls due within [from, to], both inclusive. */
function expenseDates(e, from, to) {
	if (!e.active) return [];
	const end = e.endsOn && e.endsOn < to ? e.endsOn : to;
	if (!e.isRecurring || !e.recurrence) return e.expenseDate >= from && e.expenseDate <= end ? [e.expenseDate] : [];
	const anchor = e.nextDue ?? e.expenseDate;
	const out = [];
	if (e.recurrence === "weekly") {
		let d = anchor;
		while (d < from) d = addDays(d, 7);
		for (; d <= end; d = addDays(d, 7)) out.push(d);
		return out;
	}
	const step = e.recurrence === "monthly" ? 1 : e.recurrence === "quarterly" ? 3 : 12;
	for (let i = 0; i < 400; i++) {
		const d = addMonthsKeepDay(anchor, i * step);
		if (d > end) break;
		if (d >= from) out.push(d);
	}
	return out;
}
function occurrences(expenses, from, to) {
	const out = [];
	for (const e of expenses) for (const date of expenseDates(e, from, to)) out.push({
		expenseId: e.id,
		name: e.name,
		date,
		amountPaise: e.amountPaise,
		deferrable: e.deferrable
	});
	return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// src/lib/forecast/priority.ts
function lateText(median, n) {
	if (n === 0) return "no payment history yet";
	const r = Math.round(median);
	if (r === 0) return "usually pays on the due date";
	if (r < 0) return `usually pays ${-r} days early`;
	return `usually pays ${r} days late`;
}
/**
* Chase priority. score = expected rupees brought in by the end of the first shortfall week if the
* invoice is chased now (balance x P(paid by then | chased)), x (1 + days overdue / 120, capped at 2)
* x a reliability weight (A 1, B 0.85, C 0.65). With no shortfall, week 4 is the target.
*/
function chaseScores(args) {
	const { today, forecast, models } = args;
	const sf = firstShortfall(forecast);
	const week = sf ? sf.week : FORECAST_CONFIG.noShortfallTargetWeek;
	const gap = sf ? forecast.bufferPaise - sf.closing.p50 : 0;
	const deadline = week * 7 - 1;
	const names = new Map(args.customers.map((c) => [c.id, c.name]));
	const items = [];
	for (const inv of args.invoices) {
		if (inv.balancePaise <= 0) continue;
		const overdue = Math.max(0, daysBetween(inv.dueDate, today));
		const model = modelFor(models, inv.customerId);
		const base = probPaidBy(arrivalAtoms(inv, today, models), deadline);
		const chased = probPaidBy(arrivalAtoms(inv, today, models, { chase: FORECAST_CONFIG.chaseFactor }), deadline);
		const expected = inv.disputed ? 0 : Math.round(inv.balancePaise * chased);
		const score = expected * (1 + Math.min(overdue, 120) / 120) * (FORECAST_CONFIG.gradeWeight[model.grade] ?? 1);
		const parts = [
			formatINR(paise(inv.balancePaise)),
			overdue > 0 ? `${overdue} days overdue` : `due in ${Math.max(0, daysBetween(today, inv.dueDate))} days`,
			lateText(model.median, model.n)
		];
		if (inv.disputed) parts.push("in dispute, so it is not counted until resolved");
		else if (sf) parts.push(expected >= gap ? `covers the shortfall in week ${week}` : `covers ${gap > 0 ? Math.round(expected / gap * 100) : 0}% of the week ${week} shortfall`);
		else parts.push(`expected to bring in ${formatINR(paise(expected))} by week ${week}`);
		items.push({
			invoiceId: inv.id,
			customerId: inv.customerId,
			customerName: names.get(inv.customerId) ?? "Customer",
			balancePaise: inv.balancePaise,
			daysOverdue: overdue,
			expectedPaise: expected,
			probBase: base,
			probChased: chased,
			score,
			targetWeek: week,
			reason: parts.join(", ")
		});
	}
	return items.sort((a, b) => b.score - a.score || b.balancePaise - a.balancePaise || a.invoiceId.localeCompare(b.invoiceId));
}
/** Best score per customer, for ordering the Collect page. */
function scoreByCustomer(items) {
	const m = /* @__PURE__ */ new Map();
	for (const i of items) m.set(i.customerId, Math.max(m.get(i.customerId) ?? 0, i.score));
	return m;
}

// src/lib/forecast/solver.ts
const ratio = (c) => c.cover > 0 ? c.cost / c.cover : Number.POSITIVE_INFINITY;
/**
* Greedy: take actions by cost per rupee covered (free ones first, then larger cover), one per group,
* until the gap is covered; then drop any step that is no longer needed, most expensive first.
*/
function selectActions(candidates, gap) {
	if (gap <= 0) return [];
	const sorted = candidates.filter((c) => c.cover > 0).sort((a, b) => ratio(a) - ratio(b) || b.cover - a.cover || a.id.localeCompare(b.id));
	const used = /* @__PURE__ */ new Set();
	const chosen = [];
	let covered = 0;
	for (const c of sorted) {
		if (covered >= gap) break;
		if (used.has(c.group)) continue;
		used.add(c.group);
		chosen.push(c);
		covered += c.cover;
	}
	for (const c of [...chosen].sort((a, b) => ratio(b) - ratio(a) || b.cost - a.cost)) if (c.cost > 0 && covered - c.cover >= gap) {
		chosen.splice(chosen.indexOf(c), 1);
		covered -= c.cover;
	}
	return chosen;
}
/** Exhaustive minimum-cost selection, for tests on small inputs (up to about 16 candidates). */
function exactSelect(candidates, gap) {
	if (gap <= 0) return [];
	const list = candidates.filter((c) => c.cover > 0);
	let best = null;
	let bestCost = Number.POSITIVE_INFINITY;
	const n = list.length;
	for (let mask = 0; mask < 1 << n; mask++) {
		const groups = /* @__PURE__ */ new Set();
		let ok = true;
		let cover = 0;
		let cost = 0;
		const picked = [];
		for (let i = 0; i < n && ok; i++) {
			if (!(mask & 1 << i)) continue;
			const c = list[i];
			if (groups.has(c.group)) ok = false;
			groups.add(c.group);
			cover += c.cover;
			cost += c.cost;
			picked.push(c);
		}
		if (ok && cover >= gap && cost < bestCost) {
			best = picked;
			bestCost = cost;
		}
	}
	return best;
}
function totals(steps) {
	return {
		cover: steps.reduce((s, c) => s + c.cover, 0),
		cost: steps.reduce((s, c) => s + c.cost, 0)
	};
}
/**
* Cheapest set of actions to cover the first week below the safety buffer, measured at the median.
* Actions: chase an invoice (free; covers the extra probability of being paid in time), early-payment
* discount, TReDS (company and government buyers; cost = rate x days / 365), defer a deferrable bill.
* Only invoices not expected by then (P(paid by the end of the week) under 50%) are candidates.
*/
function solveGap(args) {
	const { today, forecast, models } = args;
	const sf = firstShortfall(forecast);
	if (!sf) return null;
	const cfg = FORECAST_CONFIG;
	const gap = forecast.bufferPaise - sf.closing.p50;
	const deadline = sf.week * 7 - 1;
	const custs = new Map(args.customers.map((c) => [c.id, c]));
	const cands = [];
	for (const inv of args.invoices) {
		if (inv.disputed || inv.balancePaise <= 0) continue;
		const c = custs.get(inv.customerId);
		const name = c?.name ?? "the customer";
		const label = inv.number ?? "the invoice";
		const baseAtoms = arrivalAtoms(inv, today, models);
		const pBase = probPaidBy(baseAtoms, deadline);
		if (pBase >= .5) continue;
		const overdue = Math.max(0, daysBetween(inv.dueDate, today));
		const money = (n) => formatINR(paise(Math.round(n)));
		const pChase = probPaidBy(arrivalAtoms(inv, today, models, { chase: cfg.chaseFactor }), deadline);
		const chaseCover = Math.round(inv.balancePaise * (pChase - pBase));
		if (chaseCover > 0) cands.push({
			id: `chase:${inv.id}`,
			group: inv.id,
			kind: "chase",
			cover: chaseCover,
			cost: 0,
			sentence: `Chase ${name} for ${label} (${money(inv.balancePaise)}${overdue ? `, ${overdue} days overdue` : ""}): free, expected to bring in about ${money(chaseCover)} in time.`
		});
		const discCover = Math.round(inv.balancePaise * (1 - pBase) * cfg.earlyDiscountTakeUp);
		cands.push({
			id: `discount:${inv.id}`,
			group: inv.id,
			kind: "discount",
			cover: discCover,
			cost: Math.round(discCover * cfg.earlyDiscountPct / 100),
			sentence: `Offer ${name} ${cfg.earlyDiscountPct}% off ${label} if they pay this week: costs about ${money(discCover * cfg.earlyDiscountPct / 100)} and brings in about ${money(discCover)}.`
		});
		if (c && cfg.tredsBuyers.includes(c.entityType ?? "")) {
			const median = quantile(baseAtoms.flatMap((a) => Array(Math.max(1, Math.round(a.weight * 100))).fill(a.offset)), .5);
			const days = Math.min(120, Math.max(1, Math.round(median)));
			const fee = Math.round(inv.balancePaise * cfg.tredsAnnualRatePct * days / 100 / 365);
			const cover = Math.round(inv.balancePaise * (1 - pBase)) - fee;
			if (cover > 0) cands.push({
				id: `treds:${inv.id}`,
				group: inv.id,
				kind: "treds",
				cover,
				cost: fee,
				sentence: `Sell ${label} (${name}) on TReDS: costs about ${money(fee)} (${cfg.tredsAnnualRatePct}% a year for about ${days} days) and brings in ${money(inv.balancePaise - fee)} now.`
			});
		}
	}
	const weekEnd = addDays(today, deadline);
	const nextWeek = addDays(weekEnd, 1);
	for (const o of args.occurrences) {
		if (!o.deferrable || o.date > weekEnd || o.date < today) continue;
		const days = Math.max(1, daysBetween(o.date, nextWeek));
		const fee = Math.round(o.amountPaise * cfg.deferFeePctPerMonth * days / 100 / 30);
		cands.push({
			id: `defer:${o.expenseId}:${o.date}`,
			group: `bill:${o.expenseId}:${o.date}`,
			kind: "defer",
			cover: o.amountPaise,
			cost: fee,
			sentence: `Ask to pay ${o.name} (${formatINR(paise(o.amountPaise))}, due ${o.date}) after ${weekEnd}: costs about ${formatINR(paise(fee))} in late charges and keeps the cash in the bank this week.`
		});
	}
	const steps = selectActions(cands, gap).sort((a, b) => ratio(a) - ratio(b) || b.cover - a.cover);
	const { cover, cost } = totals(steps);
	const feasible = cover >= gap;
	const lead = `Week ${sf.week} (${sf.start} to ${sf.end}) is expected to end ${formatINR(paise(gap))} below your ${formatINR(paise(forecast.bufferPaise))} safety buffer.`;
	const summary = steps.length ? feasible ? `${lead} These steps cover it for about ${formatINR(paise(cost))} in total.` : `${lead} Even all the steps available cover only ${formatINR(paise(cover))}, so ${formatINR(paise(gap - cover))} is still short.` : `${lead} There is nothing here that can close the gap in time.`;
	return {
		week: sf.week,
		start: sf.start,
		end: sf.end,
		bufferPaise: forecast.bufferPaise,
		closingP50: sf.closing.p50,
		gapPaise: gap,
		steps,
		coveredPaise: cover,
		totalCostPaise: cost,
		feasible,
		summary
	};
}

// src/lib/forecast/tiles.ts
function ageing(invoices, today) {
	const b = {
		notDue: 0,
		d1_30: 0,
		d31_60: 0,
		d61_90: 0,
		d90plus: 0
	};
	for (const i of invoices) {
		const late = daysBetween(i.dueDate, today);
		if (late <= 0) b.notDue += i.balancePaise;
		else if (late <= 30) b.d1_30 += i.balancePaise;
		else if (late <= 60) b.d31_60 += i.balancePaise;
		else if (late <= 90) b.d61_90 += i.balancePaise;
		else b.d90plus += i.balancePaise;
	}
	return b;
}
function dashboardTiles(args) {
	const { today, invoices } = args;
	let week = 0;
	let month = 0;
	for (const i of invoices) {
		const atoms = arrivalAtoms(i, today, args.models);
		week += expectedBy(i, atoms, 6);
		month += expectedBy(i, atoms, 29);
	}
	const low = lowestPoint(args.forecast);
	return {
		toCollectPaise: invoices.reduce((s, i) => s + i.balancePaise, 0),
		overduePaise: invoices.filter((i) => daysBetween(i.dueDate, today) > 0).reduce((s, i) => s + i.balancePaise, 0),
		expectedThisWeekPaise: week,
		expectedThisMonthPaise: month,
		billsDue30Paise: args.occurrences.filter((o) => {
			const d = daysBetween(today, o.date);
			return d >= 0 && d < 30;
		}).reduce((s, o) => s + o.amountPaise, 0),
		bankBalancePaise: args.bankBalancePaise,
		lowestPaise: low.paise,
		lowestWeek: low.week,
		safeWeeks: safeWeeks(args.forecast),
		ageing: ageing(invoices, today)
	};
}

// src/lib/forecast/whatif.ts
/** Returns a modified copy of the input; the original is never changed. */
function applyWhatIf(input, w) {
	switch (w.kind) {
		case "payLater": {
			const invoices = input.invoices.map((i) => i.customerId === w.customerId ? {
				...i,
				extraDelayDays: (i.extraDelayDays ?? 0) + w.days
			} : i);
			return {
				...input,
				invoices
			};
		}
		case "newOrder": {
			const cust = input.customers.find((c) => c.id === w.customerId);
			const credit = w.creditDays ?? cust?.creditDays ?? 30;
			const inv = {
				id: `whatif-order-${w.customerId}-${w.date}`,
				customerId: w.customerId,
				dueDate: addDays(w.date, credit),
				balancePaise: Math.round(w.amountPaise)
			};
			return {
				...input,
				invoices: [...input.invoices, inv]
			};
		}
		case "moveBill": {
			const occurrences = input.occurrences.map((o) => o.expenseId === w.expenseId && (!w.date || o.date === w.date) ? {
				...o,
				date: addDays(o.date, w.days)
			} : o);
			return {
				...input,
				occurrences
			};
		}
	}
}
function runWhatIf(input, w) {
	return simulate(applyWhatIf(input, w));
}
function describeWhatIf(w, names) {
	switch (w.kind) {
		case "payLater": return `${names.customer ?? "This customer"} pays ${w.days} day${w.days === 1 ? "" : "s"} later than usual`;
		case "newOrder": return `A new order from ${names.customer ?? "a customer"} on ${w.date}`;
		case "moveBill": return `${names.bill ?? "This bill"} moves ${w.days >= 0 ? "later" : "earlier"} by ${Math.abs(w.days)} day${Math.abs(w.days) === 1 ? "" : "s"}`;
	}
}

export { FORECAST_CONFIG, ageing, applyWhatIf, arrivalAtoms, backtest, badDebtProb, balanceAsOf, buildDelayModels, chaseScores, customerDelay, dashboardTiles, delaySamples, describeDelay, describeWhatIf, draw, exactSelect, expectedBy, expenseDates, firstShortfall, gradeOf, lowestPoint, makeRng, mean, median, modelFor, occurrences, probPaidBy, quantile, quantileSorted, runWhatIf, safeWeeks, sampler, scoreByCustomer, selectActions, settledOn, simulate, solveGap, statsOf, totals };