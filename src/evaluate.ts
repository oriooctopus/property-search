/**
 * Buy-vs-Stock-Market evaluator.
 *
 * Compares buying a property (20% down, 6.5% 30yr fixed) against
 * investing the same cash flows at 8.5% annual return.
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __evalDir = dirname(fileURLToPath(import.meta.url));

// ── Assumptions (loaded from evaluate-config.json, with defaults) ──
interface EvalConfig {
  downPercent: number;
  mortgageRate: number;
  mortgageYears: number;
  appreciation: number;
  stockReturn: number;
  propTaxRate: number;
  insuranceRate: number;
  maintenanceRate: number;
  closingBuyRate: number;
  closingSellRate: number;
  monthlyRent: number;
  rentInflation: number;
}

const DEFAULTS: EvalConfig = {
  downPercent: 0.20,
  mortgageRate: 0.065,
  mortgageYears: 30,
  appreciation: 0.05,
  stockReturn: 0.085,
  propTaxRate: 0.012,
  insuranceRate: 0.004,
  maintenanceRate: 0.01,
  closingBuyRate: 0.03,
  closingSellRate: 0.06,
  monthlyRent: 5500,
  rentInflation: 0.045,
};

function loadEvalConfig(): EvalConfig {
  const path = join(__evalDir, "evaluate-config.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const loaded = JSON.parse(readFileSync(path, "utf-8"));
    return { ...DEFAULTS, ...loaded };
  } catch {
    return DEFAULTS;
  }
}

const cfg = loadEvalConfig();
const DOWN_PERCENT = cfg.downPercent;
const MORTGAGE_RATE = cfg.mortgageRate;
const MORTGAGE_YEARS = cfg.mortgageYears;
const APPRECIATION = cfg.appreciation;
const STOCK_RETURN = cfg.stockReturn;
const PROP_TAX_RATE = cfg.propTaxRate;
const INSURANCE_RATE = cfg.insuranceRate;
const MAINTENANCE_RATE = cfg.maintenanceRate;
const CLOSING_BUY_RATE = cfg.closingBuyRate;
const CLOSING_SELL_RATE = cfg.closingSellRate;
const MONTHLY_RENT = cfg.monthlyRent;
const RENT_INFLATION = cfg.rentInflation;

// ── Mortgage math ────────────────────────────────────────────
function monthlyPayment(principal: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

interface MonthlyBreakdown {
  month: number;
  principal: number;
  interest: number;
  balance: number;
}

function amortize(loanAmount: number, annualRate: number, years: number): MonthlyBreakdown[] {
  const r = annualRate / 12;
  const pmt = monthlyPayment(loanAmount, annualRate, years);
  const schedule: MonthlyBreakdown[] = [];
  let balance = loanAmount;

  for (let m = 1; m <= years * 12; m++) {
    const interest = balance * r;
    const principal = pmt - interest;
    balance -= principal;
    schedule.push({ month: m, principal, interest, balance: Math.max(balance, 0) });
  }
  return schedule;
}

// ── Evaluator ────────────────────────────────────────────────
export interface EvalResult {
  years: number;
  purchasePrice: number;

  // Buy side
  downPayment: number;
  closingCostsBuy: number;
  loanAmount: number;
  monthlyMortgage: number;
  totalMortgagePaid: number;
  totalPrincipalPaid: number;
  totalInterestPaid: number;
  totalCarryingCosts: number;   // taxes + insurance + maintenance
  closingCostsSell: number;
  homeValueAtSale: number;
  remainingBalance: number;
  saleProceeds: number;         // home value - remaining balance - sell closing
  totalCashOutBuy: number;      // all cash spent (down + buy closing + mortgage + carrying)
  netWealthBuy: number;         // sale proceeds - total cash out

  // Stock side
  monthlyRent: number;
  totalRentPaid: number;
  monthlyStockContribution: number; // mortgage + carrying - rent (the extra you'd invest)
  stockPortfolioValue: number;  // lump sum + monthly extras invested at 8.5%

  // Comparison
  buyAdvantage: number;         // positive = buying wins
}

export function evaluate(purchasePrice: number, holdYears: number): EvalResult {
  const downPayment = purchasePrice * DOWN_PERCENT;
  const closingBuy = purchasePrice * CLOSING_BUY_RATE;
  const loanAmount = purchasePrice - downPayment;
  const pmt = monthlyPayment(loanAmount, MORTGAGE_RATE, MORTGAGE_YEARS);
  const schedule = amortize(loanAmount, MORTGAGE_RATE, MORTGAGE_YEARS);
  const months = holdYears * 12;

  // ── Buy scenario ──
  const slice = schedule.slice(0, months);
  const totalPrincipal = slice.reduce((s, m) => s + m.principal, 0);
  const totalInterest = slice.reduce((s, m) => s + m.interest, 0);
  const remainingBalance = slice[slice.length - 1].balance;

  // Carrying costs (approximate: use starting value, grows with appreciation)
  const annualCarryRate = PROP_TAX_RATE + INSURANCE_RATE + MAINTENANCE_RATE;
  let totalCarrying = 0;
  for (let y = 0; y < holdYears; y++) {
    const valueThisYear = purchasePrice * Math.pow(1 + APPRECIATION, y);
    totalCarrying += valueThisYear * annualCarryRate;
  }

  const homeValue = purchasePrice * Math.pow(1 + APPRECIATION, holdYears);
  const closingSell = homeValue * CLOSING_SELL_RATE;
  const saleProceeds = homeValue - remainingBalance - closingSell;

  const totalCashOut = downPayment + closingBuy + (pmt * months) + totalCarrying;
  const netBuy = saleProceeds - totalCashOut;

  // ── Stock scenario ──
  // If you don't buy, you still pay rent (which inflates yearly).
  // The investable surplus each month = housing cost − rent that month.
  const monthlyStock = STOCK_RETURN / 12;
  const monthlyCarrying = totalCarrying / months;
  const monthlyHousingCost = pmt + monthlyCarrying;

  // Down payment + closing costs invested at month 0
  let stockValue = (downPayment + closingBuy) * Math.pow(1 + monthlyStock, months);

  let totalRent = 0;
  let totalContributions = 0;
  for (let m = 1; m <= months; m++) {
    const year = Math.floor((m - 1) / 12);
    const rentThisMonth = MONTHLY_RENT * Math.pow(1 + RENT_INFLATION, year);
    totalRent += rentThisMonth;
    const surplus = Math.max(monthlyHousingCost - rentThisMonth, 0);
    totalContributions += surplus;
    const monthsRemaining = months - m;
    stockValue += surplus * Math.pow(1 + monthlyStock, monthsRemaining);
  }
  const avgMonthlyContrib = totalContributions / months;

  return {
    years: holdYears,
    purchasePrice,
    downPayment,
    closingCostsBuy: closingBuy,
    loanAmount,
    monthlyMortgage: pmt,
    totalMortgagePaid: pmt * months,
    totalPrincipalPaid: totalPrincipal,
    totalInterestPaid: totalInterest,
    totalCarryingCosts: totalCarrying,
    closingCostsSell: closingSell,
    homeValueAtSale: homeValue,
    remainingBalance,
    saleProceeds,
    totalCashOutBuy: totalCashOut,
    netWealthBuy: netBuy,
    monthlyRent: MONTHLY_RENT,
    totalRentPaid: totalRent,
    monthlyStockContribution: avgMonthlyContrib,
    stockPortfolioValue: stockValue,
    buyAdvantage: netBuy - stockValue,
  };
}

// ── Pretty print ─────────────────────────────────────────────
const $ = (n: number) => "$" + Math.round(n).toLocaleString();
const pct = (n: number) => (n * 100).toFixed(1) + "%";

export function printEvaluation(r: EvalResult) {
  const divider = "─".repeat(56);
  const months = r.years * 12;
  const monthlyCarrying = r.totalCarryingCosts / months;
  const appreciation = r.homeValueAtSale - r.purchasePrice;
  const lumpSum = r.downPayment + r.closingCostsBuy;
  const lumpSumGrowth = lumpSum * Math.pow(1 + STOCK_RETURN / 12, months) - lumpSum;
  const totalStockContributions = r.monthlyStockContribution * months;
  const stockGrowthOnContribs = r.stockPortfolioValue - lumpSum - lumpSumGrowth - totalStockContributions;

  console.log();
  console.log(`  ┌${divider}┐`);
  console.log(`  │  ${r.years}-YEAR HOLD  ·  ${$(r.purchasePrice)} purchase${" ".repeat(56 - 22 - $(r.purchasePrice).length - r.years.toString().length)}│`);
  console.log(`  └${divider}┘`);

  // ── IF YOU BUY ──
  console.log();
  console.log("  IF YOU BUY — what you walk away with:");
  console.log(`  ${divider}`);
  console.log();
  console.log(`  Money you gain:`);
  console.log(`    + Appreciation (5%/yr)               ${$(appreciation).padStart(12)}`);
  console.log(`    + Equity built (principal payments)   ${$(r.totalPrincipalPaid).padStart(12)}`);
  console.log(`    + Rent you DON'T pay                 ${$(r.totalRentPaid).padStart(12)}`);
  console.log();
  console.log(`  Money you lose:`);
  console.log(`    − Mortgage interest                  ${$(r.totalInterestPaid).padStart(12)}`);
  console.log(`    − Taxes/insurance/maintenance        ${$(r.totalCarryingCosts).padStart(12)}`);
  console.log(`    − Closing costs (buy)                ${$(r.closingCostsBuy).padStart(12)}`);
  console.log(`    − Closing costs (sell)               ${$(r.closingCostsSell).padStart(12)}`);
  console.log();

  const buyGains = appreciation + r.totalPrincipalPaid + r.totalRentPaid;
  const buyLosses = r.totalInterestPaid + r.totalCarryingCosts + r.closingCostsBuy + r.closingCostsSell;
  const buyNet = buyGains - buyLosses;
  console.log(`  Net gain from buying:                  ${$(buyNet).padStart(12)}`);

  // ── IF YOU RENT + INVEST ──
  console.log();
  console.log("  IF YOU RENT + INVEST — what you walk away with:");
  console.log(`  ${divider}`);
  console.log();
  console.log(`  You invest the down payment + closing (${$(lumpSum)}) at 8.5%:`);
  console.log(`    + Growth on lump sum                 ${$(lumpSumGrowth).padStart(12)}`);
  console.log();
  const finalRent = MONTHLY_RENT * Math.pow(1 + RENT_INFLATION, r.years - 1);
  console.log(`  Rent: ${$(r.monthlyRent)}/mo yr1 → ${$(finalRent)}/mo yr${r.years} (${pct(RENT_INFLATION)}/yr)`);
  console.log(`  Housing if buying: ${$(r.monthlyMortgage + monthlyCarrying)}/mo (fixed mortgage + carrying)`);
  console.log(`  Avg surplus invested: ~${$(r.monthlyStockContribution)}/mo`);
  console.log();
  console.log(`    + Contributions over ${r.years}yr              ${$(totalStockContributions).padStart(12)}`);
  console.log(`    + Growth on contributions            ${$(stockGrowthOnContribs).padStart(12)}`);
  console.log();
  console.log(`  Money you lose:`);
  console.log(`    − Rent paid (inflating 5%/yr)        ${$(r.totalRentPaid).padStart(12)}`);
  console.log();

  const stockNet = lumpSumGrowth + totalStockContributions + stockGrowthOnContribs;
  console.log(`  Net gain from renting + investing:     ${$(stockNet).padStart(12)}`);

  // ── VERDICT ──
  console.log();
  console.log(`  ${divider}`);
  const diff = buyNet - stockNet;
  const winner = diff > 0 ? "BUYING WINS" : "STOCKS WIN";
  console.log(`  ${winner} by ${$(Math.abs(diff))}`);
  console.log(`  ${divider}`);
  console.log();
}

// ── CLI entry point ──────────────────────────────────────────
if (process.argv[1]?.includes("evaluate")) {
  const price = Number(process.argv[2]) || 979_000; // default to the Lincoln Pl property

  console.log(`\nProperty evaluation: ${$(price)}`);
  console.log(`Assumptions: ${pct(DOWN_PERCENT)} down, ${pct(MORTGAGE_RATE)} mortgage, ${pct(APPRECIATION)} appreciation, ${pct(STOCK_RETURN)} stocks`);
  console.log(`Costs: ${pct(PROP_TAX_RATE)} tax, ${pct(INSURANCE_RATE)} insurance, ${pct(MAINTENANCE_RATE)} maintenance`);
  console.log(`Closing: ${pct(CLOSING_BUY_RATE)} buy, ${pct(CLOSING_SELL_RATE)} sell`);
  console.log(`Rent if not buying: $${MONTHLY_RENT.toLocaleString()}/mo (${pct(RENT_INFLATION)}/yr inflation)`);

  for (const years of [2, 5, 10]) {
    printEvaluation(evaluate(price, years));
  }
}
