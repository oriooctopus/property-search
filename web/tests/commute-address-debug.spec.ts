import { test, expect } from "@playwright/test";
import { waitForListingsLoaded } from "./auth.helper";

test("diagnose commute address input focus and typing", async ({ page }) => {
  // Capture console messages
  const consoleLogs: string[] = [];
  page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto("/");
  await waitForListingsLoaded(page);

  // --- 1. Open Filters --------------------------------------------------
  const filtersToggle = page.getByRole("button", { name: /filters/i }).first();
  await filtersToggle.click();

  // --- 2. Open Commute chip --------------------------------------------
  const commuteChip = page.getByRole("button", { name: /^commute/i });
  await expect(commuteChip).toBeVisible();
  await commuteChip.click();

  // --- 3. Add a rule ---------------------------------------------------
  const addRuleBtn = page.getByRole("button", { name: /add commute filter/i });
  await expect(addRuleBtn).toBeVisible();
  await addRuleBtn.click();

  // --- 4. Switch to Address type ---------------------------------------
  const typeSelect = page.locator("select").filter({ hasText: /subway line/i }).first();
  await typeSelect.selectOption("address");

  // --- 5. Locate the address input -------------------------------------
  const addressInput = page.getByPlaceholder("Search address...");
  await expect(addressInput).toBeVisible();

  // --- 6. Screenshot BEFORE clicking -----------------------------------
  await page.screenshot({ path: "/Users/oliverullman/Documents/coding/property-search/web/debug-address-1-before-click.png" });
  console.log("Screenshot 1 saved: debug-address-1-before-click.png");

  // --- 7. Check what element is at the input's position (overlay check) ---
  const inputBox = await addressInput.boundingBox();
  const centerX = inputBox ? inputBox.x + inputBox.width / 2 : 0;
  const centerY = inputBox ? inputBox.y + inputBox.height / 2 : 0;

  const elementAtCenter = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return "null — nothing at that position";
      return {
        tag: el.tagName,
        id: el.id || "(no id)",
        className: el.className?.toString().slice(0, 100) || "(no class)",
        placeholder: el.getAttribute("placeholder") || "(no placeholder)",
        type: el.getAttribute("type") || "(no type)",
        role: el.getAttribute("role") || "(no role)",
        zIndex: window.getComputedStyle(el).zIndex,
        pointerEvents: window.getComputedStyle(el).pointerEvents,
        isInputItself:
          el.getAttribute("placeholder") === "Search address...",
      };
    },
    { x: centerX, y: centerY }
  );

  console.log("=== OVERLAY CHECK: Element at input center position ===");
  console.log(JSON.stringify(elementAtCenter, null, 2));

  // --- 8. Click the address input --------------------------------------
  await addressInput.click();
  await page.waitForTimeout(300); // Let React settle

  // --- 9. Check what has focus after click -----------------------------
  const focusedElementInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "no active element";
    return {
      tag: el.tagName,
      placeholder: el.getAttribute("placeholder") || "(no placeholder)",
      id: el.id || "(no id)",
      isAddressInput: el.getAttribute("placeholder") === "Search address...",
      type: el.getAttribute("type") || "(no type)",
    };
  });

  console.log("=== FOCUS CHECK: Active element after click ===");
  console.log(JSON.stringify(focusedElementInfo, null, 2));

  // --- 10. Screenshot AFTER clicking -----------------------------------
  await page.screenshot({ path: "/Users/oliverullman/Documents/coding/property-search/web/debug-address-2-after-click.png" });
  console.log("Screenshot 2 saved: debug-address-2-after-click.png");

  // --- 11. Type a single character 'A' ---------------------------------
  await page.keyboard.type("A");
  await page.waitForTimeout(200);

  // --- 12. Check the input value after typing --------------------------
  const inputValueAfterType = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[placeholder="Search address..."]');
    if (!el) return "INPUT NOT FOUND IN DOM";
    return {
      value: el.value,
      hasFocus: document.activeElement === el,
      disabled: el.disabled,
      readOnly: el.readOnly,
      pointerEvents: window.getComputedStyle(el).pointerEvents,
    };
  });

  console.log("=== TYPING CHECK: Input value and state after typing 'A' ===");
  console.log(JSON.stringify(inputValueAfterType, null, 2));

  // --- 13. Screenshot AFTER typing -------------------------------------
  await page.screenshot({ path: "/Users/oliverullman/Documents/coding/property-search/web/debug-address-3-after-type.png" });
  console.log("Screenshot 3 saved: debug-address-3-after-type.png");

  // --- 14. Also check the entire input hierarchy for pointer-events ----
  const inputHierarchy = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[placeholder="Search address..."]');
    if (!input) return [];
    const chain: object[] = [];
    let el: Element | null = input;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      chain.push({
        tag: el.tagName,
        id: el.id || undefined,
        className: el.className?.toString().slice(0, 60) || undefined,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        position: style.position,
        overflow: style.overflow,
      });
      el = el.parentElement;
    }
    return chain;
  });

  console.log("=== HIERARCHY CHECK: pointer-events up the DOM tree ===");
  console.log(JSON.stringify(inputHierarchy, null, 2));

  // --- 15. Check for any global keydown listeners (diagnostic) ---------
  const globalHandlers = await page.evaluate(() => {
    // Check if there are event listeners on document/window that could intercept keys
    // We can't enumerate all listeners, but we can check for common patterns
    const patterns = {
      documentHasOnKeydown: !!document.onkeydown,
      windowHasOnKeydown: !!window.onkeydown,
      bodyHasOnKeydown: !!document.body.onkeydown,
    };
    return patterns;
  });

  console.log("=== GLOBAL HANDLER CHECK ===");
  console.log(JSON.stringify(globalHandlers, null, 2));

  // --- 16. Summary assertions ------------------------------------------
  const isOverlayBlocking =
    typeof elementAtCenter === "object" &&
    elementAtCenter !== null &&
    "isInputItself" in elementAtCenter &&
    !elementAtCenter.isInputItself;

  const focusLanded =
    typeof focusedElementInfo === "object" &&
    focusedElementInfo !== null &&
    "isAddressInput" in focusedElementInfo &&
    focusedElementInfo.isAddressInput;

  const typingWorked =
    typeof inputValueAfterType === "object" &&
    inputValueAfterType !== null &&
    "value" in inputValueAfterType &&
    inputValueAfterType.value === "A";

  console.log("\n=== SUMMARY ===");
  console.log(`Overlay blocking click: ${isOverlayBlocking}`);
  console.log(`Focus landed on address input: ${focusLanded}`);
  console.log(`Typing 'A' worked (value === 'A'): ${typingWorked}`);

  // Soft assertions so all checks run even if one fails
  expect(isOverlayBlocking).toBe(false); // No overlay should block the input
  expect(focusLanded).toBe(true);        // Focus should be on the address input
  expect(typingWorked).toBe(true);       // Typing 'A' should produce value 'A'
});
