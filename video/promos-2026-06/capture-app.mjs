#!/usr/bin/env node
import fs from "node:fs";
import { chromium } from "playwright";
import { assetsDir, fixedNowIso, promoModel } from "./data.mjs";

const appUrlArg = process.argv.find((arg) => arg.startsWith("--app-url="));
const appUrl = (appUrlArg ? appUrlArg.slice("--app-url=".length) : "http://127.0.0.1:5173").replace(/\/$/, "");
const model = promoModel();

fs.mkdirSync(assetsDir, { recursive: true });

function installSeed() {
  return ({ fixedIso, plan, includePlan }) => {
    const fixedMs = new Date(fixedIso).getTime();
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedMs]));
      }
      static now() { return fixedMs; }
      static parse(value) { return RealDate.parse(value); }
      static UTC(...args) { return RealDate.UTC(...args); }
    }
    window.Date = MockDate;
    window.localStorage.setItem("saturday.userLocation", JSON.stringify({ lat: 37.7749, lon: -122.4194 }));
    window.localStorage.setItem("famhop:interests", JSON.stringify(["animals-nature", "arts-crafts", "active-outdoors"]));
    window.localStorage.setItem("saturday.heroDismissedAt", String(fixedMs));
    window.localStorage.setItem("saturday.digestPromptDismissed", "1");
    if (includePlan) {
      window.localStorage.setItem("saturday.hopNowSeen", "1");
      window.localStorage.setItem("saturday.plans", JSON.stringify([plan]));
      window.localStorage.setItem("saturday.savedSpots", JSON.stringify(plan.stopIds));
      window.localStorage.setItem("saturday.savedEvents", JSON.stringify(plan.eventIds));
    }
  };
}

async function makePage(browser, includePlan = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.route(`**/polls/${model.plan.pollId}`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(model.poll),
    });
  });
  await page.addInitScript(installSeed(), {
    fixedIso: fixedNowIso,
    plan: model.plan,
    includePlan,
  });
  return { page, context };
}

async function captureExplore(browser) {
  const { page, context } = await makePage(browser);
  await page.goto(`${appUrl}/bay-area/#/browse`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${assetsDir}/explore.png`, fullPage: false });
  await context.close();
}

async function captureHopNow(browser) {
  const { page, context } = await makePage(browser);
  await page.goto(`${appUrl}/bay-area/#/browse`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hop-now-fab", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.locator(".hop-now-fab").click();
  await page.waitForSelector(".hop-now-modal", { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${assetsDir}/hop-now.png`, fullPage: false });
  await context.close();
}

async function capturePlanShare(browser) {
  const { page, context } = await makePage(browser, true);
  await page.goto(`${appUrl}/bay-area/#/plans/${model.plan.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".plan-detail", { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, 360));
  await page.locator(".share-card-panel summary").click().catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${assetsDir}/plan-share.png`, fullPage: false });
  await context.close();
}

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--disable-lcd-text"],
});
try {
  await captureExplore(browser);
  await captureHopNow(browser);
  await capturePlanShare(browser);
} finally {
  await browser.close();
}

console.log(`captured app screenshots in ${assetsDir}`);
