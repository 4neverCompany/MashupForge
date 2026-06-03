import asyncio
from playwright.async_api import async_playwright
import os

async def shoot(url: str, out: str, viewport: dict):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport=viewport, device_scale_factor=2)
        page = await ctx.new_page()
        await page.goto(url, wait_until="networkidle", timeout=60000)
        # Give the scroll-based animations and lazy assets a moment
        await page.wait_for_timeout(1500)
        # Trigger scroll-based animations by scrolling to bottom and back
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(400)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(800)
        await page.screenshot(path=out, full_page=True)
        await browser.close()
        size = os.path.getsize(out)
        print(f"  {out}: {size//1024}KB")

async def main():
    base = "http://localhost:3939"
    out_dir = "/workspace/landing-screens"
    os.makedirs(out_dir, exist_ok=True)

    print("Desktop full page (1440x900)...")
    await shoot(base, f"{out_dir}/desktop-full.png", {"width": 1440, "height": 900})

    print("Desktop hero only (1440x900)...")
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = await ctx.new_page()
        await page.goto(base, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{out_dir}/desktop-hero.png", full_page=False)
        await b.close()

    print("Mobile full page (390x844)...")
    await shoot(base, f"{out_dir}/mobile-full.png", {"width": 390, "height": 844})

    print("Tablet (820x1180)...")
    await shoot(base, f"{out_dir}/tablet-full.png", {"width": 820, "height": 1180})

asyncio.run(main())
