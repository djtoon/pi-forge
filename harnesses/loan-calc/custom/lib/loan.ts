// Pure loan math. No I/O.

export interface LoanInput {
	principal: number;
	/** nominal annual rate in percent, compounded monthly */
	annualRatePct: number;
	years: number;
	/** extra paid every month on top of the scheduled payment */
	extraMonthly?: number;
}

export interface LoanResult {
	monthlyPayment: number;
	months: number;
	totalInterest: number;
	totalPaid: number;
	/** balance[m] = balance after m months (balance[0] = principal) */
	balances: number[];
	/** interest and principal paid per year (index 0 = year 1) */
	yearly: { interest: number; principal: number; endBalance: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scheduledPayment(principal: number, annualRatePct: number, years: number): number {
	const n = Math.round(years * 12);
	const r = annualRatePct / 100 / 12;
	if (r === 0) return principal / n;
	return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function validate(l: LoanInput): void {
	if (!(l.principal > 0)) throw new Error("principal must be greater than 0");
	if (!(l.annualRatePct >= 0 && l.annualRatePct <= 100)) throw new Error("annual rate must be between 0 and 100 (percent)");
	if (!(l.years > 0 && l.years <= 100)) throw new Error("years must be between 0 and 100");
	if ((l.extraMonthly ?? 0) < 0) throw new Error("extra monthly payment cannot be negative");
}

export function amortize(l: LoanInput): LoanResult {
	validate(l);
	const n = Math.round(l.years * 12);
	const r = l.annualRatePct / 100 / 12;
	const pay = scheduledPayment(l.principal, l.annualRatePct, l.years);
	const extra = l.extraMonthly ?? 0;
	let bal = l.principal;
	let totalInterest = 0;
	const balances = [bal];
	const yearly: LoanResult["yearly"] = [];
	let yi = 0;
	let yp = 0;
	let months = 0;
	while (bal > 0.005 && months < n) {
		const interest = bal * r;
		let principalPart = Math.min(bal, pay - interest + extra);
		if (months === n - 1) principalPart = bal; // clear rounding residue on the last scheduled month
		bal -= principalPart;
		totalInterest += interest;
		yi += interest;
		yp += principalPart;
		months++;
		balances.push(Math.max(0, bal));
		if (months % 12 === 0 || bal <= 0.005) {
			yearly.push({ interest: round2(yi), principal: round2(yp), endBalance: round2(Math.max(0, bal)) });
			yi = 0;
			yp = 0;
		}
	}
	return {
		monthlyPayment: round2(pay),
		months,
		totalInterest: round2(totalInterest),
		totalPaid: round2(l.principal + totalInterest),
		balances,
		yearly,
	};
}

export function fmtMoney(n: number): string {
	return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDuration(months: number): string {
	const y = Math.floor(months / 12);
	const m = months % 12;
	return [y ? `${y}y` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}
