import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChartData } from "../../forge_modules/views/chart/types.ts";
import { viewResult, withViews } from "../../forge_modules/views/registry.ts";
import { amortize, fmtDuration, fmtMoney, type LoanInput } from "../lib/loan.ts";

const loanFields = {
	principal: Type.Number({ description: "Amount borrowed (> 0)" }),
	annual_rate_pct: Type.Number({ description: "Nominal annual interest rate in percent, e.g. 6.5 for 6.5%" }),
	years: Type.Number({ description: "Loan term in years, e.g. 30" }),
	extra_monthly: Type.Optional(Type.Number({ description: "Extra amount paid every month on top of the payment. Default 0" })),
};

interface LoanParams {
	principal: number;
	annual_rate_pct: number;
	years: number;
	extra_monthly?: number;
}

const toInput = (p: LoanParams): LoanInput => ({
	principal: p.principal,
	annualRatePct: p.annual_rate_pct,
	years: p.years,
	extraMonthly: p.extra_monthly,
});

/** Balance at the end of each year, index 0 = start. */
function yearlyBalances(balances: number[], years: number): (number | null)[] {
	const out: (number | null)[] = [];
	for (let y = 0; y <= years; y++) {
		const m = y * 12;
		out.push(m < balances.length ? Math.round(balances[m] * 100) / 100 : 0); // 0 once paid off
	}
	return out;
}

const loanSchedule = defineTool({
	name: "loan_schedule",
	label: "Loan schedule",
	description:
		"Amortization for one fixed-rate loan: monthly payment, total interest, payoff time, yearly interest/principal breakdown and the balance curve. Supports extra monthly payments. Shows the user a balance chart.",
	parameters: Type.Object(loanFields),
	annotations: { readOnlyHint: true },
	async execute(_id, params) {
		const input = toInput(params);
		const r = amortize(input);
		const years = Math.ceil(input.years);
		const chart: ChartData = {
			title: `Balance: ${fmtMoney(input.principal)} at ${input.annualRatePct}% over ${input.years}y${input.extraMonthly ? ` (+${fmtMoney(input.extraMonthly)}/mo)` : ""}`,
			kind: "line",
			labels: Array.from({ length: years + 1 }, (_, i) => `Y${i}`),
			series: [{ name: "Balance", values: yearlyBalances(r.balances, years) }],
		};
		const yearlyLines = r.yearly
			.map((y, i) => `Y${i + 1}: interest ${fmtMoney(y.interest)}, principal ${fmtMoney(y.principal)}, end balance ${fmtMoney(y.endBalance)}`)
			.join("\n");
		const text = [
			`Monthly payment: ${fmtMoney(r.monthlyPayment)}${input.extraMonthly ? ` (+${fmtMoney(input.extraMonthly)} extra)` : ""}`,
			`Payoff time: ${fmtDuration(r.months)} (${r.months} months)`,
			`Total interest: ${fmtMoney(r.totalInterest)}`,
			`Total paid: ${fmtMoney(r.totalPaid)}`,
			"Yearly breakdown:",
			yearlyLines,
		].join("\n");
		return viewResult(text, "chart", chart);
	},
});

const scenarioSchema = Type.Object({
	name: Type.String({ description: "Short label for the scenario, e.g. '15y at 5.9%'" }),
	...loanFields,
});

const compareLoans = defineTool({
	name: "compare_loans",
	label: "Compare loans",
	description:
		"Compare 2-5 loan scenarios (different principal, rate, term, or extra payment): monthly payment, payoff time, total interest, and the balance curves side by side. Shows the user a balance chart.",
	parameters: Type.Object({
		scenarios: Type.Array(scenarioSchema, { minItems: 2, maxItems: 5, description: "The loan scenarios to compare" }),
	}),
	annotations: { readOnlyHint: true },
	async execute(_id, params) {
		const results = params.scenarios.map((s) => ({ s, r: amortize(toInput(s)) }));
		const years = Math.ceil(Math.max(...params.scenarios.map((s) => s.years)));
		const chart: ChartData = {
			title: "Balance by year",
			kind: "line",
			labels: Array.from({ length: years + 1 }, (_, i) => `Y${i}`),
			series: results.map(({ s, r }) => ({ name: s.name, values: yearlyBalances(r.balances, years) })),
		};
		const base = results[0].r;
		const text = results
			.map(({ s, r }, i) => {
				const vs = i === 0 ? "" : ` | interest vs first: ${r.totalInterest - base.totalInterest >= 0 ? "+" : ""}${fmtMoney(r.totalInterest - base.totalInterest)}`;
				return `${s.name}: principal ${fmtMoney(s.principal)}, ${s.annual_rate_pct}%, ${s.years}y${s.extra_monthly ? `, +${fmtMoney(s.extra_monthly)}/mo` : ""} -> payment ${fmtMoney(r.monthlyPayment)}, payoff ${fmtDuration(r.months)}, total interest ${fmtMoney(r.totalInterest)}, total paid ${fmtMoney(r.totalPaid)}${vs}`;
			})
			.join("\n");
		return viewResult(text, "chart", chart);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(withViews(loanSchedule));
	pi.registerTool(withViews(compareLoans));
}
