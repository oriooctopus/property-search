/**
 * Guard against a repeat of the UR5EH5f94zYDT0Iml incident: commit 552e3be
 * added a top-level `const CL_BLOCK_MARKERS = [...]` statement before
 * `async function pageFunction(context) {` inside SEARCH_ONLY_PAGE_FUNCTION.
 *
 * Apify's apify/puppeteer-scraper compiles the pageFunction source via
 * evalFunctionOrThrow, which parses the string as a single EXPRESSION
 * (equivalent to wrapping it in parens: `(source)`). A source that isn't
 * exactly one function expression/declaration — e.g. a leading top-level
 * statement — fails to compile, and the actor run FAILS outright before any
 * page is ever touched (4 retries, all raising "Unexpected token 'const'").
 *
 * This test locks in that both pageFunction strings compile the same way
 * Apify compiles them, so a similar mistake can't reach a real run again.
 *
 * Run with: npx vitest run tests/craigslist-pagefunction.test.ts
 */

import { describe, it, expect } from "vitest";
import vm from "node:vm";
import {
  SEARCH_ONLY_PAGE_FUNCTION,
  DETAIL_PAGE_FUNCTION,
} from "../lib/sources/craigslist";

function assertCompilesAsApifyPageFunction(src: string) {
  // Mirrors @apify/scraper-tools' evalFunctionOrThrow: the pageFunction
  // string must parse as a single expression, not a script with top-level
  // statements before/after the function.
  expect(() => new vm.Script("(" + src + ")")).not.toThrow();
}

describe("Craigslist pageFunction strings compile as Apify expects", () => {
  it("SEARCH_ONLY_PAGE_FUNCTION compiles as a single expression", () => {
    assertCompilesAsApifyPageFunction(SEARCH_ONLY_PAGE_FUNCTION);
  });

  it("DETAIL_PAGE_FUNCTION compiles as a single expression", () => {
    assertCompilesAsApifyPageFunction(DETAIL_PAGE_FUNCTION);
  });

  it("SEARCH_ONLY_PAGE_FUNCTION has no top-level statement before the function", () => {
    // Regression guard for the exact bug: a `const`/`let`/`var`/comment block
    // declared outside pageFunction's body breaks Apify's expression-wrap
    // compile even though it's perfectly valid as a standalone script.
    const trimmed = SEARCH_ONLY_PAGE_FUNCTION.trim();
    expect(trimmed.startsWith("async function pageFunction")).toBe(true);
  });

  it("DETAIL_PAGE_FUNCTION has no top-level statement before the function", () => {
    const trimmed = DETAIL_PAGE_FUNCTION.trim();
    expect(trimmed.startsWith("async function pageFunction")).toBe(true);
  });
});
