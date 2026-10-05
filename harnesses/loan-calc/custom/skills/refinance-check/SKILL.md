---
name: refinance-check
description: Decide whether refinancing (or paying extra) is worth it, with break-even month and total savings. Use when the user asks "should I refinance", compares their current loan with a new offer, or asks whether extra payments pay off.
---

# Refinance check

Answer with numbers from the tools, never estimates from memory.

## Inputs to collect
- The current loan: remaining balance (not the original amount), rate, and years left.
- The new offer: rate, term, and **closing costs** (fees and points). If the user doesn't know the closing costs,
  use 2% of the balance and say so.
- Whether they plan to keep the home or loan past the break-even point. Ask if it matters to the answer.

## Steps
1. Run `compare_loans` with these scenarios:
   - **stay:** current balance, current rate, years left
   - **refinance:** same balance (add the closing costs to the balance if they will be rolled in), new rate, new term
   - if the new term is longer than the years left, also **refinance, same payoff:** new rate, term equal to the years left
2. Monthly saving = stay payment − refinance payment.
3. **Break-even month** = closing costs ÷ monthly saving, rounded up. If the saving is ≤ 0, there is no break-even.
4. **Lifetime difference** = total paid (stay) − total paid (refinance) − closing costs (if paid upfront).
5. For extra payments, run `loan_schedule` with and without `extra_monthly`. Report the months saved and the interest saved.

## Verdict
- Refinancing is worth it when the break-even comes well before they expect to sell or refinance again, **and** the
  lifetime difference is positive.
- A longer new term can lower the payment while costing more overall. If so, say it plainly, with both numbers.
- Close with the verdict, the break-even month, the monthly saving and the lifetime difference. The chart and table already show the schedules.
